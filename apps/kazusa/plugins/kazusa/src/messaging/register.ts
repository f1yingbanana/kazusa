import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { listAgentIds } from "openclaw/plugin-sdk/agent-scope-runtime";
import {
  generateSecureUuid,
  type OpenClawConfig,
  type OpenClawPluginApi,
  type OpenClawPluginToolContext,
} from "openclaw/plugin-sdk/core";
import {
  appendSessionTranscriptMessageByIdentityStrict,
  publishSessionTranscriptUpdateByIdentity,
} from "openclaw/plugin-sdk/session-transcript-runtime";
import YAML from "yaml";
import { z } from "zod";
import type { Clock } from "../clock/clock.ts";
import type { Perception } from "../perception/perception.ts";
import { Messaging, type MessageDelivery } from "./messaging.ts";
import {
  AGENT_ID,
  SEND_MESSAGE,
  LIST_CHATS,
  MANAGE_CHAT,
  isUser,
  messagingId,
  type ChatConversation,
} from "./conversations.ts";

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(
      typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Buffer),
    );
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw.trim() ? JSON.parse(raw) : {};
}

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}

const IDENTITY = z.object({
  agent_id: AGENT_ID.optional(),
  name: z.string().trim().min(1),
});

/**
 * Resolve a character's display label from native identity or its own
 * workspace. Authorship always comes from the tool context; neither this label
 * nor file metadata can change which character is sending the message.
 */
async function senderName(
  api: OpenClawPluginApi,
  config: OpenClawConfig,
  agentId: string,
): Promise<string> {
  const configured = api.runtime.agent
    .resolveAgentIdentity(config, agentId)
    ?.name?.trim();
  if (configured) return configured;
  const workspace = api.runtime.agent.resolveAgentWorkspaceDir(config, agentId);
  try {
    const text = await readFile(path.join(workspace, "IDENTITY.md"), "utf8");
    const frontmatter = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    if (!frontmatter) return agentId;
    const identity = IDENTITY.parse(YAML.parse(frontmatter[1]));
    if (identity.agent_id && identity.agent_id !== agentId)
      throw new Error("Character identity does not match the sending agent.");
    return identity.name;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return agentId;
    throw error;
  }
}

/**
 * Bind conversation policy to the installed OpenClaw SDK: retained state owns
 * canonical messages and membership, native sessions hold private projections,
 * and Perception receives committed messages. Register discovery, sending and
 * group management together so agents never need to reconstruct membership.
 */
export function registerMessaging(
  api: OpenClawPluginApi,
  deps: {
    readonly clock: Pick<Clock, "init" | "time">;
    readonly perception: Pick<Perception, "receive">;
  },
): Messaging {
  const messaging = new Messaging({
    store: api.runtime.state.openKeyedStore<MessageDelivery>({
      namespace: "messaging",
      retention: "retained",
    }),
    conversations: api.runtime.state.openKeyedStore<ChatConversation>({
      namespace: "chats",
      retention: "retained",
    }),
    clock: deps.clock,
    /** Create or label a passive ledger; this never starts an agent turn. */
    ensureSession: async (copy, title) => {
      messaging.assertCurrent();
      const now = Date.now();
      // OpenClaw 2026.10.5 exposes only this guarded entry-patch API. On an SDK
      // upgrade, use prepareSessionEntryPatch (prepare + authority); the rolling
      // migration guide deprecates this method, but neither replacement ships
      // in the installed runtime or declarations yet.
      const entry = await api.runtime.agent.session.patchSessionEntry({
        agentId: copy.agentId,
        sessionKey: copy.sessionKey,
        assertCommitAllowed: messaging.assertCurrent,
        fallbackEntry: { sessionId: "", updatedAt: now },
        preserveActivity: true,
        update: (current) => {
          messaging.assertCurrent();
          if (!current.sessionId?.trim())
            return {
              sessionId: generateSecureUuid(),
              updatedAt: now,
              displayName: title,
            };
          return current.displayName === title ? null : { displayName: title };
        },
      });
      const sessionId = entry?.sessionId?.trim();
      if (!sessionId)
        throw new Error(`Could not initialize chat ledger ${copy.sessionKey}.`);
      return sessionId;
    },
    /** Commit one attributed private copy with its original simulation time. */
    append: async (delivery, copy) => {
      messaging.assertCurrent();
      if (!copy.sessionId)
        throw new Error("Chat ledger has no session identity.");
      const appended = await appendSessionTranscriptMessageByIdentityStrict({
        agentId: copy.agentId,
        sessionKey: copy.sessionKey,
        sessionId: copy.sessionId,
        preparation: { source: messaging.assertCurrent },
        message: {
          role: copy.role,
          content: [{ type: "text", text: delivery.params.text }],
          timestamp: delivery.timestamp,
          idempotencyKey: `kazusa:message:${delivery.id}:${copy.agentId}`,
          __openclaw: {
            senderId: delivery.sender,
            senderName: delivery.senderName,
            senderIdentity: {
              type: "observation",
              id: delivery.sender,
              pluginId: "kazusa",
              accountId: null,
              senderKind: "bot",
            },
          },
        },
      });
      if (appended.kind !== "result")
        throw new Error(
          `Chat ledger append ${appended.kind}: ${copy.sessionKey}.`,
        );
      return appended.result.messageId;
    },
    /**
     * Publish only a native committed receipt; Perception is notified
     * separately.
     */
    publish: async (copy) => {
      messaging.assertCurrent();
      if (!copy.sessionId || !copy.messageId)
        throw new Error("Cannot publish an uncommitted chat message.");
      await publishSessionTranscriptUpdateByIdentity({
        agentId: copy.agentId,
        sessionKey: copy.sessionKey,
        sessionId: copy.sessionId,
        update: { messageId: copy.messageId },
      });
    },
    receive: (agentId, stimulus) => deps.perception.receive(agentId, stimulus),
    warn: (message) => api.logger.warn(message),
  });
  api.lifecycle.onDispose?.(() => messaging.dispose());
  api.registerService({
    id: "kazusa-messaging",
    start: () => messaging.resume(),
    stop: () => messaging.dispose(),
  });
  /** Capture the runtime's caller and roster, never model-supplied authorship. */
  const caller = (
    context: OpenClawPluginToolContext<2>,
  ): {
    agentId: string;
    config: OpenClawConfig;
    agents: ReadonlySet<string>;
  } => {
    context.assertInvocationCurrent();
    const agentId = AGENT_ID.parse(context.agentId);
    if (context.sessionKey !== `agent:${agentId}:brain`)
      throw new Error(
        "Messaging tools require the caller's brain execution context.",
      );
    const config =
      context.getRuntimeConfig?.() ??
      context.runtimeConfig ??
      context.config ??
      api.config;
    const agents = new Set(listAgentIds(config));
    if (!agents.has(agentId))
      throw new Error(`Unknown character agent: ${agentId}.`);
    return { agentId, config, agents };
  };

  api.registerTool(
    {
      contextVersion: 2,
      create: (context) => [
        {
          name: "send_message",
          label: "Send Message",
          description:
            "Send dialogue to an existing chat with sessionKey. To start a chat and send its first message in one call, supply members (other agent IDs) and an optional title instead. One other member without a title opens the direct chat; otherwise create a group. Delivery retries automatically; another tool call sends another message. Use list_chats when the address is unknown.",
          parameters: z.toJSONSchema(SEND_MESSAGE),
          async execute(toolCallId, input: unknown) {
            const { agentId, config, agents } = caller(context);
            const params = SEND_MESSAGE.parse(input);
            // A host replay reuses this identity; a new model call is a new send.
            // Session scoping prevents collisions when a brain is reset.
            const sessionId = z.string().trim().min(1).parse(context.sessionId);
            const callId = z.string().trim().min(1).parse(toolCallId);
            const requestId = messagingId([sessionId, callId]);
            const result = await messaging.send(
              agentId,
              await senderName(api, config, agentId),
              { ...params, requestId },
              context.assertInvocationCurrent,
              agents,
            );
            return {
              content: [{ type: "text", text: JSON.stringify(result) }],
              details: result,
            };
          },
        },
        {
          name: "list_chats",
          label: "List Chats",
          description:
            "Find your current direct and group chats by optional title, member ID or session key query. Returns your reply address, title and current members without reading anyone else's history. A chat address already present in context can be used directly.",
          parameters: z.toJSONSchema(LIST_CHATS),
          async execute(_id, input: unknown) {
            const { agentId } = caller(context);
            const result = await messaging.listChats(
              agentId,
              LIST_CHATS.parse(input),
              context.assertInvocationCurrent,
            );
            return {
              content: [{ type: "text", text: JSON.stringify(result) }],
              details: { chats: result },
            };
          },
        },
        {
          name: "manage_chat",
          label: "Manage Group Chat",
          description:
            "Any current group member can rename the group, add or remove members, or leave. Use title for rename, members for add_members/remove_members, and neither for leave. Direct chats have fixed membership. Changes affect future messages; earlier accepted messages keep their original audience. Joining grants no prior history.",
          parameters: {
            type: "object",
            properties: {
              action: {
                type: "string",
                enum: ["rename", "add_members", "remove_members", "leave"],
              },
              sessionKey: {
                type: "string",
                description:
                  "Your group chat session key, from context or list_chats.",
              },
              members: {
                type: "array",
                items: { type: "string" },
                minItems: 1,
                maxItems: 99,
                uniqueItems: true,
              },
              title: { type: "string", minLength: 1, maxLength: 160 },
            },
            required: ["action", "sessionKey"],
            additionalProperties: false,
          },
          async execute(_id, input: unknown) {
            const { agentId, agents } = caller(context);
            const result = await messaging.manageChat(
              agentId,
              MANAGE_CHAT.parse(input),
              context.assertInvocationCurrent,
              agents,
            );
            return {
              content: [{ type: "text", text: JSON.stringify(result) }],
              details: result,
            };
          },
        },
      ],
    },
    { names: ["send_message", "list_chats", "manage_chat"] },
  );

  api.registerHttpRoute?.({
    path: "/kazusa/chats",
    auth: "gateway",
    match: "exact",
    handler: async (req, res) => {
      try {
        const url = new URL(req.url ?? "/", "http://localhost");
        const userId = url.searchParams.get("userId");
        if (!userId) {
          sendJson(res, 400, {
            error: "Missing required query parameter: userId",
          });
          return true;
        }
        const query = url.searchParams.get("query") ?? undefined;
        const chats = await messaging.listChats(userId, { query });
        sendJson(res, 200, { chats });
        return true;
      } catch (error) {
        sendJson(res, 400, {
          error: error instanceof Error ? error.message : String(error),
        });
        return true;
      }
    },
  });

  api.registerHttpRoute?.({
    path: "/kazusa/messages",
    auth: "gateway",
    match: "exact",
    handler: async (req, res) => {
      try {
        const url = new URL(req.url ?? "/", "http://localhost");
        const chatId = url.searchParams.get("chatId");
        const userId = url.searchParams.get("userId");
        if (!chatId || !userId) {
          sendJson(res, 400, {
            error: "Missing required query parameters: chatId and userId",
          });
          return true;
        }
        const beforeParam = url.searchParams.get("before");
        const before = beforeParam !== null ? Number(beforeParam) : undefined;
        const limitParam = url.searchParams.get("limit");
        const limit = limitParam !== null ? Number(limitParam) : undefined;

        const result = await messaging.getChatHistory({
          chatId,
          userId,
          before: Number.isNaN(before) ? undefined : before,
          limit: Number.isNaN(limit) ? undefined : limit,
        });
        sendJson(res, 200, result);
        return true;
      } catch (error) {
        sendJson(res, 400, {
          error: error instanceof Error ? error.message : String(error),
        });
        return true;
      }
    },
  });

  api.registerHttpRoute?.({
    path: "/kazusa/send",
    auth: "gateway",
    match: "exact",
    handler: async (req, res) => {
      try {
        if (req.method !== "POST") {
          sendJson(res, 405, { error: "Method not allowed. Use POST." });
          return true;
        }
        const body = (await readJsonBody(req)) as Record<string, unknown>;
        const sender = z.string().trim().min(1).parse(body.sender);
        const text = z.string().trim().min(1).parse(body.text);
        const sessionKey =
          typeof body.sessionKey === "string" ? body.sessionKey : undefined;
        const members = Array.isArray(body.members)
          ? (body.members as string[])
          : undefined;
        const title = typeof body.title === "string" ? body.title : undefined;
        const senderName =
          typeof body.senderName === "string" && body.senderName.trim()
            ? body.senderName.trim()
            : isUser(sender)
              ? "Sensei"
              : sender;

        const requestId = generateSecureUuid();
        const config = api.config;
        const agents = new Set(listAgentIds(config));

        const result = await messaging.send(
          sender,
          senderName,
          {
            sessionKey,
            members,
            title,
            text,
            requestId,
          },
          undefined,
          agents,
        );
        sendJson(res, 200, result);
        return true;
      } catch (error) {
        sendJson(res, 400, {
          error: error instanceof Error ? error.message : String(error),
        });
        return true;
      }
    },
  });

  api.registerHttpRoute?.({
    path: "/kazusa/chats/manage",
    auth: "gateway",
    match: "exact",
    handler: async (req, res) => {
      try {
        if (req.method !== "POST") {
          sendJson(res, 405, { error: "Method not allowed. Use POST." });
          return true;
        }
        const { userId, ...rest } = (await readJsonBody(req)) as Record<
          string,
          unknown
        >;
        const parsedUserId = z.string().trim().min(1).parse(userId);
        const params = MANAGE_CHAT.parse(rest);
        const config = api.config;
        const agents = new Set(listAgentIds(config));

        const result = await messaging.manageChat(
          parsedUserId,
          params,
          undefined,
          agents,
        );
        sendJson(res, 200, result);
        return true;
      } catch (error) {
        sendJson(res, 400, {
          error: error instanceof Error ? error.message : String(error),
        });
        return true;
      }
    },
  });

  return messaging;
}
