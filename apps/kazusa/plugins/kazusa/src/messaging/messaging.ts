import { inBackground } from "../background.ts";
import { bundledSkillText, type SkillText } from "../skill-text.ts";
import type {
  ChatMessage,
  MessagesResponse,
  TypingStreamEvent,
} from "@kazusa/client";
import { KeyedAsyncQueue, OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { sleepSim, type Clock } from "../clock/clock.ts";
import { shutdownSignal } from "../shutdown.ts";
import { stickerUrl } from "../stickers/stickers.ts";
import type { CurrentSpeech } from "../perception/types.ts";
import type { RemovableStateStore, StateStore } from "../state.ts";
import type { Stimulus } from "../stimulus.ts";
import {
  Floors,
  SPEECH_RATES,
  cutOff,
  speakingMs,
  type SpeechFacts,
  type SpeechJudgment,
  type SpeechRates,
} from "./floor.ts";
import {
  DELIVERY,
  LIST_CHATS,
  SPEECH_REQUEST,
  bubbleOf,
  readAs,
  MANAGE_CHAT,
  PARTICIPANT_ID,
  chatSummary,
  conversationId,
  isUser,
  messagingId,
  newChatId,
  ownChatSession,
  parseChatSession,
  huddleAddress,
  type ChatConversation,
  type ChatKind,
  type ChatSummary,
  type ManageChatParams,
  type SendMessageParams,
  type SpeechParams,
} from "./conversations.ts";

export interface GetChatHistoryInput {
  readonly chatId: string;
  readonly userId: string;
  readonly before?: number;
  readonly limit?: number;
}

/** A page of any chat's history, whoever heard it. */
export type ObserveHistoryInput = Omit<GetChatHistoryInput, "userId">;

/** A conversation as an observer sees it, from outside. */
export interface ObservedConversation {
  readonly chat: ChatConversation;
  /** Who is in it, or who was, once it has ended. */
  readonly members: readonly string[];
  readonly ended: boolean;
  readonly latest?: MessageDelivery;
}

export interface MessageCopy {
  readonly agentId: string;
  readonly sessionKey: string;
  readonly role: "assistant" | "user";
  sessionId?: string;
  messageId?: string;
  published?: boolean;
  notified?: boolean;
}

/**
 * Permanent canonical message, its acceptance-time audience and projection
 * progress.
 */
export interface MessageDelivery {
  readonly id: string;
  readonly sequence: number;
  readonly sender: string;
  readonly senderName: string;
  readonly chatId: string;
  readonly audience: readonly string[];
  readonly params: SendMessageParams;
  readonly timestamp: number;
  readonly copies: MessageCopy[];
}

export interface SendMessageResult {
  readonly messageId: string;
  readonly status: "delivered" | "pending";
  readonly sessionKey: string;
  readonly recipients: readonly string[];
  readonly chatId: string;
  readonly message: ChatMessage;
}

/**
 * A retained multi-bubble send. It exists only while bubbles may still be
 * unsent; recovery delivers whatever remains.
 */
export interface OutboxPlan {
  readonly id: string;
  readonly sender: string;
  readonly senderName: string;
  readonly params: SpeechParams;
}

export interface SpeechResult {
  readonly status: "delivered" | "pending" | "interrupted";
  readonly sessionKey: string;
  readonly recipients: readonly string[];
  readonly messageIds: readonly string[];
  readonly said: readonly string[];
  readonly unsaid: readonly string[];
  /** A line cut off partway: what was heard of it (also last in `said`). */
  readonly heard?: string;
}

/** A chat whose latest visible message came from someone else. */
/** A chat the participant read, where someone else has spoken since. */
export interface AwaitingReply {
  readonly sessionKey: string;
  readonly sender: string;
  readonly senderName: string;
  readonly timestamp: number;
}

/** A message reference in the participant's own ledger addressing. */
export interface MessageRef {
  readonly id: string;
  readonly sessionKey: string;
}

/**
 * Canonical facts a person weighs before answering: who is in the chat and
 * where the conversation stands for this participant.
 */
export interface ChatFacts {
  readonly sessionKey: string;
  readonly kind: ChatKind;
  readonly title: string | null;
  readonly memberCount: number;
  /** When this participant last spoke here, if ever (simulation time). */
  readonly lastSpokeAt: number | null;
  /** When they last joined it, for a conversation in person, if known. */
  readonly joinedAt?: number | null;
  /** Messages from others since this participant last spoke. */
  readonly unanswered: number;
  /** Simulation time of the oldest of those messages. */
  readonly waitingSince: number | null;
}

/** Simulated texting time before a later bubble: 1s plus 50ms per character. */
export function typingMs(text: string): number {
  return Math.min(8_000, 1_000 + 50 * text.length);
}

interface ConversationTail {
  readonly chat: ChatConversation;
  readonly sessionKey: string;
  lastSpokeAt: number | null;
  since: MessageDelivery[];
}

interface Speech {
  readonly planId: string;
  readonly controller: AbortController;
  readonly params: SpeechParams;
  /** Every bubble to be sent, as the listener reads it. */
  readonly planned: readonly string[];
  readonly said: string[];
  sessionKey?: string;
  /** Settles once it is over, said or stopped: the next send may begin. */
  readonly ended: Promise<void>;
  /**
   * Aborted when the speaker leaves: whatever they were about to say is said on
   * the way out, at once, over whoever is talking.
   */
  readonly hurry: AbortController;
}

export type MessagingEvent =
  | { readonly type: "message"; readonly delivery: MessageDelivery }
  | {
      readonly type: "typing";
      readonly typing: TypingStreamEvent;
      readonly audience: readonly string[];
    }
  | { readonly type: "chats"; readonly audience: readonly string[] };

/** One projection shared by history, send responses and live message events. */
export function clientMessage(
  delivery: MessageDelivery,
  /** The stored record's real time. A receipt stays the same on a retry. */
  createdAt?: number,
): ChatMessage {
  return {
    id: delivery.id,
    requestId: delivery.params.requestId,
    sequence: delivery.sequence,
    senderId: delivery.sender,
    senderName: delivery.senderName,
    text: delivery.params.text,
    ...(delivery.params.type === "action" ? { type: "action" } : {}),
    ...(delivery.params.type === "sticker" && delivery.params.sticker
      ? {
          type: "sticker",
          sticker: {
            name: delivery.params.sticker.name,
            url: stickerUrl(delivery.sender, delivery.params.sticker),
          },
        }
      : {}),
    timestamp: delivery.timestamp,
    ...(createdAt === undefined ? {} : { createdAt }),
  };
}

/** One journal row per canonical message, for history and live events alike. */
export function messageJournal(delivery: MessageDelivery) {
  return {
    simTime: delivery.timestamp,
    kind: "message.sent" as const,
    actors: [...new Set([delivery.sender, ...delivery.audience])],
    chatId: delivery.chatId,
    payload: {
      messageId: delivery.id,
      sequence: delivery.sequence,
      senderId: delivery.sender,
      preview: readAs(delivery.params).slice(0, 100),
    },
  };
}

function isDeliverySettled(delivery: MessageDelivery): boolean {
  return delivery.copies.every(
    (copy) =>
      Boolean(copy.messageId) &&
      Boolean(copy.published) &&
      (copy.role === "assistant" || Boolean(copy.notified)),
  );
}

export interface MessagingDeps {
  readonly api: OpenClawPluginApi;
  /** Where its refusals' wording comes from. Absent: Kazusa's own skills. */
  readonly text?: SkillText;
  readonly store: StateStore<MessageDelivery>;
  readonly conversations: StateStore<ChatConversation>;
  readonly outbox: RemovableStateStore<OutboxPlan>;
  readonly clock: Pick<Clock, "init" | "time" | "now">;
  /**
   * Lets go of speech frozen on a paused clock: the rest is said at once.
   * Defaults to the process's shutdown signal.
   */
  readonly release?: AbortSignal;
  readonly ensureSession: (
    copy: Pick<MessageCopy, "agentId" | "sessionKey">,
    title: string,
  ) => Promise<string>;
  readonly append: (
    delivery: MessageDelivery,
    copy: MessageCopy,
  ) => Promise<string>;
  readonly publish: (copy: MessageCopy) => Promise<void>;
  readonly receive: (agentId: string, stimulus: Stimulus) => Promise<void>;
  readonly warn: (message: string) => void;
  /**
   * Where a participant stands now, or `undefined` while traveling. Huddles
   * need it: you can only speak aloud to people where you are.
   */
  readonly placeOf?: (
    participantId: string,
  ) => Promise<
    { readonly placeId: string; readonly title: string } | undefined
  >;
  /** A participant's display name, for membership lines; defaults to the id. */
  readonly nameOf?: (participantId: string) => Promise<string>;
  /** Shared by every instance in the process; each test gets its own. */
  readonly state?: MessagingState;
  /**
   * How a speaker says what they are about to say aloud: how badly they want in
   * when someone else has the floor, and how fast they talk. Absent or failing:
   * the next pause, at an ordinary pace.
   */
  readonly judgeSpeech?: (
    agentId: string,
    facts: SpeechFacts,
  ) => Promise<SpeechJudgment>;
  /** What each writing system takes to say; default `SPEECH_RATES`. */
  readonly speechRates?: SpeechRates;
}

/** A conversation going on at a place, as others there could see it. */
export interface Huddle {
  readonly address: string;
  readonly members: readonly string[];
}

/**
 * What every plugin instance in one process must see alike. OpenClaw registers
 * the plugin more than once, and agent turns run on their own instance; with a
 * copy each, a huddle left on one instance stayed joined on another.
 */
export interface MessagingState {
  readonly serial: KeyedAsyncQueue;
  readonly deliveries: Map<string, MessageDelivery>;
  readonly chats: Map<string, ChatConversation>;
  readonly notifying: Set<string>;
  readonly flushing: Set<string>;
  /**
   * What each character is saying, in order: the first is being said, and sends
   * started with it (parallel tool calls in one turn) wait behind it. One
   * instance runs the turn's speech while another's Perception steers it and
   * another's outbox flush must leave it be.
   */
  readonly speeches: Map<string, Speech[]>;
  /**
   * Who is typing (or saying a line) where, by `chatId:participantId`. The HTTP
   * instance serves it to clients while turns set it from theirs.
   */
  readonly typing: Map<string, TypingStreamEvent>;
  /**
   * Who hears every instance's events, for as long as they listen: a client's
   * live stream, which outlives the instance that served it.
   */
  readonly streams: Set<(event: MessagingEvent) => void>;
  /** Who is speaking in each huddle, and who waits to. */
  readonly floors: Floors;
  initialized: boolean;
  sequence: number;
}

export function createMessagingState(): MessagingState {
  return {
    serial: new KeyedAsyncQueue(),
    deliveries: new Map(),
    chats: new Map(),
    notifying: new Set(),
    flushing: new Set(),
    speeches: new Map(),
    typing: new Map(),
    streams: new Set(),
    floors: new Floors(),
    initialized: false,
    sequence: 0,
  };
}

/** A send as stored: one form per request, so a retry compares equal. */
function deliveryParams(
  sender: string,
  input: SendMessageParams,
): SendMessageParams {
  PARTICIPANT_ID.parse(sender);
  const params = DELIVERY.parse(input);
  params.members?.sort();
  params.title ??= null;
  if (params.sessionKey) {
    params.sessionKey = ownChatSession(sender, params.sessionKey);
    delete params.members;
    delete params.aloud;
    params.title = null;
  }
  return params;
}

/**
 * Owns canonical messages and conversation membership. Native transcripts are
 * private agent projections; Perception owns attention. One queue serializes
 * membership edits with send acceptance so each message freezes one audience.
 * Brain admission runs outside that queue and never blocks the sending tool.
 */
export class Messaging {
  private readonly lifetime = new AbortController();
  private readonly shared: MessagingState;
  private readonly listeners = new Set<(event: MessagingEvent) => void>();
  private timer?: NodeJS.Timeout;

  constructor(private readonly deps: MessagingDeps) {
    this.shared = deps.state ?? createMessagingState();
  }

  /** A refusal as the speaker's skills word it (`kazusa-results`). */
  private refusal(
    result: string,
    agentId: string,
    values: Readonly<Record<string, string>> = {},
  ): string {
    return (this.deps.text ?? bundledSkillText())(
      `kazusa-results#${result}`,
      values,
      { agentId },
    );
  }

  private get serial(): KeyedAsyncQueue {
    return this.shared.serial;
  }
  private get deliveries(): Map<string, MessageDelivery> {
    return this.shared.deliveries;
  }
  private get chats(): Map<string, ChatConversation> {
    return this.shared.chats;
  }
  private get notifying(): Set<string> {
    return this.shared.notifying;
  }
  private get flushing(): Set<string> {
    return this.shared.flushing;
  }
  private get speeches(): Map<string, Speech[]> {
    return this.shared.speeches;
  }
  private get typing(): Map<string, TypingStreamEvent> {
    return this.shared.typing;
  }
  private get floors(): Floors {
    return this.shared.floors;
  }
  private get initialized(): boolean {
    return this.shared.initialized;
  }
  private set initialized(value: boolean) {
    this.shared.initialized = value;
  }
  private get sequence(): number {
    return this.shared.sequence;
  }
  private set sequence(value: number) {
    this.shared.sequence = value;
  }

  readonly assertCurrent = (): void => this.lifetime.signal.throwIfAborted();

  /**
   * Events this instance emits, until it is disposed: for work that each
   * instance does for its own (the journal, memory, character status).
   */
  public onEvent(listener: (event: MessagingEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Events from every instance in the process, whichever accepted the message,
   * until unsubscribed: for a client's live stream. Listening on one instance
   * missed what another emitted, and went quiet once a reload disposed it.
   */
  public onAnyEvent(listener: (event: MessagingEvent) => void): () => void {
    this.shared.streams.add(listener);
    return () => {
      this.shared.streams.delete(listener);
    };
  }

  /** Best-effort UI signals never affect canonical acceptance or attention. */
  private emit(event: MessagingEvent): void {
    for (const listener of [...this.listeners, ...this.shared.streams]) {
      try {
        listener(event);
      } catch {
        /* The client can resynchronize from history. */
      }
    }
  }

  /**
   * Explicit composition activity; never inferred from a brain wake or
   * reasoning.
   */
  async setTyping(
    participantId: string,
    name: string,
    sessionKey: string,
    isTyping: boolean,
    assertInvocationCurrent?: () => void,
  ): Promise<void> {
    await this.serial.enqueue("messages", async () => {
      await this.init();
      assertInvocationCurrent?.();
      const chat = this.requireChat(participantId, sessionKey);
      const key = `${chat.id}:${participantId}`;
      const event: TypingStreamEvent = {
        type: "typing",
        chatId: chat.id,
        senderId: participantId,
        senderName: name,
        isTyping,
        ...(isTyping
          ? { expiresAt: Date.now() + (isUser(participantId) ? 8000 : 15000) }
          : {}),
      };
      if (isTyping) this.typing.set(key, event);
      else this.typing.delete(key);
      this.emit({ type: "typing", typing: event, audience: chat.members });
    });
  }

  /** Stop showing someone typing: in one chat, or everywhere. */
  clearTyping(participantId: string, chatId?: string): void {
    for (const [key, event] of this.typing) {
      if (
        event.senderId !== participantId ||
        (chatId && event.chatId !== chatId)
      )
        continue;
      this.typing.delete(key);
      this.emit({
        type: "typing",
        typing: { ...event, isTyping: false },
        audience: this.chats.get(event.chatId)?.members ?? [],
      });
    }
  }

  getComposingChats(participantId: string): string[] {
    const chatIds: string[] = [];
    const now = Date.now();
    for (const event of this.typing.values()) {
      if (event.senderId === participantId && event.isTyping) {
        if (event.expiresAt && event.expiresAt <= now) continue;
        chatIds.push(event.chatId);
      }
    }
    return chatIds;
  }

  /**
   * Reconnecting clients recover only current, visible composition signals; an
   * observer (no `viewer`) sees all of them.
   */
  async getTyping(viewer?: string): Promise<TypingStreamEvent[]> {
    return this.serial.enqueue("messages", async () => {
      await this.init();
      return [...this.typing.values()].filter((event) => {
        const members = this.chats.get(event.chatId)?.members ?? [];
        return (
          (!event.expiresAt || event.expiresAt > Date.now()) &&
          (viewer === undefined || members.includes(viewer)) &&
          members.includes(event.senderId)
        );
      });
    });
  }

  /** Restore routing metadata and delivery order before admitting new effects. */
  private async init(): Promise<void> {
    this.assertCurrent();
    if (this.initialized) return;
    await this.deps.clock.init();
    const [entries, chats] = await Promise.all([
      this.deps.store.entries(),
      this.deps.conversations.entries(),
    ]);
    this.assertCurrent();
    for (const { value } of entries.sort(
      (a, b) => a.value.sequence - b.value.sequence,
    )) {
      this.rememberDelivery(value);
      this.sequence = Math.max(this.sequence, value.sequence);
    }
    for (const { value } of chats) this.chats.set(value.id, value);
    this.initialized = true;
  }

  /** Keep only active deliveries in memory. */
  private rememberDelivery(delivery: MessageDelivery): void {
    if (isDeliverySettled(delivery)) {
      this.deliveries.delete(delivery.id);
    } else this.deliveries.set(delivery.id, delivery);
  }

  /** Commit routing metadata before exposing it to another send or discovery. */
  private async saveChat(
    chat: ChatConversation,
    assertInvocationCurrent?: () => void,
  ): Promise<void> {
    await this.deps.conversations.register(chat.id, chat, {
      assertCurrent: () => {
        this.assertCurrent();
        assertInvocationCurrent?.();
      },
    });
    const previous = this.chats.get(chat.id);
    this.chats.set(chat.id, chat);
    if (
      !previous ||
      previous.title !== chat.title ||
      JSON.stringify(previous.members) !== JSON.stringify(chat.members)
    ) {
      for (const member of previous?.members ?? [])
        if (!chat.members.includes(member)) this.clearTyping(member, chat.id);
      this.emit({
        type: "chats",
        audience: [...new Set([...(previous?.members ?? []), ...chat.members])],
      });
    }
    this.scheduleRetry();
  }

  /** Require current membership without disclosing another character's chats. */
  private requireChat(agentId: string, sessionKey: string): ChatConversation {
    const chat = this.chats.get(conversationId(agentId, sessionKey));
    if (!chat?.members.includes(agentId))
      throw new Error(
        "Chat is unavailable or you are no longer a member. Use list_chats.",
      );
    return chat;
  }

  /** Reject unknown members against the runtime roster captured by the tool. */
  private validateMembers(
    members: readonly string[],
    configuredAgents?: ReadonlySet<string>,
  ): void {
    if (members.length > 100)
      throw new Error("A chat supports at most 100 members.");
    if (configuredAgents) {
      for (const member of members) {
        if (!isUser(member) && !configuredAgents.has(member))
          throw new Error(`Unknown character agent: ${member}.`);
      }
    }
  }

  /**
   * Resolve an existing chat or create routing metadata alongside its first
   * message. Direct pairs reuse their one conversation; a new group gets a
   * fresh short ID.
   */
  private async resolveChat(
    sender: string,
    params: SendMessageParams,
    assertInvocationCurrent?: () => void,
    configuredAgents?: ReadonlySet<string>,
  ): Promise<ChatConversation> {
    if (params.sessionKey) {
      const { kind, peerOrGroupId: peer } = parseChatSession(params.sessionKey);
      const chatId = conversationId(sender, params.sessionKey);
      const existing = this.chats.get(chatId);
      if (kind === "huddle") return await this.joinHuddle(sender, existing);
      if (existing) {
        if (!existing.members.includes(sender))
          throw new Error(
            "Chat is unavailable or you are no longer a member. Use list_chats.",
          );
        return existing;
      }
      if (kind === "direct") {
        if (peer === sender)
          throw new Error(
            "Exclude yourself from members; the sender is added automatically.",
          );
        const members = [sender, peer].sort();
        this.validateMembers(members, configuredAgents);
        const chat: ChatConversation = {
          id: chatId,
          kind: "direct",
          members,
          title: null,
          needsProjection: true,
        };
        await this.saveChat(chat, assertInvocationCurrent);
        return chat;
      }
      throw new Error(
        "Chat is unavailable or you are no longer a member. Use list_chats.",
      );
    }
    const others = params.members ?? [];
    if (params.aloud)
      return await this.startHuddle(sender, others, assertInvocationCurrent);
    return await this.textChat(
      sender,
      others,
      params.title ?? null,
      assertInvocationCurrent,
      configuredAgents,
    );
  }

  /** A text chat with others: a group, or with one other your direct chat. */
  private async textChat(
    sender: string,
    others: readonly string[],
    title: string | null,
    assertInvocationCurrent?: () => void,
    configuredAgents?: ReadonlySet<string>,
  ): Promise<ChatConversation> {
    if (others.includes(sender))
      throw new Error(
        "Exclude yourself from members; the sender is added automatically.",
      );
    const members = [sender, ...others].sort();
    this.validateMembers(members, configuredAgents);
    // A group of two is a direct chat with a name: one other person is always
    // the direct chat, whatever the title.
    const kind = others.length === 1 ? "direct" : "group";
    const chatId =
      kind === "direct"
        ? `direct:${messagingId(members)}`
        : `group:${newChatId()}`;
    const existing = this.chats.get(chatId);
    if (existing) {
      if (!existing.members.includes(sender))
        throw new Error("You are no longer a member of this chat.");
      return existing;
    }
    const chat: ChatConversation = {
      id: chatId,
      kind,
      members,
      title: kind === "group" ? (title ?? "Group chat") : null,
      needsProjection: true,
    };
    await this.saveChat(chat, assertInvocationCurrent);
    return chat;
  }

  /**
   * Start a text chat with others and return its address; nobody hears of it
   * until something is said in it.
   */
  async createGroup(
    agentId: string,
    others: readonly string[],
    title: string | null,
    assertInvocationCurrent?: () => void,
    configuredAgents?: ReadonlySet<string>,
  ): Promise<ChatSummary> {
    PARTICIPANT_ID.parse(agentId);
    return await this.openChat(agentId, assertInvocationCurrent, () =>
      this.textChat(
        agentId,
        others,
        title,
        assertInvocationCurrent,
        configuredAgents,
      ),
    );
  }

  /**
   * Turn to people where you are: you join their conversation, they join yours,
   * or one starts. Returns its address.
   */
  async talk(
    agentId: string,
    others: readonly string[],
    assertInvocationCurrent?: () => void,
  ): Promise<ChatSummary> {
    PARTICIPANT_ID.parse(agentId);
    if (others.includes(agentId))
      throw new Error(this.refusal("aloud-self", agentId));
    return await this.openChat(agentId, assertInvocationCurrent, () =>
      this.startHuddle(agentId, others, assertInvocationCurrent),
    );
  }

  private async openChat(
    agentId: string,
    assertInvocationCurrent: (() => void) | undefined,
    open: () => Promise<ChatConversation>,
  ): Promise<ChatSummary> {
    const result = await this.serial.enqueue("messages", async () => {
      await this.init();
      assertInvocationCurrent?.();
      const chat = await open();
      await this.projectChats();
      return chatSummary(chat, agentId);
    });
    this.scheduleRetry();
    return result;
  }

  /** Discover only current memberships, returning caller-owned reply addresses. */
  async listChats(
    agentId: string,
    input: { readonly query?: string } = {},
    assertInvocationCurrent?: () => void,
  ): Promise<ChatSummary[]> {
    PARTICIPANT_ID.parse(agentId);
    const { query } = LIST_CHATS.parse(input);
    return await this.serial.enqueue("messages", async () => {
      await this.init();
      assertInvocationCurrent?.();
      return [...this.chats.values()]
        .filter((chat) => chat.members.includes(agentId))
        .map((chat) => chatSummary(chat, agentId))
        .filter(
          (chat) =>
            !query ||
            [chat.sessionKey, chat.title, ...chat.members]
              .join(" ")
              .toLowerCase()
              .includes(query.toLowerCase()),
        );
    });
  }

  /**
   * Return subjective, cursor-paginated chat history for a participant. Only
   * messages accepted while the participant was in the frozen audience are
   * returned, strictly respecting join and leave timeline boundaries.
   */
  async getChatHistory(
    input: GetChatHistoryInput,
    assertInvocationCurrent?: () => void,
  ): Promise<MessagesResponse> {
    PARTICIPANT_ID.parse(input.userId);
    const chatId = input.chatId;
    const limit = Math.max(1, Math.min(input.limit ?? 30, 100));
    const before = input.before;

    return await this.serial.enqueue("messages", async () => {
      await this.init();
      assertInvocationCurrent?.();

      return await this.historyPage(chatId, before, limit, (message) =>
        message.audience.includes(input.userId),
      );
    });
  }

  /**
   * Any chat's history regardless of audience, for an observer outside the
   * world. Reads only: it changes no membership and nobody in the chat can
   * tell.
   */
  async observeChatHistory(
    input: ObserveHistoryInput,
  ): Promise<MessagesResponse> {
    const limit = Math.max(1, Math.min(input.limit ?? 30, 100));
    return await this.serial.enqueue("messages", async () => {
      await this.init();
      return await this.historyPage(
        input.chatId,
        input.before,
        limit,
        () => true,
      );
    });
  }

  /** Runs inside the `messages` queue. */
  private async historyPage(
    chatId: string,
    before: number | undefined,
    limit: number,
    visible: (message: MessageDelivery) => boolean,
  ): Promise<MessagesResponse> {
    // Records are keyed by stable message ID, not a chat/sequence index.
    // Filter audience before paging so invisible messages cannot hide an
    // older eligible page across a leave/rejoin interval.
    const entries = await this.deps.store.entries();
    const eligible = entries
      .filter(
        ({ value: message }) =>
          message.chatId === chatId &&
          visible(message) &&
          (before === undefined || message.sequence < before),
      )
      .sort((a, b) => b.value.sequence - a.value.sequence);
    const hasMore = eligible.length > limit;
    const page = eligible.slice(0, limit);
    page.sort((a, b) => a.value.sequence - b.value.sequence);

    const messages = page.map(({ value, createdAt }) =>
      clientMessage(value, createdAt),
    );

    const nextCursor =
      hasMore && page.length > 0 ? page[0].value.sequence : undefined;
    return {
      messages,
      nextCursor,
      hasMore,
    };
  }

  /**
   * Every conversation `viewer` is not in, newest first. A dissolved huddle
   * stays readable, named by who took part. One scan of retained history, so it
   * costs the same however many chats there are.
   */
  async observeChats(viewer: string): Promise<ObservedConversation[]> {
    PARTICIPANT_ID.parse(viewer);
    return await this.serial.enqueue("messages", async () => {
      await this.init();
      const latest = new Map<string, MessageDelivery>();
      const heard = new Map<string, Set<string>>();
      for (const { value: message } of await this.deps.store.entries()) {
        const current = latest.get(message.chatId);
        if (!current || current.sequence < message.sequence)
          latest.set(message.chatId, message);
        const people = heard.get(message.chatId) ?? new Set<string>();
        for (const id of message.audience) people.add(id);
        heard.set(message.chatId, people);
      }
      return [...this.chats.values()]
        .filter(
          (chat) =>
            !chat.members.includes(viewer) &&
            (chat.members.length > 0 || latest.has(chat.id)),
        )
        .map((chat) => {
          const ended = chat.members.length === 0;
          return {
            chat,
            ended,
            members: ended
              ? [...(heard.get(chat.id) ?? [])].sort()
              : chat.members,
            ...(latest.has(chat.id) ? { latest: latest.get(chat.id) } : {}),
          };
        })
        .sort((a, b) => (b.latest?.sequence ?? 0) - (a.latest?.sequence ?? 0));
    });
  }

  /** All retained messages, for the world journal. */
  async messageLog(): Promise<MessageDelivery[]> {
    return await this.serial.enqueue("messages", async () => {
      await this.init();
      return (await this.deps.store.entries()).map(({ value }) => value);
    });
  }

  /**
   * Let any current member edit a group's title or membership. Changes affect
   * future sends only: retained deliveries keep their acceptance-time audience,
   * and joining never copies earlier private history into the new member's
   * view.
   */
  async manageChat(
    agentId: string,
    input: ManageChatParams,
    assertInvocationCurrent?: () => void,
    configuredAgents?: ReadonlySet<string>,
  ): Promise<ChatSummary> {
    PARTICIPANT_ID.parse(agentId);
    const params = MANAGE_CHAT.parse(input);
    const result = await this.serial.enqueue("messages", async () => {
      await this.init();
      assertInvocationCurrent?.();
      const chat = this.requireChat(agentId, params.sessionKey);
      if (chat.kind === "huddle") {
        if (params.action !== "leave")
          throw new Error(this.refusal("conversation-leave-only", agentId));
        // Stepping back: still here, no longer in the conversation.
        await this.leaveHuddle(
          chat,
          agentId,
          ["step-back", agentId, chat.id, String(this.deps.clock.time())],
          "steps back from the conversation",
        );
        await this.projectChats();
        await this.flushLedgers();
        return chatSummary(this.chats.get(chat.id) ?? chat, agentId);
      }
      if (chat.kind !== "group")
        throw new Error(
          "Direct chats have fixed membership; create a new group instead.",
        );
      let members = [...chat.members];
      // Who is coming or going, as everyone in the chat is told.
      let change: { readonly text: string; readonly going: boolean } | null =
        null;
      if (params.action === "add_members") {
        this.validateMembers(params.members, configuredAgents);
        const added = params.members.filter((id) => !members.includes(id));
        members = [...new Set([...members, ...params.members])].sort();
        if (added.length)
          change = {
            text: `adds ${await this.namesOf(added)} to the chat`,
            going: false,
          };
      } else if (params.action === "remove_members") {
        const removed = members.filter((id) => params.members.includes(id));
        members = members.filter((member) => !params.members.includes(member));
        if (removed.length)
          change = {
            text: `removes ${await this.namesOf(removed)} from the chat`,
            going: true,
          };
      } else if (params.action === "leave") {
        members = members.filter((member) => member !== agentId);
        change = { text: "leaves the chat", going: true };
      } else if (params.title !== chat.title) {
        change = {
          text: `renames the chat to "${params.title}"`,
          going: false,
        };
      }
      this.validateMembers(members);
      const updated: ChatConversation = {
        ...chat,
        members,
        title: params.action === "rename" ? params.title : chat.title,
        needsProjection: true,
      };
      const key = [
        chat.id,
        agentId,
        params.action,
        ...members,
        String(this.deps.clock.time()),
      ];
      // Those going hear it before they go; those coming, once they are in.
      if (change?.going) await this.announce(chat, agentId, key, change.text);
      await this.saveChat(updated, assertInvocationCurrent);
      if (change && !change.going)
        await this.announce(updated, agentId, key, change.text);
      await this.projectChats();
      await this.flushLedgers();
      return chatSummary(updated, agentId);
    });
    this.notify();
    this.scheduleRetry();
    return result;
  }

  /** Where someone stands, required for anything said aloud. */
  private async standingPlace(
    who: string,
  ): Promise<{ readonly placeId: string; readonly title: string }> {
    const place = await this.deps.placeOf?.(who);
    if (!place) throw new Error(this.refusal("aloud-on-the-way", who));
    return place;
  }

  /**
   * You talk in one huddle at a time: joining one by its address takes you out
   * of the one you were in, as walking over to another group does.
   */
  private async leaveOtherHuddles(who: string, keep: string): Promise<void> {
    for (const chat of [...this.chats.values()]) {
      if (chat.kind !== "huddle" || chat.id === keep) continue;
      if (!chat.members.includes(who)) continue;
      await this.leaveHuddle(
        chat,
        who,
        ["drift", who, chat.id, keep, String(this.deps.clock.time())],
        "moves to another conversation",
      );
    }
  }

  /**
   * Someone goes, with a line to those still in it. A huddle needs two: the one
   * left behind is no longer talking with anyone, so it dissolves. Runs inside
   * the `messages` queue.
   */
  private async leaveHuddle(
    chat: ChatConversation,
    who: string,
    key: readonly string[],
    text: string,
  ): Promise<void> {
    await this.announce(chat, who, key, text);
    const members = chat.members.filter((member) => member !== who);
    await this.saveChat({
      ...chat,
      members: members.length < 2 ? [] : members,
    });
  }

  /**
   * Turning to people where you are, as one person does it: each move is one
   * person's, and two groups never merge (live, merging grew one huddle to
   * 17).
   *
   * - Some of your own conversation: you and they turn to each other, a side
   *   conversation; those left see you turn away.
   * - People in another conversation: you walk over and join it.
   * - People talking with nobody: they join you, or a new one starts. People in
   *   different conversations at once are refused: you can't stand in two.
   *   Anyone moved can turn back the same way.
   */
  private async startHuddle(
    sender: string,
    others: readonly string[],
    assertInvocationCurrent?: () => void,
  ): Promise<ChatConversation> {
    const place = await this.standingPlace(sender);
    for (const other of others) {
      if ((await this.deps.placeOf?.(other))?.placeId !== place.placeId)
        throw new Error(this.refusal("aloud-not-here", sender, { who: other }));
    }
    const huddleOf = (who: string) =>
      [...this.chats.values()].find(
        (chat) =>
          chat.kind === "huddle" &&
          chat.placeId === place.placeId &&
          chat.members.includes(who),
      );
    const mine = huddleOf(sender);
    const elsewhere = new Map<string, ChatConversation>();
    const near: string[] = [];
    const free: string[] = [];
    for (const other of others) {
      const theirs = huddleOf(other);
      if (!theirs) free.push(other);
      else if (theirs.id === mine?.id) near.push(other);
      else elsewhere.set(theirs.id, theirs);
    }
    if (elsewhere.size > 1 || (elsewhere.size === 1 && near.length > 0))
      throw new Error(
        this.refusal("aloud-apart", sender, {
          // Only those talking with someone: the rest are in none.
          who: await this.namesOf(others.filter((id) => !free.includes(id))),
        }),
      );
    const [theirs] = elsewhere.values();
    // Someone saying a line, or waiting to, is talking to the group: they can't
    // be turned away from it mid-sentence.
    const turnable = near.filter((id) => !this.speeches.get(id)?.length);
    let target: ChatConversation;
    /** Who comes into the conversation now, so their silence starts now. */
    let joining: string[] = [...free];
    if (theirs) {
      // Walking over: out of your own, into theirs.
      await this.leaveOtherHuddles(sender, theirs.id);
      target = { ...theirs, members: [...theirs.members, sender] };
      joining.push(sender);
    } else if (
      mine &&
      turnable.length > 0 &&
      turnable.length < mine.members.length - 1
    ) {
      // A side conversation: turning away from the rest.
      const turning = [sender, ...turnable];
      await this.announce(
        mine,
        sender,
        [
          "turn",
          sender,
          mine.id,
          ...turnable.sort(),
          String(this.deps.clock.time()),
        ],
        `turns to talk with ${await this.namesOf(turnable)}`,
      );
      const staying = mine.members.filter((id) => !turning.includes(id));
      if (staying.length < 2) {
        // One left behind is talking with nobody: the pair keeps the
        // conversation (and its address, which sends under way still use).
        target = { ...mine, members: turning };
      } else {
        await this.saveChat({ ...mine, members: staying });
        target = this.newHuddle(turning, place);
      }
      joining = [...joining, ...turning];
    } else if (mine) target = mine;
    else {
      target = this.newHuddle([sender], place);
      joining.push(sender);
    }
    const members = [...new Set([...target.members, ...free])].sort();
    const joined: ChatConversation = {
      ...target,
      members,
      joinedAt: this.joinedAt(target, members, joining),
      needsProjection: true,
    };
    await this.saveChat(joined, assertInvocationCurrent);
    return joined;
  }

  /** Members by when they joined, with `joining` joining now. */
  private joinedAt(
    chat: ChatConversation,
    members: readonly string[],
    joining: readonly string[],
  ): Record<string, number> {
    const now = this.deps.clock.time();
    return Object.fromEntries([
      ...Object.entries(chat.joinedAt ?? {}).filter(([id]) =>
        members.includes(id),
      ),
      ...joining.map((id) => [id, now] as const),
    ]);
  }

  private newHuddle(
    members: readonly string[],
    place: { readonly placeId: string; readonly title: string },
  ): ChatConversation {
    return {
      id: `huddle:${newChatId()}`,
      kind: "huddle",
      members: [...members].sort(),
      title: `Talking at ${place.title}`,
      placeId: place.placeId,
      needsProjection: true,
    };
  }

  /** Speaking into a huddle at your place joins it. */
  private async joinHuddle(
    sender: string,
    addressed: ChatConversation | undefined,
  ): Promise<ChatConversation> {
    let chat = addressed;
    while (chat?.mergedInto) chat = this.chats.get(chat.mergedInto);
    if (!chat || chat.members.length === 0)
      throw new Error(this.refusal("conversation-over", sender));
    if (!chat.members.includes(sender)) {
      const place = await this.deps.placeOf?.(sender);
      if (place?.placeId !== chat.placeId)
        throw new Error(this.refusal("aloud-not-there", sender));
    }
    if (chat.members.includes(sender)) return chat;
    await this.leaveOtherHuddles(sender, chat.id);
    const members = [...chat.members, sender].sort();
    const joined: ChatConversation = {
      ...chat,
      members,
      joinedAt: this.joinedAt(chat, members, [sender]),
      needsProjection: true,
    };
    await this.saveChat(joined);
    return joined;
  }

  /**
   * Stop following a conversation in person: out of it without a word, since
   * drifting off isn't announced and a line would wake everyone in it. One of a
   * pair can't drift off unnoticed (the other is talking to them), so they
   * stay. Returns it as it was, for who was in it, or `undefined` when they
   * didn't leave.
   */
  async tuneOut(
    agentId: string,
    sessionKey: string,
  ): Promise<ChatSummary | undefined> {
    PARTICIPANT_ID.parse(agentId);
    return await this.serial.enqueue("messages", async () => {
      await this.init();
      const chat = this.chats.get(conversationId(agentId, sessionKey));
      if (chat?.kind !== "huddle" || !chat.members.includes(agentId))
        return undefined;
      const members = chat.members.filter((member) => member !== agentId);
      if (members.length < 2) return undefined;
      await this.saveChat({ ...chat, members });
      return chatSummary(chat, agentId);
    });
  }

  /** The huddles going on at a place, for sightings and `With you`. */
  async huddlesAt(placeId: string): Promise<Huddle[]> {
    return await this.serial.enqueue("messages", async () => {
      await this.init();
      return [...this.chats.values()]
        .filter(
          (chat) =>
            chat.kind === "huddle" &&
            chat.placeId === placeId &&
            chat.members.length > 0,
        )
        .map((chat) => ({
          address: huddleAddress(chat.id),
          members: [...chat.members],
        }));
    });
  }

  /**
   * Someone left a place: they leave every huddle there with a line to those
   * still in it ("_leaves, heading toward …_"). The last one out dissolves it;
   * its history stays in each member's ledger.
   */
  async leavePlace(
    who: string,
    name: string,
    placeId: string,
    options: { readonly toward?: string; readonly at: number },
  ): Promise<void> {
    PARTICIPANT_ID.parse(who);
    void name;
    // A goodbye sent with the move is said on the way out, before they go:
    // what they were waiting to say goes at once, over whoever is talking.
    // Outside the queue, which those lines need.
    const saying = [...(this.speeches.get(who) ?? [])];
    for (const speech of saying) speech.hurry.abort();
    await Promise.all(saying.map((speech) => speech.ended));
    await this.serial.enqueue("messages", async () => {
      await this.init();
      for (const chat of [...this.chats.values()]) {
        if (chat.kind !== "huddle" || chat.placeId !== placeId) continue;
        if (!chat.members.includes(who)) continue;
        await this.leaveHuddle(
          chat,
          who,
          ["leave", who, chat.id, String(options.at)],
          options.toward
            ? `leaves, heading toward ${options.toward}`
            : "leaves",
        );
      }
      await this.projectChats();
      await this.flushLedgers();
    });
    this.notify();
    this.scheduleRetry();
  }

  /**
   * Accept one message with its audience frozen to the chat's members now. Runs
   * inside the `messages` queue.
   */
  private async accept(
    sender: string,
    senderName: string,
    chat: ChatConversation,
    id: string,
    params: SendMessageParams,
    assertInvocationCurrent?: () => void,
  ): Promise<MessageDelivery> {
    const timestamp = this.deps.clock.time();
    const owners = [
      sender,
      ...chat.members.filter((member) => member !== sender),
    ];
    const copies: MessageCopy[] = owners
      .filter((agentId) => !isUser(agentId))
      .map((agentId) => ({
        agentId,
        sessionKey: chatSummary(chat, agentId).sessionKey,
        role: agentId === sender ? "assistant" : "user",
      }));
    const delivery: MessageDelivery = {
      id,
      sequence: ++this.sequence,
      sender,
      senderName,
      chatId: chat.id,
      audience: owners,
      params,
      timestamp,
      copies,
    };
    // A failed acceptance performs no ledger writes. Once accepted, delivery
    // survives the invoking turn and can be completed by the plugin service.
    await this.save(delivery, assertInvocationCurrent);
    this.rememberDelivery(delivery);
    this.clearTyping(sender, delivery.chatId);
    this.emit({ type: "message", delivery });
    return delivery;
  }

  private async nameOf(id: string): Promise<string> {
    return (await this.deps.nameOf?.(id)) ?? id;
  }

  /**
   * Tells a chat, in the actor's own voice, that its membership changed ("_adds
   * Natsu_", "_leaves_"). `chat` is the audience: as it was for anyone going,
   * as it is now for anyone coming. Runs inside the `messages` queue; a replay
   * of the same change is a no-op.
   */
  private async announce(
    chat: ChatConversation,
    actor: string,
    key: readonly string[],
    text: string,
  ): Promise<void> {
    if (chat.members.length < 2 || !chat.members.includes(actor)) return;
    const requestId = messagingId(["notice", ...key]);
    const id = messagingId([actor, requestId]);
    if (this.deliveries.has(id) || (await this.deps.store.lookup(id))) return;
    // Something the actor does, not says: told as an action.
    await this.accept(actor, await this.nameOf(actor), chat, id, {
      sessionKey: chatSummary(chat, actor).sessionKey,
      text,
      type: "action",
      requestId,
      title: null,
    });
  }

  /** "Natsu", "Airi and Natsu", "Airi, Natsu and Yoshimi". */
  private async namesOf(ids: readonly string[]): Promise<string> {
    const names = await Promise.all(ids.map((id) => this.nameOf(id)));
    return names.length <= 1
      ? (names[0] ?? "")
      : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  }

  /** Persist acceptance or progress before publishing success to the caller. */
  private async save(
    delivery: MessageDelivery,
    assertInvocationCurrent?: () => void,
  ): Promise<void> {
    await this.deps.store.register(delivery.id, delivery, {
      assertCurrent: () => {
        this.assertCurrent();
        assertInvocationCurrent?.();
      },
    });
  }

  /** Advance one copy only after its progress checkpoint commits successfully. */
  private async updateCopy(
    delivery: MessageDelivery,
    copy: MessageCopy,
    patch: Partial<MessageCopy>,
  ): Promise<void> {
    await this.save({
      ...delivery,
      copies: delivery.copies.map((item) =>
        item === copy ? { ...item, ...patch } : item,
      ),
    });
    Object.assign(copy, patch);
    this.rememberDelivery(delivery);
  }

  /**
   * Accept a new message with a fixed audience, text, identity and simulation
   * timestamp, or replay its existing receipt. Only new acceptance consults
   * membership; retries finish the original delivery even after a member
   * leaves.
   */
  async send(
    sender: string,
    senderName: string,
    input: SendMessageParams,
    assertInvocationCurrent?: () => void,
    configuredAgents?: ReadonlySet<string>,
  ): Promise<SendMessageResult> {
    const params = deliveryParams(sender, input);
    const id = messagingId([sender, params.requestId]);
    const result = await this.serial.enqueue("messages", async () => {
      await this.init();
      this.assertCurrent();
      assertInvocationCurrent?.();
      // Settled messages leave RAM, not history. Always consult the canonical
      // record before retrying a delivery with today's membership/time.
      let delivery =
        this.deliveries.get(id) ?? (await this.deps.store.lookup(id));
      let chat: ChatConversation | undefined;
      if (delivery) {
        if (JSON.stringify(delivery.params) !== JSON.stringify(params)) {
          throw new Error("Request ID already belongs to a different message.");
        }
        chat = this.chats.get(delivery.chatId);
      } else {
        chat = await this.resolveChat(
          sender,
          params,
          assertInvocationCurrent,
          configuredAgents,
        );
        this.validateMembers(chat.members, configuredAgents);
        delivery = await this.accept(
          sender,
          senderName,
          chat,
          id,
          params,
          assertInvocationCurrent,
        );
      }
      await this.projectChats();
      await this.flushLedgers();
      return {
        messageId: id,
        chatId: delivery.chatId,
        message: clientMessage(delivery),
        sessionKey: chat
          ? chatSummary(chat, sender).sessionKey
          : (delivery.copies[0]?.sessionKey ?? ""),
        status: delivery.copies.every((copy) => copy.messageId)
          ? ("delivered" as const)
          : ("pending" as const),
        recipients: delivery.audience.filter(
          (member) => member !== delivery.sender,
        ),
      };
    });
    this.notify();
    this.scheduleRetry();
    return result;
  }

  /**
   * Type and send each bubble as its own canonical message, pacing later
   * bubbles on the simulation clock while the tool call stays open. The plan is
   * retained first so a crash flushes what remains; an interrupt drops the
   * unsent rest.
   */
  async speak(
    sender: string,
    senderName: string,
    input: SpeechParams,
    assertInvocationCurrent?: () => void,
    configuredAgents?: ReadonlySet<string>,
    systemAgentId?: string,
    abortSignal?: AbortSignal,
  ): Promise<SpeechResult> {
    PARTICIPANT_ID.parse(sender);
    const params = SPEECH_REQUEST.parse(input);
    return await this.play(
      {
        id: messagingId([sender, params.requestId]),
        sender,
        senderName,
        params,
      },
      true,
      assertInvocationCurrent,
      configuredAgents,
      systemAgentId,
      abortSignal,
    );
  }

  /**
   * Deliver a plan's bubbles in order. A live plan is persisted, paced and
   * interruptible; a recovered plan is flushed at once. Bubble identities are
   * stable, so replaying an already-sent bubble returns its original receipt.
   */
  private async play(
    plan: OutboxPlan,
    live: boolean,
    assertInvocationCurrent?: () => void,
    configuredAgents?: ReadonlySet<string>,
    systemAgentId?: string,
    abortSignal?: AbortSignal,
  ): Promise<SpeechResult> {
    const { sender, senderName, params } = plan;
    const { messages, requestId, ...target } = params;
    // Actions are seen only where the speaker is; in a text chat they are
    // dropped, so a model that adds one by habit changes nothing there.
    // Stickers are the other way round: a phone thing, dropped face to face.
    // The original index keeps each bubble's identity stable across replays.
    const inPlace =
      target.aloud === true ||
      Boolean(target.sessionKey?.match(/(?:^|:)chat:huddle:/));
    const bubbles = messages.flatMap((bubble, at) => {
      const typed = bubbleOf(bubble);
      const pieces =
        typed.type === (inPlace ? "sticker" : "action") ? [] : [typed];
      // Message type is authoritative; Markdown never changes speech into actions.
      return pieces.map((piece, part) => ({
        index: part === 0 ? String(at) : `${at}.${part}`,
        ...piece,
      }));
    });
    let end = (): void => {};
    const speech: Speech = {
      planId: plan.id,
      controller: new AbortController(),
      params,
      planned: bubbles.map(readAs),
      said: [],
      // Known before the first line is said: attention reads it while they
      // wait for the floor ("someone just said what I was about to").
      ...(target.sessionKey
        ? { sessionKey: ownChatSession(sender, target.sessionKey) }
        : {}),
      hurry: new AbortController(),
      ended: new Promise<void>((resolve) => {
        end = resolve;
      }),
    };
    const signal = AbortSignal.any([
      speech.controller.signal,
      this.lifetime.signal,
      ...(abortSignal ? [abortSignal] : []),
    ]);
    const sent: SendMessageResult[] = [];
    let paced = live;
    // Face to face, each spoken line waits for the floor and takes its time to
    // say. The system agent talks on wall time, outside the world's floors.
    const floored = live && inPlace && sender !== systemAgentId;
    /** How this send is said (how badly they want in, how fast), asked once. */
    let judged: SpeechJudgment | undefined;
    /** Huddles this send has spoken in, whose turn it may hold. */
    const turns = new Set<string>();
    /** The line being said, until it is heard. */
    let saying:
      | {
          readonly chatId: string;
          readonly sessionKey: string;
          readonly text: string;
          readonly index: string;
          readonly startedAt: number;
          readonly ms: number;
        }
      | undefined;
    /** A line cut off partway: what was heard of it. */
    let cut: string | undefined;
    // A stopping Gateway, or the speaker leaving, lets the rest go at once.
    const released = AbortSignal.any([
      this.deps.release ?? shutdownSignal(),
      speech.hurry.signal,
    ]);
    const hurry = speech.hurry.signal;
    try {
      if (live) {
        // One thing after another: live, a later send cut off an earlier one
        // from the same message before it said a word.
        const queue = this.speeches.get(sender) ?? [];
        const ahead = queue.map((other) => other.ended);
        queue.push(speech);
        this.speeches.set(sender, queue);
        await Promise.all(ahead);
        // Interrupted while waiting its turn: nothing to say or retain.
        signal.throwIfAborted();
      }
      await this.init();
      if (live)
        await this.deps.outbox.register(plan.id, plan, {
          assertCurrent: () => {
            this.assertCurrent();
            assertInvocationCurrent?.();
          },
        });
      for (const { index, text, type, sticker } of bubbles) {
        const first = sent[0];
        const bubble: SendMessageParams = {
          ...(first ? { sessionKey: first.sessionKey } : target),
          text,
          ...(type === "speech" ? {} : { type }),
          ...(sticker ? { sticker } : {}),
          requestId: messagingId([requestId, index]),
        };
        const chat =
          floored && paced && type === "speech"
            ? !(await this.accepted(sender, bubble.requestId)) &&
              (await this.conversationFor(
                sender,
                bubble,
                first,
                assertInvocationCurrent,
                configuredAgents,
              ))
            : undefined;
        if (chat) {
          const sessionKey = chatSummary(chat, sender).sessionKey;
          if (!judged && speech.hurry.signal.aborted)
            judged = { floor: "CUT_IN", pace: 1 };
          if (!judged) {
            const floor = this.floors.contested(chat.id, sender, plan.id);
            judged = await this.judgeSpeech(sender, {
              sessionKey,
              ...(floor ? { floor } : {}),
            });
            // Wanting in means nothing when nobody else has the floor.
            if (!floor) judged = { ...judged, floor: "NEXT" };
            signal.throwIfAborted();
          }
          const { floor: choice, pace } = judged;
          if (choice === "CUT_IN" && turns.size === 0)
            this.floors.cutIn(chat.id, sender, plan.id);
          else
            await this.floors.take(
              chat.id,
              {
                agentId: sender,
                planId: plan.id,
                // A cut-in is only the first line; after it, the next pause.
                choice: choice === "CUT_IN" ? "NEXT" : choice,
              },
              signal,
              released,
            );
          turns.add(chat.id);
          const ms = speakingMs(text, this.rates, pace);
          saying = {
            chatId: chat.id,
            sessionKey,
            text,
            index,
            startedAt: this.deps.clock.now().simTime,
            ms,
          };
          await this.setTyping(
            sender,
            senderName,
            sessionKey,
            true,
            assertInvocationCurrent,
          );
          paced = await sleepSim(this.deps.clock, ms, signal, {
            release: released,
            hurry,
          });
        } else if (
          first &&
          paced &&
          !(await this.accepted(sender, bubble.requestId))
        ) {
          await this.setTyping(
            sender,
            senderName,
            first.sessionKey,
            true,
            assertInvocationCurrent,
          );
          // A paused world holds the next bubble; a stopping Gateway lets the
          // rest go at once rather than wait on a frozen clock.
          const speechClock =
            sender === systemAgentId
              ? {
                  now: () => ({ simTime: Date.now(), speed: 1, formatted: "" }),
                }
              : this.deps.clock;
          // A sticker is picked, not typed: only the base pause.
          paced = await sleepSim(
            speechClock,
            typingMs(sticker ? "" : text),
            signal,
            { release: released, hurry },
          );
        }
        signal.throwIfAborted();
        sent.push(
          await this.send(
            sender,
            senderName,
            bubble,
            assertInvocationCurrent,
            configuredAgents,
          ),
        );
        speech.said.push(readAs({ text, type }));
        speech.sessionKey = sent[0].sessionKey;
        if (saying) this.floors.done(saying.chatId, plan.id);
        saying = undefined;
      }
    } catch (error) {
      if (!speech.controller.signal.aborted && !abortSignal?.aborted)
        throw error;
      // Stopped mid-line by what they heard: the words already out were heard.
      if (saying && speech.controller.signal.aborted) {
        const heard = cutOff(
          saying.text,
          (this.deps.clock.now().simTime - saying.startedAt) / saying.ms,
          this.rates,
        );
        if (heard && this.liveChat(saying.chatId)?.members.includes(sender)) {
          try {
            sent.push(
              await this.send(
                sender,
                senderName,
                {
                  sessionKey: saying.sessionKey,
                  text: heard,
                  requestId: messagingId([requestId, saying.index, "cut"]),
                },
                assertInvocationCurrent,
                configuredAgents,
              ),
            );
            if (heard !== saying.text) cut = heard;
            speech.said.push(heard);
          } catch (error) {
            this.deps.warn(`Cut-off line of ${sender}: ${String(error)}`);
          }
        }
        this.clearTyping(sender, saying.chatId);
      }
    } finally {
      if (saying) this.floors.done(saying.chatId, plan.id);
      for (const chatId of turns) this.floors.endTurn(chatId, plan.id);
      try {
        // Keep the plan only for a later generation to flush, and never what
        // an interrupt took back; forget it before releasing the speaker so
        // recovery can never resurrect dropped bubbles.
        if (!this.lifetime.signal.aborted || speech.controller.signal.aborted)
          await this.deps.outbox.delete(plan.id);
      } finally {
        // Only once the plan is gone: a flush that misses it here finds no plan.
        const queue = this.speeches.get(sender) ?? [];
        const at = queue.indexOf(speech);
        if (at >= 0) queue.splice(at, 1);
        if (!queue.length) this.speeches.delete(sender);
        end();
      }
    }
    // A cut-off line was heard in part: said as heard, and still unsaid whole.
    const whole = sent.length - (cut === undefined ? 0 : 1);
    const unsaid = bubbles.slice(whole).map(readAs);
    if (unsaid.length && sent[0]) this.clearTyping(sender, sent[0].chatId);
    return {
      status: unsaid.length
        ? "interrupted"
        : sent.every((result) => result.status === "delivered")
          ? "delivered"
          : "pending",
      sessionKey: sent[0]?.sessionKey ?? target.sessionKey ?? "",
      recipients: sent.at(-1)?.recipients ?? [],
      messageIds: sent.map((result) => result.messageId),
      said: [
        ...bubbles.slice(0, whole).map(readAs),
        ...(cut === undefined ? [] : [cut]),
      ],
      unsaid,
      ...(cut === undefined ? {} : { heard: cut }),
    };
  }

  /**
   * The conversation a line said aloud goes to, joined before it is said: you
   * walk over, then wait for a pause. Sending it later resolves the same one.
   */
  private async conversationFor(
    sender: string,
    bubble: SendMessageParams,
    first: SendMessageResult | undefined,
    assertInvocationCurrent?: () => void,
    configuredAgents?: ReadonlySet<string>,
  ): Promise<ChatConversation | undefined> {
    if (first) return this.liveChat(first.chatId);
    const params = deliveryParams(sender, bubble);
    const chat = await this.serial.enqueue("messages", async () => {
      await this.init();
      this.assertCurrent();
      assertInvocationCurrent?.();
      const chat = await this.resolveChat(
        sender,
        params,
        assertInvocationCurrent,
        configuredAgents,
      );
      await this.projectChats();
      await this.flushLedgers();
      return chat;
    });
    this.notify();
    this.scheduleRetry();
    return chat.kind === "huddle" ? chat : undefined;
  }

  /** A huddle as it is now: merges followed, `undefined` once it is over. */
  private liveChat(chatId: string): ChatConversation | undefined {
    let chat = this.chats.get(chatId);
    while (chat?.mergedInto) chat = this.chats.get(chat.mergedInto);
    return chat?.members.length ? chat : undefined;
  }

  private get rates(): SpeechRates {
    return this.deps.speechRates ?? SPEECH_RATES;
  }

  /** How they say it; the next pause at an ordinary pace when unjudged. */
  private async judgeSpeech(
    agentId: string,
    facts: SpeechFacts,
  ): Promise<SpeechJudgment> {
    const ordinary: SpeechJudgment = { floor: "NEXT", pace: 1 };
    if (!this.deps.judgeSpeech) return ordinary;
    try {
      return await this.deps.judgeSpeech(agentId, facts);
    } catch (error) {
      this.deps.warn(`Speech judgment for ${agentId}: ${String(error)}`);
      return ordinary;
    }
  }

  private async accepted(sender: string, requestId: string): Promise<boolean> {
    const id = messagingId([sender, requestId]);
    return this.deliveries.has(id) || Boolean(await this.deps.store.lookup(id));
  }

  /**
   * Stop a character mid-speech, and whatever they were about to say next;
   * returns whether anything was being said.
   */
  interrupt(agentId: string): boolean {
    const stopped = this.speeches.get(agentId) ?? [];
    for (const speech of stopped)
      speech.controller.abort(new Error("Speech interrupted"));
    return stopped.length > 0;
  }

  currentSpeech(agentId: string): CurrentSpeech | undefined {
    const speech = this.speeches.get(agentId)?.[0];
    if (!speech) return undefined;
    return {
      ...(speech.sessionKey ? { sessionKey: speech.sessionKey } : {}),
      said: [...speech.said],
      unsaid: speech.planned.slice(speech.said.length),
    };
  }

  /**
   * Per current chat: this participant's address and the messages from others
   * after their own latest message, in order. Reads canonical history, never
   * catalog attribution.
   */
  private async conversationTails(
    agentId: string,
  ): Promise<Map<string, ConversationTail>> {
    const visible = (await this.deps.store.entries())
      .map(({ value }) => value)
      .filter((message) => message.audience.includes(agentId))
      .sort((a, b) => a.sequence - b.sequence);
    const tails = new Map<string, ConversationTail>();
    for (const message of visible) {
      const chat = this.chats.get(message.chatId);
      if (!chat?.members.includes(agentId)) continue;
      const tail = tails.get(chat.id) ?? {
        chat,
        sessionKey: chatSummary(chat, agentId).sessionKey,
        lastSpokeAt: null,
        since: [],
      };
      if (message.sender === agentId) {
        tail.lastSpokeAt = message.timestamp;
        tail.since = [];
      } else tail.since.push(message);
      tails.set(chat.id, tail);
    }
    return tails;
  }

  /**
   * Chats where someone spoke after this participant's latest message and the
   * participant actually read at least one of those messages. `noticed` comes
   * from attention: ignored or still-waiting stimuli never count as read.
   */
  async awaitingReplies(
    agentId: string,
    since: number,
    noticed: (ref: MessageRef) => boolean,
  ): Promise<AwaitingReply[]> {
    PARTICIPANT_ID.parse(agentId);
    return await this.serial.enqueue("messages", async () => {
      await this.init();
      const result: AwaitingReply[] = [];
      for (const { sessionKey, since: tail } of (
        await this.conversationTails(agentId)
      ).values()) {
        const read = tail.filter(
          (message) =>
            message.timestamp >= since &&
            noticed({ id: message.id, sessionKey }),
        );
        const latest = read.at(-1);
        if (latest)
          result.push({
            sessionKey,
            sender: latest.sender,
            senderName: latest.senderName,
            timestamp: latest.timestamp,
          });
      }
      return result.sort((a, b) => a.timestamp - b.timestamp);
    });
  }

  /** Conversation facts for the participant's own chat ledger keys. */
  async chatFacts(
    agentId: string,
    sessionKeys: readonly string[],
  ): Promise<ChatFacts[]> {
    PARTICIPANT_ID.parse(agentId);
    return await this.serial.enqueue("messages", async () => {
      await this.init();
      const tails = await this.conversationTails(agentId);
      return [...new Set(sessionKeys)].flatMap((sessionKey) => {
        const chat = this.chats.get(conversationId(agentId, sessionKey));
        if (!chat?.members.includes(agentId)) return [];
        const tail = tails.get(chat.id);
        return [
          {
            sessionKey: chatSummary(chat, agentId).sessionKey,
            kind: chat.kind,
            title: chat.kind === "direct" ? null : chat.title,
            memberCount: chat.members.length,
            lastSpokeAt: tail?.lastSpokeAt ?? null,
            joinedAt: chat.joinedAt?.[agentId] ?? null,
            unanswered: tail?.since.length ?? 0,
            waitingSince: tail?.since[0]?.timestamp ?? null,
          },
        ];
      });
    });
  }

  /** Send every bubble of plans a previous generation left unfinished. */
  private async flushOutbox(): Promise<void> {
    for (const { key } of await this.deps.outbox.entries()) {
      if (this.lifetime.signal.aborted) return;
      // Being said on any instance: its speaker owns it, and deletes it when
      // done. Checked before the lookup, which then misses a finished plan.
      if (
        [...this.speeches.values()].some((queue) =>
          queue.some((speech) => speech.planId === key),
        )
      )
        continue;
      // Entries are a snapshot: a speech can end, and take back its unsaid
      // bubbles, while earlier plans flush.
      const plan = await this.deps.outbox.lookup(key);
      if (!plan || this.flushing.has(plan.id)) continue;
      this.flushing.add(plan.id);
      try {
        await this.play(plan, false);
      } catch (error) {
        this.warn(error);
      } finally {
        this.flushing.delete(plan.id);
      }
    }
  }

  /** Recover metadata projections and pending copies without invoking a brain. */
  async resume(): Promise<void> {
    if (this.lifetime.signal.aborted) return;
    try {
      await this.serial.enqueue("messages", async () => {
        if (this.lifetime.signal.aborted) return;
        await this.init();
        if (this.lifetime.signal.aborted) return;
        await this.projectChats();
        if (this.lifetime.signal.aborted) return;
        await this.flushLedgers();
      });
      if (this.lifetime.signal.aborted) return;
      this.notify();
      await this.flushOutbox();
    } finally {
      this.scheduleRetry();
    }
  }

  /**
   * Project titles and empty member views into native sessions. The registry is
   * authoritative; a failed projection remains pending and never rolls back an
   * accepted membership edit. This writes no dialogue or historical copies.
   */
  private async projectChats(): Promise<void> {
    for (const chat of this.chats.values()) {
      if (!chat.needsProjection) continue;
      try {
        for (const agentId of chat.members) {
          this.assertCurrent();
          if (isUser(agentId)) continue;
          const summary = chatSummary(chat, agentId);
          await this.deps.ensureSession(
            { agentId, sessionKey: summary.sessionKey },
            summary.title,
          );
        }
        await this.saveChat({ ...chat, needsProjection: false });
      } catch (error) {
        this.warn(error);
      }
    }
  }

  /**
   * Append in acceptance order using stable native copy keys. A failed ledger
   * blocks only its later copies; other participants can continue receiving.
   */
  private async flushLedgers(): Promise<void> {
    const blocked = new Set<string>();
    for (const delivery of this.deliveries.values()) {
      for (const copy of delivery.copies) {
        if (copy.messageId || blocked.has(copy.sessionKey)) continue;
        try {
          this.assertCurrent();
          if (!copy.sessionId) {
            const chat = this.chats.get(delivery.chatId);
            if (!chat)
              throw new Error("Delivery has no conversation metadata.");
            const sessionId = await this.deps.ensureSession(
              copy,
              chatSummary(chat, copy.agentId).title,
            );
            await this.updateCopy(delivery, copy, { sessionId });
          }
          const messageId = await this.deps.append(delivery, copy);
          await this.updateCopy(delivery, copy, { messageId });
        } catch (error) {
          // Keep newer messages behind this copy in the same ledger, while
          // allowing unaffected participants and conversations to progress.
          blocked.add(copy.sessionKey);
          this.warn(error);
        }
      }
    }
  }

  /** Launch committed-copy notifications outside the queue to permit replies. */
  private notify(): void {
    for (const delivery of this.deliveries.values()) {
      for (const copy of delivery.copies) {
        if (
          !copy.messageId ||
          (copy.published && (copy.role === "assistant" || copy.notified))
        )
          continue;
        const key = `${delivery.id}:${copy.agentId}`;
        if (this.notifying.has(key)) continue;
        this.notifying.add(key);
        // Retain an independent host scope before the HTTP/tool caller returns.
        // Perception may dispatch a reply which sends again: never await that
        // work from send() or while holding the ledger/state queue.
        inBackground(
          this.deps.api,
          () =>
            this.notifyCopy(delivery, copy).finally(() => {
              this.notifying.delete(key);
              this.scheduleRetry();
            }),
          (error) => {
            this.warn(error);
          },
        );
      }
    }
  }

  /**
   * Publish native transcript visibility, then hand the unchanged stimulus to
   * Perception.
   */
  private async notifyCopy(
    delivery: MessageDelivery,
    copy: MessageCopy,
  ): Promise<void> {
    this.assertCurrent();
    if (!copy.published) {
      await this.deps.publish(copy);
      await this.serial.enqueue("messages", async () => {
        await this.updateCopy(delivery, copy, { published: true });
      });
    }
    this.assertCurrent();
    if (copy.role === "user" && !copy.notified) {
      await this.deps.receive(copy.agentId, {
        id: delivery.id,
        sessionKey: copy.sessionKey,
        sender: delivery.sender,
        senderName: delivery.senderName,
        text: readAs(delivery.params),
        timestamp: delivery.timestamp,
      });
      await this.serial.enqueue("messages", async () => {
        await this.updateCopy(delivery, copy, { notified: true });
      });
    }
  }

  /** Retry retained infrastructure work only while something remains unsettled. */
  private scheduleRetry(): void {
    if (this.lifetime.signal.aborted || this.timer) return;
    const pending =
      !this.initialized ||
      [...this.chats.values()].some((chat) => chat.needsProjection) ||
      this.deliveries.size > 0;
    if (!pending) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      inBackground(
        this.deps.api,
        () => this.resume(),
        (error) => {
          this.warn(error);
        },
      );
    }, 1000);
    this.timer.unref();
  }

  private warn(error: unknown): void {
    if (!this.lifetime.signal.aborted)
      this.deps.warn(`Messaging delivery retained for retry: ${String(error)}`);
  }

  /** Revoke this generation's writes and timers; durable work survives reload. */
  dispose(): void {
    this.lifetime.abort();
    if (this.timer) clearTimeout(this.timer);
    // Speech and typing are shared with the other instances: what this
    // generation was saying stops on the lifetime above and removes itself,
    // and a stale typing signal expires on its own.
    this.listeners.clear();
  }
}
