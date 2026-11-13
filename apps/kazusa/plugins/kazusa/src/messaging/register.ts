import { currentConfig } from "../current-config.ts";
import { inBackground } from "../background.ts";
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
import YAML from "yaml";
import type { Agent } from "@kazusa/client";
import { registerMessagingHttp } from "./http.ts";
import { characterName, personName } from "../identity.ts";
import { localAvatarUrl } from "../characters/avatar.ts";
import { z } from "zod";
import { untilRunning, type Clock } from "../clock/clock.ts";
import { shutdownSignal } from "../shutdown.ts";
import { resolveStateDir } from "../state-dir.ts";
import { openMessageDatabase, type MessageStore } from "./message-database.ts";
import { describeTool, pluginSkillText } from "../skill-text.ts";
import { readStickers, stickerText } from "../stickers/stickers.ts";
import { readPortraits } from "../scene/portraits.ts";
import { faceMoods, sayFaces } from "./faces.ts";
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
  type SpeechResult,
} from "./messaging.ts";
import {
  AGENT_ID,
  CREATE_GROUP,
  LIST_CHATS,
  TALK,
  chatAddress,
  MANAGE_CHAT,
  isUser,
  heardAs,
  sendMessageSchema,
  written,
  type ChatConversation,
  type ChatSummary,
} from "./conversations.ts";
import { COMPOSING_RATES } from "./composing.ts";
import { appendLedgerEntry } from "../ledger.ts";

/** `plugins.entries.kazusa.config.messaging`. */
const MESSAGING_CONFIG = z.strictObject({
  /** Bubbles (said or done) one `send_message` may carry. */
  maxBubbles: z.number().int().min(1).max(32).default(9),
  /**
   * What each writing system's characters take per second at an ordinary pace,
   * typed into a chat or said face to face; each person's judged pace scales
   * it.
   */
  rates: z
    .strictObject({
      typing: z
        .strictObject({
          letters: z
            .number()
            .min(0.1)
            .max(20)
            .default(COMPOSING_RATES.typing.letters),
          han: z.number().min(0.1).max(20).default(COMPOSING_RATES.typing.han),
          kana: z
            .number()
            .min(0.1)
            .max(20)
            .default(COMPOSING_RATES.typing.kana),
          hangul: z
            .number()
            .min(0.1)
            .max(20)
            .default(COMPOSING_RATES.typing.hangul),
        })
        .prefault({}),
      speaking: z
        .strictObject({
          letters: z
            .number()
            .min(1)
            .max(50)
            .default(COMPOSING_RATES.speaking.letters),
          han: z.number().min(1).max(50).default(COMPOSING_RATES.speaking.han),
          kana: z
            .number()
            .min(1)
            .max(50)
            .default(COMPOSING_RATES.speaking.kana),
          hangul: z
            .number()
            .min(1)
            .max(50)
            .default(COMPOSING_RATES.speaking.hangul),
        })
        .prefault({}),
    })
    .prefault({}),
});

/**
 * One world per process: every registration's Messaging shares conversations,
 * active deliveries and their queue (like the clock cell).
 */
const SHARED_MESSAGING_STATE = Symbol.for("kazusa.messaging.state");

function sharedMessagingState(): MessagingState {
  const scope = globalThis as { [SHARED_MESSAGING_STATE]?: MessagingState };
  const state = (scope[SHARED_MESSAGING_STATE] ??= createMessagingState());
  // Left by an older version of this code in the same process: fill in what
  // it didn't have, keeping what it holds.
  const fresh = createMessagingState();
  for (const key of Object.keys(fresh) as (keyof MessagingState)[])
    if (!(key in state)) Object.assign(state, { [key]: fresh[key] });
  return state;
}

/**
 * What a character reads back from `send_message`: whether it went out and,
 * when cut off, how many bubbles were said and what was heard of the one cut
 * short. Its words are in its own call already; repeating them costs tokens.
 */
export function speechReply(result: SpeechResult): Record<string, unknown> {
  if (result.status !== "interrupted") return { status: result.status };
  const said = result.said.length - (result.heard === undefined ? 0 : 1);
  return {
    status: result.status,
    said,
    of: said + result.unsaid.length,
    ...(result.heard === undefined ? {} : { heard: result.heard }),
  };
}

/** A chat `create_group` or `talk` opened, as its starter reads it. */
function opened(chat: ChatSummary) {
  const reply = {
    sessionKey: chatAddress(chat.sessionKey),
    title: chat.title,
    members: chat.members,
  };
  return {
    content: [{ type: "text" as const, text: JSON.stringify(reply) }],
    details: chat,
  };
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
      Partial<
        Pick<
          Perception,
          | "onRead"
          | "attachSpeech"
          | "attachConversations"
          | "judgeSpeech"
          | "speaking"
        >
      >;
    readonly broadcaster?: KazusaRealtimeBroadcaster;
    readonly getStatuses?: () => Promise<Record<string, CharacterStatus>>;
    /** Let the player read chats they aren't in (`observer.enabled`). */
    readonly observer?: boolean;
    /** Where a participant stands, for speaking aloud. */
    readonly placeOf?: MessagingDeps["placeOf"];
    /** Lets go of anything frozen on a paused clock; the process's shutdown. */
    readonly release?: AbortSignal;
    /**
     * Where messages are kept; Kazusa's database in the state folder by
     * default.
     */
    readonly messages?: MessageStore;
    /** A line in a character's own records; `appendLedgerEntry` by default. */
    readonly appendLedger?: (
      entry: Parameters<typeof appendLedgerEntry>[1],
    ) => Promise<void>;
  },
): Messaging {
  const getConfig = () => currentConfig(api);
  const release = deps.release ?? shutdownSignal();
  const messagingConfig = MESSAGING_CONFIG.parse(
    api.pluginConfig?.messaging ?? {},
  );
  const text = pluginSkillText(api);
  const appendLedger =
    deps.appendLedger ?? ((entry) => appendLedgerEntry(api, entry));
  const messaging = new Messaging({
    api,
    text,
    state: sharedMessagingState(),
    store:
      deps.messages ??
      openMessageDatabase({
        path: path.join(resolveStateDir(), "kazusa", "messages.sqlite"),
        legacy: api.runtime.state.openKeyedStore<MessageDelivery>({
          namespace: "messaging",
          retention: "retained",
        }),
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
          content: [{ type: "text", text: heardAs(delivery.params) }],
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
    ...(deps.perception.judgeSpeech
      ? {
          judgeSpeech: deps.perception.judgeSpeech.bind(deps.perception),
        }
      : {}),
    rates: messagingConfig.rates,
    ...(deps.perception.speaking
      ? {
          speaking: (agentId: string) =>
            inBackground(
              api,
              async () => {
                await deps.perception.speaking?.(agentId);
              },
              (error) => api.logger.warn(`Perception: ${String(error)}`),
            ),
        }
      : {}),
    warn: (message) => api.logger.warn(message),
    ...(deps.placeOf ? { placeOf: deps.placeOf } : {}),
  });
  api.lifecycle.onDispose?.(() => messaging.dispose());
  // Steering lands at the next tool boundary; an open send_message is that
  // boundary, so Perception cuts the speaker off and hands what stopped them
  // back with its result.
  deps.perception.attachSpeech?.({
    current: (agentId) => messaging.currentSpeech(agentId),
    interrupt: (agentId, handoff) => messaging.interrupt(agentId, handoff),
  });
  // Attention decides someone stopped following a conversation in person: out
  // of it, and a note in their own records so their next turn knows.
  deps.perception.attachConversations?.({
    tuneOut: async (agentId, conversation) => {
      const left = await messaging.tuneOut(agentId, conversation);
      if (!left) return false;
      const others = left.members.filter((member) => member !== agentId);
      const names = await Promise.all(
        others.map((id) => personName(api, id, getConfig())),
      );
      const who =
        names.length <= 1
          ? (names[0] ?? "")
          : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
      await appendLedger({
        agentId,
        stream: "tasks",
        text: text(
          "kazusa-deliveries#tuned-out",
          { people: who, address: conversation },
          { agentId },
        ),
        timestamp: deps.clock.time(),
      });
      return true;
    },
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
      } else if (
        event.type === "message" &&
        !event.delivery.audience.some(isUser)
      ) {
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

  // What the brain was shown is read: the sender sees a read receipt.
  deps.perception.onRead?.(async (delivery) => {
    try {
      await messaging.markRead(
        delivery.agentId,
        delivery.keys,
        delivery.sessionKeys ?? [],
      );
    } catch (err: unknown) {
      api.logger.warn(`Messaging read receipts error: ${String(err)}`);
    }
  });

  /** A character's own stickers, read again for each turn's tools. */
  const stickersOf = (agentId: string | undefined) =>
    agentId
      ? readStickers(
          api.runtime.agent.resolveAgentWorkspaceDir(getConfig(), agentId),
        )
      : undefined;
  /** The faces a character can give a line: their portraits' moods. */
  const moodsOf = (agentId: string | undefined) =>
    agentId
      ? faceMoods(
          readPortraits(
            api.runtime.agent.resolveAgentWorkspaceDir(getConfig(), agentId),
          ),
        )
      : [];

  api.registerTool(
    {
      contextVersion: 2,
      create: (context) => {
        const skillContext = context.agentId
          ? { agentId: context.agentId }
          : {};
        // Their wording is the `kazusa-tools` skill's.
        const worded = <P>(
          name: string,
          parameters: P,
          values: Readonly<Record<string, number>> = {},
        ) => describeTool(text, { name, parameters }, values, skillContext);
        // Bubbles are plain text. What this character can write into one, a
        // face or a sticker of theirs, is the `{data}` of its wording.
        const stickers = stickersOf(context.agentId);
        const outfits = [...(stickers?.outfits ?? [])];
        const names = [...(stickers?.stickers.keys() ?? [])];
        const offered = moodsOf(context.agentId);
        const sendMessage = sendMessageSchema(
          messagingConfig.maxBubbles,
          [
            ...(offered.length
              ? [
                  text(
                    "kazusa-tools#send_message.faces",
                    { faces: offered.join(", ") },
                    skillContext,
                  ),
                ]
              : []),
            ...(names.length
              ? [
                  text(
                    "kazusa-tools#send_message.stickers",
                    { stickers: names.join(", ") },
                    skillContext,
                  ),
                ]
              : []),
            ...(outfits.length
              ? [
                  text(
                    "kazusa-tools#send_message.sticker-outfits",
                    {
                      outfits: outfits
                        .map(([word, worn]) => `${word}: ${worn}`)
                        .join("; "),
                    },
                    skillContext,
                  ),
                ]
              : []),
          ].join(" "),
        );
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
              const senderName = await characterName(api, config, agentId);
              // What each bubble of text means, then its face as everyone
              // reads it, only as it changes.
              const moods = moodsOf(agentId);
              const aloud = /(?:^|:)chat:huddle:/.test(params.sessionKey);
              const faced = sayFaces(
                params.messages.map((line) => written(line, moods, aloud)),
                messaging.shownFace(agentId, params.sessionKey),
              );
              // A sticker is sent as its description, frozen now.
              const own = stickersOf(agentId);
              const messages = faced.map((bubble) => {
                if (!("sticker" in bubble)) return bubble;
                const sticker = own?.stickers.get(bubble.sticker);
                if (!sticker)
                  throw new Error(`You have no sticker "${bubble.sticker}".`);
                return {
                  text: stickerText(senderName, sticker),
                  type: "sticker" as const,
                  sticker: { name: sticker.name, v: sticker.version },
                };
              });
              // Provider call IDs can repeat within one brain session. Each
              // execution accepts a new send; retained delivery/outbox records
              // own retries without another model call.
              const requestId = generateSecureUuid();
              const details = await messaging.speak(
                agentId,
                senderName,
                { ...params, messages, requestId },
                context.assertInvocationCurrent,
                agents,
                config.agents?.defaults?.systemAgent?.agentId,
                signal,
              );
              return {
                content: [
                  { type: "text", text: JSON.stringify(speechReply(details)) },
                  // What stopped them, read as any delivery is.
                  ...(details.meanwhile === undefined
                    ? []
                    : [{ type: "text" as const, text: details.meanwhile }]),
                ],
                details,
              };
            },
          },
          {
            ...worded("create_group", z.toJSONSchema(CREATE_GROUP)),
            label: "Create Group Chat",
            async execute(_id, input: unknown) {
              const { agentId, config, agents } = caller(context);
              if (config.agents?.defaults?.systemAgent?.agentId !== agentId)
                await untilRunning(deps.clock, release);
              const { members, title } = CREATE_GROUP.parse(input);
              return opened(
                await messaging.createGroup(
                  agentId,
                  members,
                  title ?? null,
                  context.assertInvocationCurrent,
                  agents,
                ),
              );
            },
          },
          {
            ...worded("talk", z.toJSONSchema(TALK)),
            label: "Talk",
            async execute(_id, input: unknown) {
              const { agentId, config } = caller(context);
              if (config.agents?.defaults?.systemAgent?.agentId !== agentId)
                await untilRunning(deps.clock, release);
              return opened(
                await messaging.talk(
                  agentId,
                  TALK.parse(input).members,
                  context.assertInvocationCurrent,
                ),
              );
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
              const chats = result.map((chat) => ({
                ...chat,
                sessionKey: chatAddress(chat.sessionKey),
              }));
              return {
                content: [{ type: "text", text: JSON.stringify(chats) }],
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
              const chat = {
                ...result,
                sessionKey: chatAddress(result.sessionKey),
              };
              return {
                content: [{ type: "text", text: JSON.stringify(chat) }],
                details: result,
              };
            },
          },
        ];
      },
    },
    {
      names: [
        "send_message",
        "create_group",
        "talk",
        "list_chats",
        "manage_chat",
      ],
    },
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
