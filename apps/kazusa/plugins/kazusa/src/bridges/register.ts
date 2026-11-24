import {
  BridgeLinkPayloadSchema,
  BridgeTokenPayloadSchema,
  type BridgeLinkEntry,
  type BridgesResponse,
} from "@kazusa/client";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { currentConfig } from "../current-config.ts";
import {
  createRouteRegistrar,
  readJsonBody,
  sendJson,
} from "../http/helpers.ts";
import type { Messaging } from "../messaging/messaging.ts";
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
  const transport = deps.transport ?? discordTransport;
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
  const bridge = sharedBridge({
    postAsGuest: (input) => deps.messaging.postAsGuest(input),
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
      const problem = bridge.problemOf(chatId);
      return { chatId, ...link, ...(problem ? { problem } : {}) };
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
      await store.register(chatId, { platform: "discord", channelId });
    } else await store.delete(chatId);
    await loadLinks();
    await bridge.checkLinks();
    sendJson(res, 200, respond());
  });

  return { bridge };
}
