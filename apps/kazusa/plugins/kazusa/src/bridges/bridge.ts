import { createHash, randomBytes } from "node:crypto";
import type { BridgeStatus, TypingStreamEvent } from "@kazusa/client";
import { z } from "zod";
import { isGuest } from "../identity.ts";
import type {
  MessageDelivery,
  MessagingEvent,
} from "../messaging/messaging.ts";

/**
 * A group or direct chat linked to a channel on another platform: what the chat
 * says shows there, and what people write there comes in (as guests in a group;
 * only linked accounts in a direct chat). One link per chat, one chat per
 * channel.
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

/** A platform account, by the platform's id and its name there. */
export interface PlatformAccount {
  readonly id: string;
  readonly name: string;
}

/** What a connection hands the bridge. */
export interface TransportHandlers {
  /** Every line people write in a server channel the bot can read. */
  line(line: IncomingLine): void;
  /**
   * Someone sent a link code (Discord's `/link`, or the code alone in a direct
   * message); what comes back is the reply for them alone.
   */
  link(code: string, account: PlatformAccount): Promise<string>;
}

/** One platform's connection: what the bridge needs of Discord, or a fake. */
export interface BridgeTransport {
  start(handlers: TransportHandlers): Promise<{ readonly name: string }>;
  /** Shows a line in a channel as its speaker. */
  post(channelId: string, line: OutgoingLine): Promise<void>;
  /**
   * Takes a message down, once it has been said again as a character; one
   * already gone is fine. Throws `MissingPermission` when the bot may not.
   */
  remove(channelId: string, messageId: string): Promise<void>;
  /**
   * Marks a message nobody in the world heard, and tells its writer why, when
   * there is something to tell them; best effort.
   */
  markUndelivered(line: IncomingLine, reason?: string): Promise<void>;
  /** Shows the bot typing in a channel for a few seconds (Discord: ten). */
  typing(channelId: string): Promise<void>;
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

/** The platform refused for want of a permission the owner can give. */
export class MissingPermission extends Error {
  constructor() {
    super("Missing permission");
    this.name = "MissingPermission";
  }
}

/**
 * A linked person's line that couldn't be said, with why, in words for them (it
 * is told to them on the platform).
 */
export class NotDelivered extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "NotDelivered";
  }
}

/** What a linked person is told when they write while only watching. */
export const WATCHING =
  "You're only watching in Kazusa, so nobody said that. Play as someone there to speak here.";

/** What a link says when the bot can't take a linked person's message down. */
export const NO_MANAGE_MESSAGES =
  "The bot can't take your own messages down after saying them as your character. In Discord, allow it Manage Messages in the channel's permissions.";

/** A person who linked their account, and the character they play now. */
export interface LinkedPerson {
  readonly person: string;
  /** Who they play; none while they only watch. */
  readonly actor?: { readonly id: string; readonly name: string };
}

/** What the bridge needs of a group's messages and its speakers' pictures. */
export interface BridgeDeps {
  /**
   * Whether a group is in this world: a link kept on a load may name one from
   * another game.
   */
  readonly chatExists: (chatId: string) => Promise<boolean>;
  /** The person who linked this Discord account, if anyone did. */
  readonly personOf: (accountId: string) => Promise<LinkedPerson | undefined>;
  /**
   * Says a linked person's line in the chat as the character they play, joining
   * a group first when it is open and they aren't in it. Throws `NotDelivered`
   * with why when it can't be said.
   */
  readonly postAsCharacter: (input: {
    readonly chatId: string;
    readonly actor: { readonly id: string; readonly name: string };
    readonly text: string;
    readonly requestId: string;
  }) => Promise<unknown>;
  /** Keeps an account as this person's: no one else's any more. */
  readonly linkAccount: (
    person: string,
    account: PlatformAccount,
  ) => Promise<void>;
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

/** What a link says when its chat isn't in this world. */
export const MISSING_CHAT =
  "This chat isn't in this world, so nothing written in the channel goes anywhere. Link the channel from another chat, or unlink it.";

/**
 * How often to show typing again while someone still types: Discord's lasts ten
 * seconds.
 */
const TYPING_EVERY_MS = 8_000;

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
  /**
   * Every live registration's dependencies, oldest first: the oldest is used. A
   * registration made for one turn goes away with it; the Gateway's stays.
   */
  private readonly attached: BridgeDeps[];
  /** Connects and disconnects, one after another: never two connections. */
  private lifecycle: Promise<void> = Promise.resolve();
  /** Link codes not yet used, by code: whose, and until when. */
  private readonly codes = new Map<
    string,
    { readonly person: string; readonly until: number }
  >();
  /**
   * Who is typing in each linked chat (until when, for a person's signal that
   * lapses without a stop), the channel it shows in, and the timer that shows
   * it.
   */
  private readonly typists = new Map<
    string,
    {
      readonly channelId: string;
      readonly who: Map<string, number | undefined>;
      readonly timer: ReturnType<typeof setInterval>;
    }
  >();
  /** Lines already handed to the platform, so no instance posts one twice. */
  private readonly posted = new Set<string>();
  /** Each channel's posts in order. */
  private readonly queues = new Map<string, Promise<void>>();
  private current: BridgeStatus = { state: "off" };
  /** What the bot found of each link's channel, by chat id, and when. */
  private readonly checks = new Map<
    string,
    ChannelCheck & { readonly at: number }
  >();
  /**
   * What went wrong carrying a link's lines that a channel check can't see
   * (Manage Messages), by chat id, until it works again.
   */
  private readonly notes = new Map<string, string>();

  constructor(deps: BridgeDeps) {
    this.attached = [deps];
  }

  private get deps(): BridgeDeps {
    // Never empty: the last one stays until another comes.
    return this.attached[0];
  }

  /**
   * Another registration's dependencies, used once those before it are gone;
   * the returned function lets them go when it is disposed.
   */
  attach(deps: BridgeDeps): () => void {
    this.attached.push(deps);
    return () => {
      const at = this.attached.indexOf(deps);
      if (at >= 0 && this.attached.length > 1) this.attached.splice(at, 1);
    };
  }

  get status(): BridgeStatus {
    return this.current;
  }

  /** The links as stored, keyed by chat id. */
  setLinks(links: ReadonlyMap<string, BridgeLink>): void {
    this.links = new Map(links);
    for (const chatId of [...this.checks.keys(), ...this.notes.keys()])
      if (!links.has(chatId)) {
        this.checks.delete(chatId);
        this.notes.delete(chatId);
      }
    // Typing shown in a channel no longer this chat's stops.
    for (const [chatId, typing] of this.typists)
      if (links.get(chatId)?.channelId !== typing.channelId)
        this.stopTyping(chatId);
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
    const note = this.notes.get(chatId);
    return check.problem || !note ? check : { ...check, problem: note };
  }

  /**
   * A channel as the bot finds it now, before it is linked; refused while no
   * bot is connected to ask.
   */
  async checkChannel(channelId: string): Promise<ChannelCheck> {
    const transport = this.transport;
    if (!transport || this.current.state !== "connected")
      throw new Error("Connect a bot under Settings, Chat apps, first.");
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
        const exists = await this.deps.chatExists(chatId);
        const found = await transport
          .check(link.channelId)
          .catch((error: unknown): ChannelCheck => ({
            ...(last?.name ? { name: last.name } : {}),
            ...(last?.server ? { server: last.server } : {}),
            problem: `Couldn't ask Discord: ${String(error)}`,
          }));
        const check: ChannelCheck = exists
          ? found
          : { ...found, problem: MISSING_CHAT };
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

  /** Runs after every connect and disconnect handed over before it. */
  private serially(work: () => Promise<void>): Promise<void> {
    const run = this.lifecycle.then(work);
    this.lifecycle = run.catch(() => {});
    return run;
  }

  /** Connects with `transport`, replacing any connection there was. */
  async connect(transport: BridgeTransport): Promise<void> {
    await this.serially(async () => {
      await this.stopNow();
      this.transport = transport;
      this.current = { state: "connecting" };
      try {
        const { name } = await transport.start({
          line: (line) => {
            void this.incoming(line).catch((error: unknown) => {
              this.deps.warn(
                `Bridge: couldn't take in a line: ${String(error)}`,
              );
            });
          },
          link: (code, account) => this.redeem(code, account),
        });
        this.current = { state: "connected", name };
      } catch (error) {
        this.transport = undefined;
        this.current = { state: "failed", error: String(error) };
        await transport.stop().catch(() => {});
        return;
      }
      await this.checkLinks();
    });
  }

  async disconnect(): Promise<void> {
    await this.serially(() => this.stopNow());
  }

  private async stopNow(): Promise<void> {
    const transport = this.transport;
    this.transport = undefined;
    this.current = { state: "off" };
    this.checks.clear();
    this.notes.clear();
    for (const chatId of [...this.typists.keys()]) this.stopTyping(chatId);
    await transport?.stop().catch((error: unknown) => {
      this.deps.warn(`Bridge: couldn't disconnect: ${String(error)}`);
    });
  }

  /** A line from the platform, into the chat its channel is linked to. */
  async incoming(line: IncomingLine): Promise<void> {
    const chatId = [...this.links].find(
      ([, link]) => link.channelId === line.channelId,
    )?.[0];
    const text = line.text.trim();
    if (!chatId || !text) return;
    // A chat from another game: its link already says so.
    if (!(await this.deps.chatExists(chatId))) return;
    const linked = await this.deps.personOf(line.author.id);
    if (linked) {
      await this.asCharacter(chatId, line, linked, text);
      return;
    }
    // A direct chat is two people's: only a linked account speaks into it.
    if (!chatId.startsWith("group:")) {
      await this.transport?.markUndelivered(line);
      return;
    }
    await this.deps.postAsGuest({
      chatId,
      guest: guestId("discord", line.author.id),
      name: guestName(line.author.name),
      // One line: a guest's own line break could start what reads as someone
      // else's record (`[kazusa 10:31] …`) in every character's memory.
      text: text.replace(/\s*\n\s*/g, " "),
      requestId: `discord:${line.messageId}`,
    });
  }

  /**
   * A linked person's line, said as the character they play. Their own message
   * then comes down, since the character's copy is posted in its place, as
   * PluralKit does. One that can't be said is marked, and they are told why.
   */
  private async asCharacter(
    chatId: string,
    line: IncomingLine,
    linked: LinkedPerson,
    text: string,
  ): Promise<void> {
    if (!linked.actor) {
      await this.transport?.markUndelivered(line, WATCHING);
      return;
    }
    try {
      await this.deps.postAsCharacter({
        chatId,
        actor: linked.actor,
        text,
        requestId: `discord:${line.messageId}`,
      });
    } catch (error) {
      if (!(error instanceof NotDelivered)) throw error;
      await this.transport?.markUndelivered(line, error.message);
      return;
    }
    try {
      await this.transport?.remove(line.channelId, line.messageId);
      this.notes.delete(chatId);
    } catch (error) {
      if (!(error instanceof MissingPermission)) throw error;
      if (this.notes.get(chatId) !== NO_MANAGE_MESSAGES)
        this.deps.warn(`Bridge: ${chatId}: ${NO_MANAGE_MESSAGES}`);
      this.notes.set(chatId, NO_MANAGE_MESSAGES);
    }
  }

  /**
   * A code for `person` to link their Discord account with: six letters and
   * digits that are hard to misread, for ten minutes, replacing any they had.
   */
  makeCode(person: string): { readonly code: string; readonly until: number } {
    for (const [code, entry] of this.codes)
      if (entry.person === person || entry.until < Date.now())
        this.codes.delete(code);
    const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code: string;
    do {
      code = Array.from(
        randomBytes(6),
        (byte) => letters[byte % letters.length],
      ).join("");
    } while (this.codes.has(code));
    const until = Date.now() + 10 * 60_000;
    this.codes.set(code, { person, until });
    return { code, until };
  }

  /** A code sent from the platform: links the account, or says why not. */
  async redeem(code: string, account: PlatformAccount): Promise<string> {
    const key = code.trim().toUpperCase();
    const entry = this.codes.get(key);
    if (!entry || entry.until < Date.now()) {
      this.codes.delete(key);
      return "That code isn't one Kazusa made, or it's over ten minutes old. Make a new one under Settings, Chat apps.";
    }
    this.codes.delete(key);
    await this.deps.linkAccount(entry.person, account);
    return "Linked. What you write in a linked channel is now said by whoever you play in Kazusa.";
  }

  /**
   * A message from Messaging, any instance's: shown on the platform when its
   * chat is linked, unless a guest wrote it there. Called inside Messaging's
   * queue, so the line is worked out (pictures read, the world's repository
   * asked) only once its turn to post comes.
   */
  outgoing(event: MessagingEvent): void {
    if (event.type === "typing") {
      this.typed(event.typing);
      return;
    }
    if (event.type !== "message") return;
    const { delivery } = event;
    const link = this.links.get(delivery.chatId);
    const transport = this.transport;
    if (!link || !transport || isGuest(delivery.sender)) return;
    if (this.posted.has(delivery.id)) return;
    this.posted.add(delivery.id);
    if (this.posted.size > 5_000)
      for (const oldest of this.posted) {
        this.posted.delete(oldest);
        break;
      }
    const previous = this.queues.get(link.channelId) ?? Promise.resolve();
    const next = previous
      .then(async () => {
        const line = lineOf(delivery, this.deps);
        if (line) await transport.post(link.channelId, line);
      })
      .catch((error: unknown) => {
        this.deps.warn(
          `Bridge: couldn't post to Discord channel ${link.channelId}: ${String(error)}`,
        );
      });
    this.queues.set(link.channelId, next);
  }

  /**
   * Someone in a linked chat started or stopped typing: the channel shows the
   * bot typing, again every few seconds while anyone still is. Discord can't
   * show a webhook's name typing, nor stop it early: it lapses ten seconds
   * after the last time it was shown. Lines said aloud aren't typed.
   */
  private typed(typing: TypingStreamEvent): void {
    // A stop counts whatever became of the link since it started.
    if (!typing.isTyping) {
      const current = this.typists.get(typing.chatId);
      current?.who.delete(typing.senderId);
      if (current?.who.size === 0) this.stopTyping(typing.chatId);
      return;
    }
    const link = this.links.get(typing.chatId);
    if (!link || isGuest(typing.senderId) || typing.mode !== "typing") return;
    const current = this.typists.get(typing.chatId);
    if (current) {
      current.who.set(typing.senderId, typing.expiresAt);
      return;
    }
    const chatId = typing.chatId;
    const channelId = link.channelId;
    const who = new Map([[typing.senderId, typing.expiresAt]]);
    const show = () => {
      // A person's signal that lapsed sent no stop: it ends here.
      const now = Date.now();
      for (const [sender, until] of who)
        if (until !== undefined && until <= now) who.delete(sender);
      if (who.size === 0) {
        this.stopTyping(chatId);
        return;
      }
      void this.transport?.typing(channelId).catch(() => {
        // Only a hint; a refusal changes nothing that matters.
      });
    };
    const timer = setInterval(show, TYPING_EVERY_MS);
    timer.unref?.();
    this.typists.set(chatId, { channelId, who, timer });
    show();
  }

  private stopTyping(chatId: string): void {
    const current = this.typists.get(chatId);
    if (!current) return;
    clearInterval(current.timer);
    this.typists.delete(chatId);
  }

  /** Waits for every post handed over so far: for tests and shutdown. */
  async settled(): Promise<void> {
    await Promise.all(this.queues.values());
  }
}
