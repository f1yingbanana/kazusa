import { systemAgentOf } from "../characters/card.ts";
import { currentConfig } from "../current-config.ts";
import { listAgentIds } from "openclaw/plugin-sdk/agent-scope-runtime";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { z } from "zod";
import type {
  Agent,
  AgentsResponse,
  CharacterStatus,
  Chat,
  ChatsResponse,
  ManageChatResponse,
  ObservedChat,
  ObservedChatsResponse,
  SendResponse,
  StreamEvent,
} from "@kazusa/client";
import {
  createRouteRegistrar,
  readJsonBody,
  sendJson,
} from "../http/helpers.ts";
import type { KazusaRealtimeBroadcaster } from "../realtime.ts";
import {
  TYPING,
  DELIVERY_REQUEST,
  LIST_CHATS,
  MANAGE_CHAT,
  conversationId,
  parseChatSession,
  type ChatSummary,
} from "./conversations.ts";
import {
  clientMessage,
  type Messaging,
  type ObservedConversation,
} from "./messaging.ts";
import { WatchingError, type Actor, type Player } from "../player.ts";

const HISTORY = z.object({
  chatId: z.string().min(1),
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

function clientChat(summary: ChatSummary, viewer: string): Chat {
  return {
    id: conversationId(viewer, summary.sessionKey),
    sessionKey: summary.sessionKey,
    type: summary.kind,
    // Untitled, the client names it by its members.
    name: summary.title ?? "",
    members: [...summary.members],
    ...(summary.placeId ? { placeId: summary.placeId } : {}),
  };
}

/** No address: an observed chat can be read, never written to. */
function observedChat({
  chat,
  members,
  ended,
  latest,
}: ObservedConversation): ObservedChat {
  return {
    id: chat.id,
    type: chat.kind,
    // An untitled direct chat has no one viewpoint to title it from.
    name: chat.title ?? "",
    members: [...members],
    ...(chat.placeId ? { placeId: chat.placeId } : {}),
    ...(ended ? { ended } : {}),
    ...(latest
      ? {
          lastMessage: {
            text: latest.params.text,
            timestamp: latest.timestamp,
            sequence: latest.sequence,
            senderId: latest.sender,
            senderName: latest.senderName,
            ...(latest.params.type && latest.params.type !== "speech"
              ? { type: latest.params.type }
              : {}),
          },
        }
      : {}),
  };
}

const MAX_STREAM_BACKLOG_BYTES = 8 * 1024 * 1024;

/**
 * The person's HTTP adapter. Who acts comes from the server, never JSON: the
 * operator in their console with the system agent, and everywhere else the
 * character they play. Watching, they read and send nothing of their own.
 */
export function registerMessagingHttp(
  api: OpenClawPluginApi,
  messaging: Messaging,
  agent: (id: string) => Promise<Agent>,
  player: Player,
  options?: {
    readonly broadcaster?: KazusaRealtimeBroadcaster;
    readonly getStatuses?: () => Promise<Record<string, CharacterStatus>>;
    /** Serve `/kazusa/observe/*`: reading chats the player isn't in. */
    readonly observer?: boolean;
  },
): void {
  const getConfig = () => currentConfig(api);
  const { operator } = player;
  const roster = (): ReadonlySet<string> => new Set(listAgentIds(getConfig()));
  const route = createRouteRegistrar(api);
  const systemAgent = () => systemAgentOf(getConfig());
  /**
   * Who a request acts as, and the members it names besides them. The operator
   * in their console with the system agent: its session, a new one naming them
   * among its members, or one to her alone while they play nobody. Everywhere
   * else the character they play, who may have a chat with her of their own.
   */
  const actorFor = async <
    T extends {
      readonly sessionKey?: string;
      readonly members?: readonly string[];
    },
  >(
    target: T,
  ): Promise<{ readonly actor: Actor; readonly target: T }> => {
    if (target.sessionKey) {
      // The operator's keys carry no owner: theirs is only ever the console.
      if (parseChatSession(target.sessionKey).owner === undefined)
        return { actor: operator, target };
    }
    // Read once: a switch landing mid-request never mixes two of them.
    const playing = await player.playing();
    if (!target.sessionKey && target.members) {
      const named = target.members.includes(operator.id);
      const others = target.members.filter((id) => id !== operator.id);
      const console = systemAgent();
      if (
        console &&
        others.length === 1 &&
        others[0] === console &&
        (named || !playing)
      )
        return { actor: operator, target: { ...target, members: others } };
      if (named) throw new Error("Only the system agent talks with you.");
    }
    if (!playing) throw new WatchingError();
    return { actor: playing, target };
  };
  /** Whoever of the operator and their character is in this chat. */
  const viewerOf = async (chatId: string): Promise<string> => {
    const members = await messaging.membersOf(chatId);
    return (await player.actorIn(members))?.id ?? operator.id;
  };
  /** The people whose chats the person sees as their own, given who they play. */
  const viewersOf = (playing: Actor | undefined): string[] =>
    playing ? [operator.id, playing.id] : [operator.id];
  route("chats", "GET", async (req, res) => {
    const query =
      new URL(req.url ?? "/", "http://localhost").searchParams.get("query") ??
      undefined;
    const playing = await player.playing();
    const listed = await Promise.all(
      viewersOf(playing).map(async (viewer) =>
        (await messaging.listChats(viewer, LIST_CHATS.parse({ query }))).map(
          (summary) => ({ summary, viewer }),
        ),
      ),
    );
    // A chat both of them are in is listed once, from the operator's side, as
    // `viewerOf` reads it.
    const seen = new Set<string>();
    const once = listed.flat().filter(({ summary, viewer }) => {
      const id = conversationId(viewer, summary.sessionKey);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    const chats = await Promise.all(
      once.map(async ({ summary, viewer }) => {
        const chat = clientChat(summary, viewer);
        const history = await messaging.getChatHistory({
          chatId: chat.id,
          userId: viewer,
          limit: 1,
        });
        const latest = history.messages[0];
        if (latest)
          chat.lastMessage = {
            text: latest.text,
            timestamp: latest.timestamp,
            sequence: latest.sequence,
            senderId: latest.senderId,
            senderName: latest.senderName,
            ...(latest.type ? { type: latest.type } : {}),
          };
        return chat;
      }),
    );
    sendJson(res, 200, {
      operator,
      player: playing ?? null,
      chats,
    } satisfies ChatsResponse);
  });
  route("messages", "GET", async (req, res) => {
    const params = HISTORY.parse(
      Object.fromEntries(
        new URL(req.url ?? "/", "http://localhost").searchParams,
      ),
    );
    sendJson(
      res,
      200,
      await messaging.getChatHistory({
        ...params,
        userId: await viewerOf(params.chatId),
      }),
    );
  });
  if (options?.observer) {
    route("observe/chats", "GET", async (_req, res) => {
      const chats = await messaging.observeChats(
        viewersOf(await player.playing()),
      );
      sendJson(res, 200, {
        chats: chats.map(observedChat),
      } satisfies ObservedChatsResponse);
    });
    route("observe/messages", "GET", async (req, res) => {
      sendJson(
        res,
        200,
        await messaging.observeChatHistory(
          HISTORY.parse(
            Object.fromEntries(
              new URL(req.url ?? "/", "http://localhost").searchParams,
            ),
          ),
        ),
      );
    });
  }
  route("send", "POST", async (req, res) => {
    const { actor, target: params } = await actorFor(
      DELIVERY_REQUEST.parse(await readJsonBody(req)),
    );
    const result = await messaging.send(
      actor.id,
      actor.name,
      params,
      undefined,
      roster(),
      actor.id !== operator.id,
    );
    sendJson(res, 200, {
      chatId: result.chatId,
      sessionKey: result.sessionKey,
      message: result.message,
      status: result.status,
    } satisfies SendResponse);
  });
  route("chats/manage", "POST", async (req, res) => {
    const params = MANAGE_CHAT.parse(await readJsonBody(req));
    const actor = await player.playing();
    if (!actor) throw new WatchingError();
    const summary = await messaging.manageChat(
      actor.id,
      params,
      undefined,
      roster(),
    );
    sendJson(res, 200, {
      chat: clientChat(summary, actor.id),
    } satisfies ManageChatResponse);
  });
  route("agents", "GET", async (_req, res) => {
    const config = getConfig();
    const agents = await Promise.all(
      listAgentIds(config).map(async (id) => {
        try {
          return {
            ...(await agent(id)),
            isSystemAgent: id === config.agents?.defaults?.systemAgent?.agentId,
          };
        } catch {
          return {
            id,
            name: id,
            isSystemAgent: id === config.agents?.defaults?.systemAgent?.agentId,
          };
        }
      }),
    );
    sendJson(res, 200, { agents } satisfies AgentsResponse);
  });
  route("typing", "POST", async (req, res) => {
    const params = TYPING.parse(await readJsonBody(req));
    const { actor } = await actorFor(params);
    await messaging.setTyping(
      actor.id,
      actor.name,
      params.sessionKey,
      params.isTyping && "typing",
      undefined,
      undefined,
      true,
    );
    sendJson(res, 200, { success: true });
  });
  route("events", "GET", async (_req, res) => {
    // Subscribe before awaiting the snapshot, then replay changes after it.
    // This closes the connect/read race without a retained event log.
    const buffered: StreamEvent[] = [];
    let ready = false;
    const send = (chunk: string): void => {
      if (res.destroyed || res.writableEnded) return;
      // A full socket buffer only asks for patience. A client that stays behind
      // is dropped instead of held in memory; it reconnects and catches up.
      if (res.writableLength > MAX_STREAM_BACKLOG_BYTES) res.destroy();
      else res.write(chunk);
    };
    const write = (event: StreamEvent): void => {
      if (!ready) {
        buffered.push(event);
        return;
      }
      send(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    };
    // Who they see as themselves, read per event: they may switch mid-stream.
    const own = (audience: readonly string[]) => player.owns(audience);
    const unsubscribeMessaging = messaging.onAnyEvent((event) => {
      if (event.type === "message") {
        if (own(event.delivery.audience))
          write({
            type: "message",
            chatId: event.delivery.chatId,
            message: clientMessage(event.delivery),
          });
      } else if (own(event.audience)) {
        write(
          event.type === "typing"
            ? event.typing
            : event.type === "read"
              ? event.read
              : { type: "chats" },
        );
      }
    });
    const unsubscribeBroadcaster = options?.broadcaster?.subscribe(write);

    const heartbeat = setInterval(() => {
      if (ready) send(": keepalive\n\n");
    }, 25_000);
    heartbeat.unref();
    // Without a listener, a failed write takes the whole Gateway down.
    res.on("error", (error) => {
      api.logger.warn(`Event stream failed: ${String(error)}`);
    });
    res.on("close", () => {
      unsubscribeMessaging();
      unsubscribeBroadcaster?.();
      clearInterval(heartbeat);
    });
    try {
      const typing = options?.observer
        ? await messaging.getTyping()
        : (
            await Promise.all(
              viewersOf(await player.playing()).map((viewer) =>
                messaging.getTyping(viewer),
              ),
            )
          ).flat();
      const statuses = options?.getStatuses
        ? await options.getStatuses()
        : undefined;
      if (res.destroyed) return;
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      });
      ready = true;
      write({ type: "connected", typing, statuses });
      for (const event of buffered) write(event);
    } catch (error) {
      unsubscribeMessaging();
      unsubscribeBroadcaster?.();
      clearInterval(heartbeat);
      throw error;
    }
  });
}
