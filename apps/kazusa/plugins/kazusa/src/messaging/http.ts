import { currentConfig } from "../current-config.ts";
import type { IncomingMessage, ServerResponse } from "node:http";
import { listAgentIds } from "openclaw/plugin-sdk/agent-scope-runtime";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { z } from "zod";
import { readJsonBodyWithLimit } from "openclaw/plugin-sdk/webhook-request-guards";
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
import { checkAuth, resolveAuthToken } from "../http/helpers.ts";
import type { KazusaRealtimeBroadcaster } from "../realtime.ts";
import {
  TYPING,
  DELIVERY_REQUEST,
  LIST_CHATS,
  MANAGE_CHAT,
  conversationId,
  type ChatSummary,
} from "./conversations.ts";
import {
  clientMessage,
  type Messaging,
  type ObservedConversation,
} from "./messaging.ts";

export const USER = z.object({
  id: z
    .string()
    .regex(/^user:[a-z0-9][a-z0-9_-]*$/)
    .default("user:sensei"),
  name: z.string().trim().min(1).default("Sensei"),
});
const HISTORY = z.object({
  chatId: z.string().min(1),
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

/** Read a bounded JSON request; schemas at each route own its contract. */
async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const result = await readJsonBodyWithLimit(req, {
    maxBytes: 256_000,
    timeoutMs: 10_000,
    destroyOnLimit: false,
  });
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify(data));
}

function clientChat(summary: ChatSummary, viewer: string): Chat {
  return {
    id: conversationId(viewer, summary.sessionKey),
    sessionKey: summary.sessionKey,
    type: summary.kind,
    name: summary.title,
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

/** Single-player HTTP adapter. Caller identity comes from config, never JSON. */
export function registerMessagingHttp(
  api: OpenClawPluginApi,
  messaging: Messaging,
  agent: (id: string) => Promise<Agent>,
  options?: {
    readonly broadcaster?: KazusaRealtimeBroadcaster;
    readonly getStatuses?: () => Promise<Record<string, CharacterStatus>>;
    /** Serve `/kazusa/observe/*`: reading chats the player isn't in. */
    readonly observer?: boolean;
  },
): void {
  const getConfig = () => currentConfig(api);
  const user = USER.parse(api.pluginConfig?.user ?? {});
  const roster = (): ReadonlySet<string> => new Set(listAgentIds(getConfig()));
  const expectedToken = resolveAuthToken(api);
  const route = (
    path: string,
    method: "GET" | "POST",
    handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>,
  ): void => {
    api.registerHttpRoute({
      path: `/kazusa/${path}`,
      auth: "plugin",
      match: "exact",
      handler: async (req, res) => {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", `${method}, OPTIONS`);
        res.setHeader(
          "Access-Control-Allow-Headers",
          "Content-Type, Authorization",
        );
        if (req.method === "OPTIONS") {
          res.statusCode = 204;
          res.end();
          return true;
        }
        if (!checkAuth(req, expectedToken)) {
          sendJson(res, 401, {
            error: "Unauthorized: Invalid or missing gateway token.",
          });
          return true;
        }
        if (req.method !== method) {
          res.setHeader("Allow", `${method}, OPTIONS`);
          sendJson(res, 405, { error: `Use ${method}.` });
          return true;
        }
        try {
          await handler(req, res);
        } catch (error) {
          if (res.headersSent) res.end();
          else
            sendJson(res, 400, {
              error: error instanceof Error ? error.message : String(error),
            });
        }
        return true;
      },
    });
  };
  route("chats", "GET", async (req, res) => {
    const query =
      new URL(req.url ?? "/", "http://localhost").searchParams.get("query") ??
      undefined;
    const summaries = await messaging.listChats(
      user.id,
      LIST_CHATS.parse({ query }),
    );
    const chats = await Promise.all(
      summaries.map(async (summary) => {
        const chat = clientChat(summary, user.id);
        const history = await messaging.getChatHistory({
          chatId: chat.id,
          userId: user.id,
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
    sendJson(res, 200, { user, chats } satisfies ChatsResponse);
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
      await messaging.getChatHistory({ ...params, userId: user.id }),
    );
  });
  if (options?.observer) {
    route("observe/chats", "GET", async (_req, res) => {
      const chats = await messaging.observeChats(user.id);
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
    const params = DELIVERY_REQUEST.parse(await readJsonBody(req));
    const result = await messaging.send(
      user.id,
      user.name,
      params,
      undefined,
      roster(),
    );
    sendJson(res, 200, {
      chatId: result.chatId,
      sessionKey: result.sessionKey,
      message: result.message,
      status: result.status,
    } satisfies SendResponse);
  });
  route("chats/manage", "POST", async (req, res) => {
    const summary = await messaging.manageChat(
      user.id,
      MANAGE_CHAT.parse(await readJsonBody(req)),
      undefined,
      roster(),
    );
    sendJson(res, 200, {
      chat: clientChat(summary, user.id),
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
    await messaging.setTyping(
      user.id,
      user.name,
      params.sessionKey,
      params.isTyping,
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
    const unsubscribeMessaging = messaging.onAnyEvent((event) => {
      if (event.type === "message") {
        if (event.delivery.audience.includes(user.id))
          write({
            type: "message",
            chatId: event.delivery.chatId,
            message: clientMessage(event.delivery),
          });
      } else if (event.audience.includes(user.id)) {
        write(event.type === "typing" ? event.typing : { type: "chats" });
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
      const typing = await messaging.getTyping(
        options?.observer ? undefined : user.id,
      );
      const statuses = options?.getStatuses
        ? await options.getStatuses()
        : undefined;
      if (res.destroyed) return;
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*",
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
