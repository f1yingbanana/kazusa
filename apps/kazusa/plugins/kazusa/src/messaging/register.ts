import { readFile } from "node:fs/promises";
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
import { parseAgentSessionKey } from "openclaw/plugin-sdk/routing";
import YAML from "yaml";
import type { Agent } from "@kazusa/client";
import { registerMessagingHttp } from "./http.ts";
import { z } from "zod";
import type { Clock } from "../clock/clock.ts";
import type { Perception } from "../perception/perception.ts";
import {
  Messaging,
  type MessageDelivery,
  type OutboxPlan,
} from "./messaging.ts";
import {
  AGENT_ID,
  SEND_MESSAGE,
  LIST_CHATS,
  MANAGE_CHAT,
  isUser,
  messagingId,
  type ChatConversation,
} from "./conversations.ts";

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

/** Read optional roster presentation without changing canonical authorship. */
async function rosterAgent(
  api: OpenClawPluginApi,
  agentId: string,
): Promise<Agent> {
  const agent: Agent = {
    id: agentId,
    name: await senderName(api, api.config, agentId),
  };
  try {
    const text = await readFile(
      path.join(
        api.runtime.agent.resolveAgentWorkspaceDir(api.config, agentId),
        "IDENTITY.md",
      ),
      "utf8",
    );
    const frontmatter = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    if (frontmatter) {
      const presentation = z
        .object({ avatarUrl: z.string().optional() })
        .parse(YAML.parse(frontmatter[1]));
      if (presentation.avatarUrl) agent.avatarUrl = presentation.avatarUrl;
    }
  } catch {
    /* Optional avatar metadata does not block roster discovery. */
  }
  return agent;
}

/**
 * Bind conversation policy to the installed OpenClaw SDK: retained state owns
 * canonical messages and membership, native sessions hold private projections,
 * and Perception receives committed messages. Register discovery, sending and
 * group management together so agents never need to reconstruct membership.
 */
import type { CharacterStatus } from "@kazusa/client";
import { nextJournalSeq, type KazusaRealtimeBroadcaster } from "../realtime.ts";

export function registerMessaging(
  api: OpenClawPluginApi,
  deps: {
    readonly clock: Pick<Clock, "init" | "time" | "now">;
    readonly perception: Pick<Perception, "receive"> &
      Partial<Pick<Perception, "onAdopted" | "attachSpeech">>;
    readonly broadcaster?: KazusaRealtimeBroadcaster;
    readonly getStatuses?: () => Promise<Record<string, CharacterStatus>>;
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
    outbox: api.runtime.state.openKeyedStore<OutboxPlan>({
      namespace: "outbox",
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
          // Every chat line is an observation attributed by senderIdentity, the
          // character's own included: the native catalog projects sender
          // identity only for user-role rows, so assistant rows read back as
          // unattributed.
          role: "user",
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
              senderKind: isUser(delivery.sender) ? "human" : "bot",
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
  // Steering lands at the next tool boundary; an open send_message is that
  // boundary, so Perception must be able to cut the speaker off.
  deps.perception.attachSpeech?.({
    current: (agentId) => messaging.currentSpeech(agentId),
    interrupt: (agentId) => messaging.interrupt(agentId),
  });
  if (deps.broadcaster) {
    const unsubscribeJournal = messaging.onEvent((event) => {
      if (event.type === "message") {
        deps.broadcaster?.broadcast({
          type: "journal",
          event: {
            seq: nextJournalSeq(),
            simTime: event.delivery.timestamp,
            kind: "message.sent",
            actors: [event.delivery.sender, ...event.delivery.audience],
            chatId: event.delivery.chatId,
            payload: {
              messageId: event.delivery.id,
              sequence: event.delivery.sequence,
              senderId: event.delivery.sender,
              preview: event.delivery.params.text.slice(0, 100),
            },
          },
        });
      }
    });
    api.lifecycle.onDispose?.(unsubscribeJournal);
  }
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

  deps.perception.onAdopted?.(async (delivery) => {
    if (!delivery.sessionKeys?.length) return;
    try {
      const config = api.config;
      const name = await senderName(api, config, delivery.agentId);
      for (const sessionKey of delivery.sessionKeys) {
        await messaging.setTyping(
          delivery.agentId,
          name,
          sessionKey,
          true,
          delivery.id,
        );
      }
    } catch (err: unknown) {
      api.logger.warn(`Messaging auto-typing error: ${String(err)}`);
    }
  });

  const activeRuns = new Map<string, string>();
  api.agent.events.registerAgentEventSubscription({
    id: "messaging-typing",
    streams: ["lifecycle"],
    handle(event) {
      const owner = parseAgentSessionKey(event.sessionKey ?? "");
      const data = z
        .object({ phase: z.enum(["start", "end", "error"]) })
        .safeParse(event.data);
      if (!owner || owner.rest !== "brain" || !data.success) return;
      if (data.data.phase === "start") {
        activeRuns.set(owner.agentId, event.runId);
        messaging.clearTyping(owner.agentId, undefined, undefined, event.runId);
      } else {
        messaging.clearTyping(owner.agentId, event.runId);
        if (activeRuns.get(owner.agentId) === event.runId)
          activeRuns.delete(owner.agentId);
      }
    },
  });

  api.registerTool(
    {
      contextVersion: 2,
      create: (context) => [
        {
          name: "send_message",
          label: "Send Message",
          // Speech is how characters act on most turns; keep its schema
          // visible instead of behind Tool Search.
          catalogMode: "direct-only",
          description:
            "Say something in an existing chat with sessionKey. To start a chat and send its first message in one call, supply members (other agent or human IDs) and an optional title instead. One other member without a title opens the direct chat; otherwise create a group. Split what you say into natural chat bubbles in messages; they are typed and sent one at a time. If something more important comes up meanwhile, you stop: the result lists what was said and what was left unsaid. Delivery retries automatically. Use list_chats when the address is unknown.",
          parameters: z.toJSONSchema(SEND_MESSAGE),
          async execute(toolCallId, input: unknown) {
            const { agentId, config, agents } = caller(context);
            const params = SEND_MESSAGE.parse(input);
            // A host replay reuses this identity; a new model call is a new send.
            // Session scoping prevents collisions when a brain is reset.
            const sessionId = z.string().trim().min(1).parse(context.sessionId);
            const callId = z.string().trim().min(1).parse(toolCallId);
            const requestId = messagingId([sessionId, callId]);
            const details = await messaging.speak(
              agentId,
              await senderName(api, config, agentId),
              { ...params, requestId },
              context.assertInvocationCurrent,
              agents,
            );
            // Message hashes are bookkeeping, not something the character reads.
            const { messageIds: _messageIds, ...speech } = details;
            const result =
              speech.status === "interrupted"
                ? {
                    ...speech,
                    note: "You stopped before the unsaid bubbles; nobody saw them.",
                  }
                : speech;
            return {
              content: [{ type: "text", text: JSON.stringify(result) }],
              details,
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

  registerMessagingHttp(api, messaging, (id) => rosterAgent(api, id), {
    broadcaster: deps.broadcaster,
    getStatuses: deps.getStatuses,
  });
  return messaging;
}
