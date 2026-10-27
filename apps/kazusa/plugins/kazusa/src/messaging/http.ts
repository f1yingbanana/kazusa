import type { IncomingMessage, ServerResponse } from "node:http";
import { listAgentIds } from "openclaw/plugin-sdk/agent-scope-runtime";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { z } from "zod";
import { readJsonBodyWithLimit } from "openclaw/plugin-sdk/webhook-request-guards";
import type {
  Agent,
  AgentsResponse,
  Chat,
  ChatsResponse,
  ChatStreamEvent,
  ManageChatResponse,
  SendResponse,
} from "@kazusa/client";
import {
  TYPING,
  DELIVERY_REQUEST,
  LIST_CHATS,
  MANAGE_CHAT,
  conversationId,
  type ChatSummary,
} from "./conversations.ts";
import { clientMessage, type Messaging } from "./messaging.ts";

const USER = z.object({
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

function resolveAuthToken(api: OpenClawPluginApi): string | undefined {
  const auth = (
    api.config as {
      gateway?: {
        auth?: {
          token?: string;
        };
      };
    }
  )?.gateway?.auth;
  if (typeof auth?.token === "string" && auth.token.trim().length > 0) {
    return auth.token.trim();
  }
  return undefined;
}

function checkAuth(req: IncomingMessage, expectedToken?: string): boolean {
  if (!expectedToken) return true;
  const authHeader = req.headers.authorization;
  if (authHeader) {
    const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
    if (match && match[1] === expectedToken) return true;
  }
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    const queryToken = url.searchParams.get("token");
    if (queryToken && queryToken === expectedToken) return true;
  } catch {
    // Ignore URL parse errors
  }
  return false;
}

function clientChat(summary: ChatSummary, viewer: string): Chat {
  return {
    id: conversationId(viewer, summary.sessionKey),
    sessionKey: summary.sessionKey,
    type: summary.kind,
    name: summary.title,
    members: [...summary.members],
  };
}

/** Single-player HTTP adapter. Caller identity comes from config, never JSON. */
export function registerMessagingHttp(
  api: OpenClawPluginApi,
  messaging: Messaging,
  agent: (id: string) => Promise<Agent>,
): void {
  const user = USER.parse(api.pluginConfig?.user ?? {});
  const roster = (): ReadonlySet<string> => new Set(listAgentIds(api.config));
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
    const agents = await Promise.all(
      [...roster()].map(async (id) => {
        try {
          return await agent(id);
        } catch {
          return { id, name: id };
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
    const buffered: ChatStreamEvent[] = [];
    let ready = false;
    const write = (event: ChatStreamEvent): void => {
      if (res.destroyed) return;
      if (!ready) {
        buffered.push(event);
        return;
      }
      if (
        !res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
      )
        res.end();
    };
    const unsubscribe = messaging.onEvent((event) => {
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
    const heartbeat = setInterval(() => {
      if (!res.write(": keepalive\n\n")) res.end();
    }, 25_000);
    heartbeat.unref();
    res.on("close", () => {
      unsubscribe();
      clearInterval(heartbeat);
    });
    try {
      const typing = await messaging.getTyping(user.id);
      if (res.destroyed) return;
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*",
      });
      ready = true;
      write({ type: "connected", typing });
      for (const event of buffered) write(event);
    } catch (error) {
      unsubscribe();
      clearInterval(heartbeat);
      throw error;
    }
  });
}
