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
import type { Messaging } from "../messaging/messaging.ts";
import type { Player } from "../player.ts";
import { openUserSettings, type UserSettingsStore } from "../user-settings.ts";
import { authProfileKeys, type ProviderKeys } from "../providers/keys.ts";
import type { RemovableStateStore } from "../state.ts";
import {
  Bridge,
  BridgeLinkSchema,
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

/** The one bridge in the process, whichever registration made it. */
function sharedBridge(deps: BridgeDeps): Bridge {
  const scope = globalThis as { [CELL]?: BridgeCell };
  const cell = (scope[CELL] ??= {});
  if (cell.bridge) cell.bridge.attach(deps);
  else cell.bridge = new Bridge(deps);
  return cell.bridge;
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
 * Links groups to Discord channels (`bridges/`): a bot token kept as an auth
 * profile beside the provider keys, the links in the retained `"bridges"`
 * store, and one connection per process, made when the Gateway starts or a
 * token is saved. People writing in a linked channel are guests in the group;
 * what the group says shows in the channel as its speakers.
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
  const bridge = sharedBridge({
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
      const sessionKey = `chat:group:${chatId.slice("group:".length)}`;
      // Writing in an open group's channel is joining it, as on Discord.
      if (!(await messaging.membersOf(chatId)).includes(actor.id))
        await messaging.manageChat(
          actor.id,
          { action: "join", sessionKey },
          undefined,
          roster(),
        );
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
  });
  // Every instance's messages, once for the process.
  const scope = globalThis as { [CELL]?: BridgeCell };
  const cell = scope[CELL];
  if (cell && !cell.unsubscribe)
    cell.unsubscribe = deps.messaging.onAnyEvent((event) =>
      bridge.outgoing(event),
    );

  const loadLinks = async () => {
    const links = new Map<string, BridgeLink>();
    for (const { key, value } of await store.entries()) {
      const parsed = BridgeLinkSchema.safeParse(value);
      if (parsed.success) links.set(key, parsed.data);
    }
    bridge.setLinks(links);
  };

  const connect = async () => {
    const token = keys.read(TOKEN);
    if (!token) {
      await bridge.disconnect();
      return;
    }
    await bridge.connect(transport(token));
    const status = bridge.status;
    if (status.state === "failed") warn(`Bridge: ${status.error}`);
  };

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
    if (!chatId.startsWith("group:"))
      throw new Error("Only a group chat can be linked.");
    if (channelId) {
      const taken = [...bridge.allLinks()].find(
        ([other, link]) => other !== chatId && link.channelId === channelId,
      );
      if (taken)
        throw new Error("That channel is already linked to another group.");
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
