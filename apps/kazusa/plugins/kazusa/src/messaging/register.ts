import { currentConfig } from "../current-config.ts";
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
import { characterName, personName } from "../identity.ts";
import { localAvatarUrl } from "../characters/avatar.ts";
import { z } from "zod";
import { untilRunning, type Clock } from "../clock/clock.ts";
import { shutdownSignal } from "../shutdown.ts";
import { describeTool, pluginSkillText } from "../skill-text.ts";
import type { Perception } from "../perception/perception.ts";
import {
  Messaging,
  clientMessage,
  createMessagingState,
  messageJournal,
  type MessagingState,
  type MessageDelivery,
  type MessagingDeps,
  type OutboxPlan,
} from "./messaging.ts";
import {
  AGENT_ID,
  LIST_CHATS,
  MANAGE_CHAT,
  isUser,
  readAs,
  sendMessageSchema,
  type ChatConversation,
} from "./conversations.ts";

/** `plugins.entries.kazusa.config.messaging`. */
const MESSAGING_CONFIG = z.strictObject({
  /** Bubbles (said or done) one `send_message` may carry. */
  maxBubbles: z.number().int().min(1).max(32).default(9),
});

/**
 * One world per process: every registration's Messaging shares conversations,
 * active deliveries and their queue (like the clock cell).
 */
const SHARED_MESSAGING_STATE = Symbol.for("kazusa.messaging.state");

function sharedMessagingState(): MessagingState {
  const scope = globalThis as { [SHARED_MESSAGING_STATE]?: MessagingState };
  return (scope[SHARED_MESSAGING_STATE] ??= createMessagingState());
}

/** Read optional roster presentation without changing canonical authorship. */
async function rosterAgent(
  api: OpenClawPluginApi,
  agentId: string,
  config: OpenClawConfig,
): Promise<Agent> {
  const agent: Agent = {
    id: agentId,
    name: await characterName(api, config, agentId),
  };
  try {
    const text = await readFile(
      path.join(
        api.runtime.agent.resolveAgentWorkspaceDir(config, agentId),
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
  agent.avatarUrl ??= await localAvatarUrl(api, agentId, config);
  return agent;
}

/**
 * Bind conversation policy to the installed OpenClaw SDK: retained state owns
 * canonical messages and membership, native sessions hold private projections,
 * and Perception receives committed messages. Register discovery, sending and
 * group management together so agents never need to reconstruct membership.
 */
import type { CharacterStatus } from "@kazusa/client";
import { withJournalSeq, type KazusaRealtimeBroadcaster } from "../realtime.ts";

export function registerMessaging(
  api: OpenClawPluginApi,
  deps: {
    readonly clock: Pick<Clock, "init" | "time" | "now">;
    readonly perception: Pick<Perception, "receive"> &
      Partial<Pick<Perception, "onAdopted" | "attachSpeech">>;
    readonly broadcaster?: KazusaRealtimeBroadcaster;
    readonly getStatuses?: () => Promise<Record<string, CharacterStatus>>;
    /** Let the player read chats they aren't in (`observer.enabled`). */
    readonly observer?: boolean;
    /** Where a participant stands, for speaking aloud. */
    readonly placeOf?: MessagingDeps["placeOf"];
    /** Lets go of anything frozen on a paused clock; the process's shutdown. */
    readonly release?: AbortSignal;
  },
): Messaging {
  const getConfig = () => currentConfig(api);
  const release = deps.release ?? shutdownSignal();
  const messagingConfig = MESSAGING_CONFIG.parse(
    api.pluginConfig?.messaging ?? {},
  );
  const sendMessage = sendMessageSchema(messagingConfig.maxBubbles);
  const text = pluginSkillText(api);
  const messaging = new Messaging({
    api,
    text,
    state: sharedMessagingState(),
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
    release,
    nameOf: (id) => personName(api, id, getConfig()),
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
          content: [{ type: "text", text: readAs(delivery.params) }],
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
    ...(deps.placeOf ? { placeOf: deps.placeOf } : {}),
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
          event: withJournalSeq(messageJournal(event.delivery)),
        });
      }
      if (!deps.observer) return;
      // The player's own chats already reach them by the audience-filtered
      // stream. A chat-list change goes both ways: joining one leaves this list.
      if (event.type === "chats") {
        deps.broadcaster?.broadcast({
          type: "observed",
          event: { type: "chats" },
        });
      } else if (event.type === "typing") {
        if (!event.audience.some(isUser))
          deps.broadcaster?.broadcast({
            type: "observed",
            event: event.typing,
          });
      } else if (!event.delivery.audience.some(isUser)) {
        deps.broadcaster?.broadcast({
          type: "observed",
          event: {
            type: "message",
            chatId: event.delivery.chatId,
            message: clientMessage(event.delivery),
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
      getConfig();
    const agents = new Set(listAgentIds(config));
    if (!agents.has(agentId))
      throw new Error(`Unknown character agent: ${agentId}.`);
    return { agentId, config, agents };
  };

  deps.perception.onAdopted?.(async (delivery) => {
    if (!delivery.sessionKeys?.length) return;
    try {
      const config = getConfig();
      const name = await characterName(api, config, delivery.agentId);
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
      create: (context) => {
        // Their wording is the `kazusa-tools` skill's.
        const worded = <P>(
          name: string,
          parameters: P,
          values: Readonly<Record<string, number>> = {},
        ) =>
          describeTool(text, { name, parameters }, values, {
            ...(context.agentId ? { agentId: context.agentId } : {}),
          });
        return [
          {
            ...worded("send_message", z.toJSONSchema(sendMessage), {
              maxBubbles: messagingConfig.maxBubbles,
            }),
            label: "Send Message",
            // Speech is how characters act on most turns; keep its schema
            // visible instead of behind Tool Search.
            catalogMode: "direct-only",
            async execute(_toolCallId, input: unknown, signal?: AbortSignal) {
              const { agentId, config, agents } = caller(context);
              if (config.agents?.defaults?.systemAgent?.agentId !== agentId)
                await untilRunning(
                  deps.clock,
                  signal ? AbortSignal.any([release, signal]) : release,
                );
              const params = sendMessage.parse(input);
              // Provider call IDs can repeat within one brain session. Each
              // execution accepts a new send; retained delivery/outbox records
              // own retries without another model call.
              const requestId = generateSecureUuid();
              const details = await messaging.speak(
                agentId,
                await characterName(api, config, agentId),
                { ...params, requestId },
                context.assertInvocationCurrent,
                agents,
                config.agents?.defaults?.systemAgent?.agentId,
                signal,
              );
              // Message hashes are bookkeeping, not something the character reads.
              // `status`, `said` and `unsaid` tell an interrupted send; the
              // skills explain them.
              const { messageIds: _messageIds, ...speech } = details;
              return {
                content: [{ type: "text", text: JSON.stringify(speech) }],
                details,
              };
            },
          },
          {
            ...worded("list_chats", z.toJSONSchema(LIST_CHATS)),
            label: "List Chats",
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
            ...worded("manage_chat", {
              type: "object",
              properties: {
                action: {
                  type: "string",
                  enum: ["rename", "add_members", "remove_members", "leave"],
                },
                sessionKey: { type: "string" },
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
            }),
            label: "Manage Group Chat",
            async execute(_id, input: unknown) {
              const { agentId, config, agents } = caller(context);
              if (config.agents?.defaults?.systemAgent?.agentId !== agentId)
                await untilRunning(deps.clock, release);
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
        ];
      },
    },
    { names: ["send_message", "list_chats", "manage_chat"] },
  );

  registerMessagingHttp(
    api,
    messaging,
    (id) => rosterAgent(api, id, getConfig()),
    {
      broadcaster: deps.broadcaster,
      getStatuses: deps.getStatuses,
      ...(deps.observer ? { observer: true } : {}),
    },
  );
  return messaging;
}
