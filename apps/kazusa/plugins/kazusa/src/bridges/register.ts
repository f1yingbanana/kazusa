import {
  BridgeLinkPayloadSchema,
  BridgeTokenPayloadSchema,
  type BridgeAccountResponse,
  type BridgeLinkCodeResponse,
  type BridgeLinkEntry,
  type BridgesResponse,
} from "@kazusa/client";
import { listAgentIds } from "openclaw/plugin-sdk/agent-scope-runtime";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { currentConfig } from "../current-config.ts";
import {
  createRouteRegistrar,
  readJsonBody,
  sendJson,
} from "../http/helpers.ts";
import { inBackground } from "../background.ts";
import type { Messaging } from "../messaging/messaging.ts";
import type { Player } from "../player.ts";
import { openUserSettings, type UserSettingsStore } from "../user-settings.ts";
import { authProfileKeys, type ProviderKeys } from "../providers/keys.ts";
import type { RemovableStateStore } from "../state.ts";
import {
  Bridge,
  BridgeLinkSchema,
  NotDelivered,
  type BridgeDeps,
  type BridgeLink,
  type BridgeTransport,
} from "./bridge.ts";
import { discordTransport } from "./discord.ts";
import { publicPictures } from "./pictures.ts";

/** The bot token's auth profile, beside the provider keys: `discord:manual`. */
const TOKEN = "discord";

const CELL = Symbol.for("kazusa.bridges");

interface BridgeCell {
  bridge?: Bridge;
  unsubscribe?: () => void;
}

/**
 * The one bridge in the process, whichever registration made it, hearing every
 * Messaging instance's events once. A registration's dependencies are used
 * while it is the oldest live one, and let go when it is disposed.
 */
function sharedBridge(
  api: Pick<OpenClawPluginApi, "lifecycle">,
  deps: BridgeDeps,
  messaging: Pick<Messaging, "onAnyEvent">,
): Bridge {
  const scope = globalThis as { [CELL]?: BridgeCell };
  const cell = (scope[CELL] ??= {});
  if (cell.bridge) {
    const detach = cell.bridge.attach(deps);
    api.lifecycle?.onDispose?.(detach);
  } else cell.bridge = new Bridge(deps);
  const bridge = cell.bridge;
  cell.unsubscribe ??= messaging.onAnyEvent((event) => bridge.outgoing(event));
  return bridge;
}

/** Lets a test start from no bridge. */
export function resetSharedBridge(): void {
  const scope = globalThis as { [CELL]?: BridgeCell };
  scope[CELL]?.unsubscribe?.();
  delete scope[CELL];
}

export interface BridgeRegistration {
  readonly bridge: Bridge;
}

/**
 * Links group and direct chats to Discord channels (`bridges/`): a bot token
 * kept as an auth profile beside the provider keys, the links in the retained
 * `"bridges"` store, and one connection per process, made when the Gateway
 * starts or a token is saved. What a chat says shows in its channel as its
 * speakers; people writing there are guests in a group, and a linked account
 * speaks as whoever its person plays.
 */
export function registerBridges(
  api: OpenClawPluginApi,
  deps: {
    readonly messaging: Messaging;
    /** Who the person at the keyboard is, and whom they play. */
    readonly player: Pick<Player, "operator" | "playing">;
    /** Each person's own settings, where a linked account is kept. */
    readonly userSettings?: UserSettingsStore;
    /** The characters there are, for checking members. */
    readonly roster?: () => ReadonlySet<string>;
    /** The token store; the auth profiles unless a test gives its own. */
    readonly keys?: ProviderKeys;
    /** The connection for a token; Discord unless a test gives a fake. */
    readonly transport?: (token: string) => BridgeTransport;
    readonly store?: RemovableStateStore<BridgeLink>;
    /** The live world, where its git clone is: the Gateway's cwd. */
    readonly world?: string;
  },
): BridgeRegistration {
  const keys = deps.keys ?? authProfileKeys;
  const transport =
    deps.transport ??
    ((token: string) =>
      discordTransport(token, (message) => api.logger.warn(message)));
  const store =
    deps.store ??
    api.runtime.state.openKeyedStore<BridgeLink>({
      namespace: "bridges",
      retention: "retained",
    });
  const pictures = publicPictures({
    world: deps.world ?? process.cwd(),
    workspaceOf: (agentId) => {
      try {
        return api.runtime.agent.resolveAgentWorkspaceDir(
          currentConfig(api),
          agentId,
        );
      } catch {
        return undefined;
      }
    },
  });
  const warn = (message: string) => api.logger.warn(message);
  const settings = deps.userSettings ?? openUserSettings(api);
  const roster =
    deps.roster ?? (() => new Set(listAgentIds(currentConfig(api))));
  const { messaging, player } = deps;
  const bridge = sharedBridge(
    api,
    {
      chatExists: (chatId) => messaging.hasChat(chatId),
      postAsGuest: (input) => messaging.postAsGuest(input),
      personOf: async (accountId) => {
        const person = await settings.byDiscord(accountId);
        if (!person) return undefined;
        // Only the operator plays anyone until collaborators come.
        const actor =
          person === player.operator.id ? await player.playing() : undefined;
        return { person, ...(actor ? { actor } : {}) };
      },
      postAsCharacter: async ({ chatId, actor, text, requestId }) => {
        const members = await messaging.membersOf(chatId);
        let sessionKey: string;
        if (chatId.startsWith("direct:")) {
          // A direct chat is addressed by the other person in it.
          const peer = members.find((member) => member !== actor.id);
          if (!peer || !members.includes(actor.id))
            throw new NotDelivered(
              `${actor.name}, whom you play in Kazusa, isn't in the chat this channel is linked to, so nobody heard that.`,
            );
          sessionKey = `chat:direct:${peer}`;
        } else {
          sessionKey = `chat:group:${chatId.slice("group:".length)}`;
          // Writing in an open group's channel is joining it, as on Discord.
          if (!members.includes(actor.id))
            await messaging
              .manageChat(
                actor.id,
                { action: "join", sessionKey },
                undefined,
                roster(),
              )
              .catch(() => {
                throw new NotDelivered(
                  `${actor.name}, whom you play in Kazusa, isn't in the chat this channel is linked to, and it isn't open to join, so nobody heard that.`,
                );
              });
        }
        return await messaging.send(
          actor.id,
          actor.name,
          { sessionKey, text, requestId },
          undefined,
          roster(),
          true,
        );
      },
      linkAccount: async (person, account) => {
        // One account is one person's: whoever had it before loses it.
        const before = await settings.byDiscord(account.id);
        if (before && before !== person) {
          const { discord: _gone, ...rest } = await settings.get(before);
          await settings.set(before, rest);
        }
        await settings.set(person, {
          ...(await settings.get(person)),
          discord: { ...account, linkedAt: Date.now() },
        });
      },
      avatarOf: pictures.avatarOf,
      stickerOf: pictures.stickerOf,
      warn,
    },
    messaging,
  );

  const loadLinks = async () => {
    const links = new Map<string, BridgeLink>();
    for (const { key, value } of await store.entries()) {
      const parsed = BridgeLinkSchema.safeParse(value);
      if (parsed.success) links.set(key, parsed.data);
    }
    bridge.setLinks(links);
  };

  /**
   * Connects with the saved token, or disconnects without one. Started as
   * background work: the connection's events run in the context they start in,
   * and the Gateway's start or a settings request is long over by then.
   */
  const connect = () =>
    new Promise<void>((resolve) => {
      inBackground(
        api,
        async () => {
          try {
            const token = keys.read(TOKEN);
            if (!token) await bridge.disconnect();
            else {
              await bridge.connect(transport(token));
              const status = bridge.status;
              if (status.state === "failed") warn(`Bridge: ${status.error}`);
            }
          } finally {
            resolve();
          }
        },
        (error) => {
          warn(`Bridge: ${String(error)}`);
          resolve();
        },
      );
    });

  api.on("gateway_start", (_event, ctx) => {
    void (async () => {
      await loadLinks();
      await connect();
    })().catch((error: unknown) => warn(`Bridge: ${String(error)}`));
    ctx.abortSignal?.addEventListener("abort", () => {
      void bridge.disconnect();
    });
  });

  const respond = (): BridgesResponse => ({
    discord: { hasToken: keys.has(TOKEN), status: bridge.status },
    links: [...bridge.allLinks()].map(([chatId, link]): BridgeLinkEntry => {
      const check = bridge.checkOf(chatId);
      return {
        chatId,
        ...link,
        ...(check?.name ? { channelName: check.name } : {}),
        ...(check?.server ? { server: check.server } : {}),
        ...(check?.problem ? { problem: check.problem } : {}),
      };
    }),
  });

  const route = createRouteRegistrar(api);
  route("bridges", "GET", async (_req, res) => {
    // Looked at again now and then, so a permission fixed in Discord shows.
    await bridge.checkLinks(15_000);
    sendJson(res, 200, respond());
  });
  route("bridges/token", "POST", async (req, res) => {
    const { token } = BridgeTokenPayloadSchema.parse(await readJsonBody(req));
    if (token) await keys.save(TOKEN, token);
    else await keys.remove(TOKEN, currentConfig(api));
    await connect();
    sendJson(res, 200, respond());
  });
  route("bridges/link", "POST", async (req, res) => {
    const { chatId, channelId } = BridgeLinkPayloadSchema.parse(
      await readJsonBody(req),
    );
    // Not a conversation in person: it ends, and nobody on Discord is there.
    if (!chatId.startsWith("group:") && !chatId.startsWith("direct:"))
      throw new Error("Only a group or a direct chat can be linked.");
    if (channelId && !(await messaging.hasChat(chatId)))
      throw new Error("That chat isn't in this world.");
    if (channelId) {
      const taken = [...bridge.allLinks()].find(
        ([other, link]) => other !== chatId && link.channelId === channelId,
      );
      if (taken)
        throw new Error("That channel is already linked to another chat.");
      // A channel the bot can't use is refused, with why, before it is kept.
      const { problem } = await bridge.checkChannel(channelId);
      if (problem) throw new Error(problem);
      await store.register(chatId, { platform: "discord", channelId });
    } else await store.delete(chatId);
    await loadLinks();
    await bridge.checkLinks();
    sendJson(res, 200, respond());
  });

  // Each person's own Discord account, for anyone who plays.
  const account = async (): Promise<BridgeAccountResponse> => {
    const { discord } = await settings.get(player.operator.id);
    const status = bridge.status;
    return {
      account: discord
        ? { name: discord.name, linkedAt: discord.linkedAt }
        : null,
      bot: status.state === "connected" ? status.name : null,
    };
  };
  route("bridges/account", "GET", async (_req, res) => {
    sendJson(res, 200, await account());
  });
  route("bridges/account/code", "POST", async (_req, res) => {
    if (bridge.status.state !== "connected")
      throw new Error("There's no Discord bot connected to link with yet.");
    const { code, until } = bridge.makeCode(player.operator.id);
    sendJson(res, 200, { code, until } satisfies BridgeLinkCodeResponse);
  });
  route("bridges/account/unlink", "POST", async (_req, res) => {
    const { discord: _gone, ...rest } = await settings.get(player.operator.id);
    await settings.set(player.operator.id, rest);
    sendJson(res, 200, await account());
  });

  return { bridge };
}
