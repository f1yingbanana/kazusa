import { createHash } from "node:crypto";
import type { BridgeStatus } from "@kazusa/client";
import { z } from "zod";
import { isGuest } from "../identity.ts";
import type {
  MessageDelivery,
  MessagingEvent,
} from "../messaging/messaging.ts";

/**
 * A group chat linked to a chat on another platform: whoever is in the group
 * hears what people write there, and they read what the group says. One link
 * per group, one group per channel.
 */
export const BridgeLinkSchema = z.object({
  platform: z.literal("discord"),
  /** The Discord channel, as its id. */
  channelId: z.string().regex(/^\d{1,24}$/),
});
export type BridgeLink = z.infer<typeof BridgeLinkSchema>;

/** A line someone wrote on the platform, in a channel the bot can read. */
export interface IncomingLine {
  readonly channelId: string;
  /** The platform's message id: one line is taken in once. */
  readonly messageId: string;
  readonly author: { readonly id: string; readonly name: string };
  readonly text: string;
}

/** A line said in a linked group, to show on the platform as its speaker. */
export interface OutgoingLine {
  readonly name: string;
  /** A picture anyone on the internet can fetch, or none. */
  readonly avatarUrl?: string;
  readonly text: string;
}

/** One platform's connection: what the bridge needs of Discord, or a fake. */
export interface BridgeTransport {
  /** Every line people write in a channel the bot can read. */
  start(
    onLine: (line: IncomingLine) => void,
  ): Promise<{ readonly name: string }>;
  /** Shows a line in a channel as its speaker. */
  post(channelId: string, line: OutgoingLine): Promise<void>;
  /** What the bot finds of a channel: its names, and what stops it working. */
  check(channelId: string): Promise<ChannelCheck>;
  stop(): Promise<void>;
}

/** A channel as the bot finds it. */
export interface ChannelCheck {
  /** The channel's name, without the `#`; none when the bot can't see it. */
  readonly name?: string;
  /** The server it is in. */
  readonly server?: string;
  /**
   * Why the bot can't carry its lines both ways, in plain words for the owner;
   * none when it can.
   */
  readonly problem?: string;
}

/** What the bridge needs of a group's messages and its speakers' pictures. */
export interface BridgeDeps {
  /** Takes in a guest's line, into a group they aren't in. */
  readonly postAsGuest: (input: {
    readonly chatId: string;
    readonly guest: string;
    readonly name: string;
    readonly text: string;
    readonly requestId: string;
  }) => Promise<unknown>;
  /** A public picture of a character, wearing a face, or none. */
  readonly avatarOf: (agentId: string, face?: string) => string | undefined;
  /** A sticker as a public picture, or none. */
  readonly stickerOf: (agentId: string, name: string) => string | undefined;
  readonly warn: (message: string) => void;
}

/**
 * A guest's id: `guest:`, the platform, and ten letters and digits, the same
 * for one account every time (`guest:discord-169ftalq9j`). Characters copy it
 * to address and remember someone; Discord's 18-digit ids cost tokens and get
 * miscopied.
 */
export function guestId(platform: string, id: string): string {
  const digest = createHash("sha256").update(`${platform}:${id}`).digest("hex");
  // 48 bits, at most ten base-36 digits.
  return `guest:${platform}-${BigInt(`0x${digest.slice(0, 12)}`)
    .toString(36)
    .padStart(10, "0")}`;
}

/**
 * A platform display name as characters read it: one line, at most 32
 * characters, without what could pass for an id (`…`) or a stamp or marker
 * (`[…]`, `<…>`). Everything else stays as the person wrote it, underscores
 * included.
 */
export function guestName(name: string): string {
  const plain = name
    .replace(/[`[\]<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 32)
    .trim();
  return plain || "Someone";
}

/** Discord's limit for one message. */
const MAX_TEXT = 2_000;

/** How a canonical message reads on the platform; undefined to show nothing. */
export function lineOf(
  delivery: MessageDelivery,
  deps: Pick<BridgeDeps, "avatarOf" | "stickerOf">,
): OutgoingLine | undefined {
  const { params, sender, senderName } = delivery;
  const avatarUrl = deps.avatarOf(sender, params.face?.name);
  const text =
    params.type === "sticker" && params.sticker
      ? deps.stickerOf(sender, params.sticker.name)
      : params.type === "action"
        ? `*${params.text}*`
        : params.text;
  if (!text?.trim()) return undefined;
  return {
    name: senderName,
    ...(avatarUrl ? { avatarUrl } : {}),
    text: text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1)}…` : text,
  };
}

/**
 * Links groups to chats on other platforms (Discord for now) and carries lines
 * both ways. One per process: the plugin registers more than once, and two
 * connections would post every line twice.
 */
export class Bridge {
  private transport: BridgeTransport | undefined;
  private links = new Map<string, BridgeLink>();
  /** Lines already handed to the platform, so no instance posts one twice. */
  private readonly posted = new Set<string>();
  /** Each channel's posts in order. */
  private readonly queues = new Map<string, Promise<void>>();
  private current: BridgeStatus = { state: "off" };
  /** What the bot found of each link's channel, by group id, and when. */
  private readonly checks = new Map<
    string,
    ChannelCheck & { readonly at: number }
  >();

  constructor(private deps: BridgeDeps) {}

  /** The newest registration's dependencies; the older one may be gone. */
  attach(deps: BridgeDeps): void {
    this.deps = deps;
  }

  get status(): BridgeStatus {
    return this.current;
  }

  /** The links as stored, keyed by group id. */
  setLinks(links: ReadonlyMap<string, BridgeLink>): void {
    this.links = new Map(links);
    for (const chatId of this.checks.keys())
      if (!links.has(chatId)) this.checks.delete(chatId);
  }

  /**
   * A link's channel as last looked at: its names, and what stops it working
   * (the bot can't see it, say); undefined while nothing is connected to ask.
   */
  checkOf(chatId: string): ChannelCheck | undefined {
    if (!this.transport) return undefined;
    const found = this.checks.get(chatId);
    if (!found) return undefined;
    const { at: _at, ...check } = found;
    return check;
  }

  /**
   * A channel as the bot finds it now, before it is linked; refused while no
   * bot is connected to ask.
   */
  async checkChannel(channelId: string): Promise<ChannelCheck> {
    const transport = this.transport;
    if (!transport || this.current.state !== "connected")
      throw new Error("Connect a bot under Settings, Discord, first.");
    return await transport.check(channelId);
  }

  /**
   * Asks the platform about every link last looked at more than `maxAgeMs` ago
   * (all of them with 0), so a fixed permission shows as fixed. Discord changes
   * take effect without a reconnect, so this is only for telling.
   */
  async checkLinks(maxAgeMs = 0): Promise<void> {
    const transport = this.transport;
    if (!transport || this.current.state !== "connected") return;
    const now = Date.now();
    await Promise.all(
      [...this.links].map(async ([chatId, link]) => {
        const last = this.checks.get(chatId);
        if (last && now - last.at < maxAgeMs) return;
        const check = await transport
          .check(link.channelId)
          .catch((error: unknown): ChannelCheck => ({
            ...(last?.name ? { name: last.name } : {}),
            ...(last?.server ? { server: last.server } : {}),
            problem: `Couldn't ask Discord: ${String(error)}`,
          }));
        this.checks.set(chatId, { ...check, at: now });
        if (check.problem && check.problem !== last?.problem)
          this.deps.warn(
            `Bridge: ${chatId} ↔ ${link.channelId}: ${check.problem}`,
          );
      }),
    );
  }

  linkOf(chatId: string): BridgeLink | undefined {
    return this.links.get(chatId);
  }

  allLinks(): ReadonlyMap<string, BridgeLink> {
    return this.links;
  }

  /** Connects with `transport`, replacing any connection there was. */
  async connect(transport: BridgeTransport): Promise<void> {
    await this.disconnect();
    this.transport = transport;
    this.current = { state: "connecting" };
    try {
      const { name } = await transport.start((line) => {
        void this.incoming(line).catch((error: unknown) => {
          this.deps.warn(`Bridge: couldn't take in a line: ${String(error)}`);
        });
      });
      if (this.transport === transport) {
        this.current = { state: "connected", name };
        await this.checkLinks();
      }
    } catch (error) {
      if (this.transport === transport) {
        this.transport = undefined;
        this.current = { state: "failed", error: String(error) };
      }
      await transport.stop().catch(() => {});
    }
  }

  async disconnect(): Promise<void> {
    const transport = this.transport;
    this.transport = undefined;
    this.current = { state: "off" };
    this.checks.clear();
    await transport?.stop().catch((error: unknown) => {
      this.deps.warn(`Bridge: couldn't disconnect: ${String(error)}`);
    });
  }

  /** A line from the platform, into the group its channel is linked to. */
  async incoming(line: IncomingLine): Promise<void> {
    const chatId = [...this.links].find(
      ([, link]) => link.channelId === line.channelId,
    )?.[0];
    const text = line.text.trim();
    if (!chatId || !text) return;
    await this.deps.postAsGuest({
      chatId,
      guest: guestId("discord", line.author.id),
      name: guestName(line.author.name),
      text,
      requestId: `discord:${line.messageId}`,
    });
  }

  /**
   * A message from Messaging, any instance's: shown on the platform when its
   * group is linked, unless a guest wrote it there.
   */
  outgoing(event: MessagingEvent): void {
    if (event.type !== "message") return;
    const { delivery } = event;
    const link = this.links.get(delivery.chatId);
    const transport = this.transport;
    if (!link || !transport || isGuest(delivery.sender)) return;
    if (this.posted.has(delivery.id)) return;
    const line = lineOf(delivery, this.deps);
    if (!line) return;
    this.posted.add(delivery.id);
    if (this.posted.size > 5_000)
      this.posted.delete(this.posted.values().next().value as string);
    const previous = this.queues.get(link.channelId) ?? Promise.resolve();
    const next = previous
      .then(() => transport.post(link.channelId, line))
      .catch((error: unknown) => {
        this.deps.warn(
          `Bridge: couldn't post to Discord channel ${link.channelId}: ${String(error)}`,
        );
      });
    this.queues.set(link.channelId, next);
  }

  /** Waits for every post handed over so far: for tests and shutdown. */
  async settled(): Promise<void> {
    await Promise.all(this.queues.values());
  }
}
