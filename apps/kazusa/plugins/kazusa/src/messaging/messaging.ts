import type {
  ChatMessage,
  MessagesResponse,
  TypingStreamEvent,
} from "@kazusa/client";
import { runDetachedWebhookWork } from "openclaw/plugin-sdk/webhook-request-guards";
import { KeyedAsyncQueue } from "openclaw/plugin-sdk/core";
import { sleepSim, type Clock } from "../clock/clock.ts";
import { shutdownSignal } from "../shutdown.ts";
import type { CurrentSpeech } from "../perception/types.ts";
import type { RemovableStateStore, StateStore } from "../state.ts";
import type { Stimulus } from "../stimulus.ts";
import {
  DELIVERY_REQUEST,
  LIST_CHATS,
  SPEECH_REQUEST,
  bubbleOf,
  readAs,
  splitFaceToFace,
  MANAGE_CHAT,
  PARTICIPANT_ID,
  chatSummary,
  conversationId,
  isUser,
  messagingId,
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
export function clientMessage(delivery: MessageDelivery): ChatMessage {
  return {
    id: delivery.id,
    requestId: delivery.params.requestId,
    sequence: delivery.sequence,
    senderId: delivery.sender,
    senderName: delivery.senderName,
    text: delivery.params.text,
    ...(delivery.params.type === "action" ? { type: "action" } : {}),
    timestamp: delivery.timestamp,
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
    initialized: false,
    sequence: 0,
  };
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
  private readonly speaking = new Map<string, Speech>();
  /**
   * A speaker says one thing after another: sends started together (parallel
   * tool calls in one turn) queue here behind the one being said.
   */
  private readonly waitingSpeech = new Map<string, Set<Speech>>();
  private readonly speechTail = new Map<string, Promise<void>>();
  private readonly typing = new Map<
    string,
    { event: TypingStreamEvent; runId?: string }
  >();
  private timer?: NodeJS.Timeout;

  constructor(private readonly deps: MessagingDeps) {
    this.shared = deps.state ?? createMessagingState();
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

  public onEvent(listener: (event: MessagingEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Best-effort UI signals never affect canonical acceptance or attention. */
  private emit(event: MessagingEvent): void {
    for (const listener of this.listeners) {
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
    runId?: string,
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
      if (isTyping) this.typing.set(key, { event, runId });
      else this.typing.delete(key);
      this.emit({ type: "typing", typing: event, audience: chat.members });
    });
  }

  /** A stale run's terminal event must not clear a newer composition. */
  clearTyping(
    participantId: string,
    runId?: string,
    chatId?: string,
    exceptRunId?: string,
  ): void {
    for (const [key, value] of this.typing) {
      if (
        value.event.senderId !== participantId ||
        (runId && value.runId !== runId) ||
        (chatId && value.event.chatId !== chatId) ||
        (exceptRunId && value.runId === exceptRunId)
      )
        continue;
      this.typing.delete(key);
      this.emit({
        type: "typing",
        typing: { ...value.event, isTyping: false },
        audience: this.chats.get(value.event.chatId)?.members ?? [],
      });
    }
  }

  getComposingChats(participantId: string): string[] {
    const chatIds: string[] = [];
    const now = Date.now();
    for (const [, value] of this.typing) {
      if (value.event.senderId === participantId && value.event.isTyping) {
        if (value.event.expiresAt && value.event.expiresAt <= now) continue;
        chatIds.push(value.event.chatId);
      }
    }
    return chatIds;
  }

  /** Reconnecting clients recover only current, visible composition signals. */
  async getTyping(viewer: string): Promise<TypingStreamEvent[]> {
    return this.serial.enqueue("messages", async () => {
      await this.init();
      return [...this.typing.values()]
        .map(({ event }) => event)
        .filter((event) => {
          const members = this.chats.get(event.chatId)?.members ?? [];
          return (
            (!event.expiresAt || event.expiresAt > Date.now()) &&
            members.includes(viewer) &&
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
        if (!chat.members.includes(member))
          this.clearTyping(member, undefined, chat.id);
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
   * message. Direct pairs reuse their one conversation. New groups derive an
   * opaque ID from the send request so a retry cannot create another group.
   */
  private async resolveChat(
    sender: string,
    id: string,
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
          creationFingerprint: messagingId([sender, ...members]),
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
    if (others.includes(sender))
      throw new Error(
        "Exclude yourself from members; the sender is added automatically.",
      );
    if (params.aloud) {
      return await this.startHuddle(
        sender,
        id,
        others,
        assertInvocationCurrent,
      );
    }
    const members = [sender, ...others].sort();
    this.validateMembers(members, configuredAgents);
    const kind =
      others.length === 1 && params.title === null ? "direct" : "group";
    const chatId =
      kind === "direct" ? `direct:${messagingId(members)}` : `group:${id}`;
    const creationFingerprint = messagingId([
      sender,
      ...members,
      params.title ?? "",
    ]);
    const existing = this.chats.get(chatId);
    if (existing) {
      if (
        kind === "group" &&
        existing.creationFingerprint !== creationFingerprint
      )
        throw new Error(
          "Host tool call already belongs to a different chat creation.",
        );
      if (!existing.members.includes(sender))
        throw new Error("You are no longer a member of this chat.");
      return existing;
    }
    const chat: ChatConversation = {
      id: chatId,
      kind,
      members,
      title: kind === "group" ? (params.title ?? "Group chat") : null,
      creationFingerprint,
      needsProjection: true,
    };
    await this.saveChat(chat, assertInvocationCurrent);
    return chat;
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

      // Records are keyed by stable message ID, not a chat/sequence index.
      // Filter audience before paging so invisible messages cannot hide an
      // older eligible page across a leave/rejoin interval.
      const entries = await this.deps.store.entries();
      const eligible = entries
        .map(({ value }) => value)
        .filter(
          (message) =>
            message.chatId === chatId &&
            message.audience.includes(input.userId) &&
            (before === undefined || message.sequence < before),
        )
        .sort((a, b) => b.sequence - a.sequence);
      const hasMore = eligible.length > limit;
      const page = eligible.slice(0, limit);
      page.sort((a, b) => a.sequence - b.sequence);

      const messages = page.map(clientMessage);

      const nextCursor =
        hasMore && page.length > 0 ? page[0].sequence : undefined;
      return {
        messages,
        nextCursor,
        hasMore,
      };
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
      if (chat.kind === "huddle")
        throw new Error(
          "A conversation in person forms and ends on its own; to leave it, walk away.",
        );
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
    if (!place)
      throw new Error(
        "You're on your way, so nobody is close enough to hear. Text them instead.",
      );
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
        ["drift", who, chat.id, keep],
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
   * Speaking aloud to people where you are brings them into your conversation,
   * with whoever they are talking with: two groups merge into one, the way
   * people turn and join in. Without a conversation of your own you join
   * theirs, or a new one starts. Each of the others' old conversations points
   * at the merged one, so a reply into it still lands there.
   */
  private async startHuddle(
    sender: string,
    id: string,
    others: readonly string[],
    assertInvocationCurrent?: () => void,
  ): Promise<ChatConversation> {
    const chatId = `huddle:${id}`;
    const existing = this.chats.get(chatId);
    if (existing) return existing;
    const place = await this.standingPlace(sender);
    for (const other of others) {
      if ((await this.deps.placeOf?.(other))?.placeId !== place.placeId)
        throw new Error(
          `${other} isn't here, so they can't hear you. Text them instead.`,
        );
    }
    const speakers = [sender, ...others];
    const groups = [...this.chats.values()].filter(
      (chat) =>
        chat.kind === "huddle" &&
        chat.placeId === place.placeId &&
        chat.members.some((member) => speakers.includes(member)),
    );
    const base =
      groups.find((chat) => chat.members.includes(sender)) ?? groups[0];
    if (base) {
      for (const group of groups) {
        if (group.id !== base.id)
          await this.saveChat({ ...group, members: [], mergedInto: base.id });
      }
      const merged: ChatConversation = {
        ...base,
        members: [
          ...new Set([...speakers, ...groups.flatMap((chat) => chat.members)]),
        ].sort(),
        needsProjection: true,
      };
      await this.saveChat(merged, assertInvocationCurrent);
      return merged;
    }
    const chat: ChatConversation = {
      id: chatId,
      kind: "huddle",
      members: [sender, ...others].sort(),
      title: `Talking at ${place.title}`,
      placeId: place.placeId,
      needsProjection: true,
    };
    await this.saveChat(chat, assertInvocationCurrent);
    return chat;
  }

  /** Speaking into a huddle at your place joins it. */
  private async joinHuddle(
    sender: string,
    addressed: ChatConversation | undefined,
  ): Promise<ChatConversation> {
    let chat = addressed;
    while (chat?.mergedInto) chat = this.chats.get(chat.mergedInto);
    if (!chat || chat.members.length === 0)
      throw new Error("That conversation is over. Speak aloud to start one.");
    if (!chat.members.includes(sender)) {
      const place = await this.deps.placeOf?.(sender);
      if (place?.placeId !== chat.placeId)
        throw new Error(
          "You aren't there, so nobody in it can hear you. Text them instead.",
        );
    }
    if (chat.members.includes(sender)) return chat;
    await this.leaveOtherHuddles(sender, chat.id);
    const joined: ChatConversation = {
      ...chat,
      members: [...chat.members, sender].sort(),
      needsProjection: true,
    };
    await this.saveChat(joined);
    return joined;
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
    this.clearTyping(sender, undefined, delivery.chatId);
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
    PARTICIPANT_ID.parse(sender);
    const params = DELIVERY_REQUEST.parse(input);
    params.members?.sort();
    params.title ??= null;
    if (params.sessionKey) {
      params.sessionKey = ownChatSession(sender, params.sessionKey);
      delete params.members;
      delete params.aloud;
      params.title = null;
    }
    const id = messagingId([sender, params.requestId]);
    const result = await this.serial.enqueue("messages", async () => {
      await this.init();
      this.assertCurrent();
      assertInvocationCurrent?.();
      // Settled messages leave RAM, not history. Always consult the canonical
      // record before accepting a host replay with today's membership/time.
      let delivery =
        this.deliveries.get(id) ?? (await this.deps.store.lookup(id));
      let chat: ChatConversation | undefined;
      if (delivery) {
        if (JSON.stringify(delivery.params) !== JSON.stringify(params)) {
          throw new Error(
            "Host tool call already belongs to a different message.",
          );
        }
        chat = this.chats.get(delivery.chatId);
      } else {
        chat = await this.resolveChat(
          sender,
          id,
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
  ): Promise<SpeechResult> {
    const { sender, senderName, params } = plan;
    const { messages, requestId, ...target } = params;
    // Actions are seen only where the speaker is; in a text chat they are
    // dropped, so a model that adds one by habit changes nothing there. The
    // original index keeps each bubble's identity stable across replays.
    const inPlace =
      target.aloud === true ||
      Boolean(target.sessionKey?.match(/(?:^|:)chat:huddle:/));
    const bubbles = messages.flatMap((bubble, at) => {
      const typed = bubbleOf(bubble);
      const pieces = inPlace
        ? splitFaceToFace(typed)
        : typed.type === "action"
          ? []
          : [typed];
      // The first piece keeps the bubble's own identity; later ones extend it.
      return pieces.map((piece, part) => ({
        index: part === 0 ? String(at) : `${at}.${part}`,
        ...piece,
      }));
    });
    const speech: Speech = {
      planId: plan.id,
      controller: new AbortController(),
      params,
      planned: bubbles.map(readAs),
      said: [],
    };
    const signal = AbortSignal.any([
      speech.controller.signal,
      this.lifetime.signal,
    ]);
    const sent: SendMessageResult[] = [];
    let paced = live;
    let release: (() => void) | undefined;
    const turn = live
      ? new Promise<void>((resolve) => {
          release = resolve;
        })
      : undefined;
    try {
      if (live && turn) {
        // Live, a later send cut off an earlier one from the same message
        // before it said a word.
        const before = this.speechTail.get(sender);
        this.speechTail.set(sender, turn);
        const waiting = this.waitingSpeech.get(sender) ?? new Set<Speech>();
        this.waitingSpeech.set(sender, waiting);
        waiting.add(speech);
        try {
          await before;
        } finally {
          waiting.delete(speech);
        }
        // Interrupted while waiting its turn: nothing to say or retain.
        signal.throwIfAborted();
        this.speaking.set(sender, speech);
      }
      await this.init();
      if (live)
        await this.deps.outbox.register(plan.id, plan, {
          assertCurrent: () => {
            this.assertCurrent();
            assertInvocationCurrent?.();
          },
        });
      for (const { index, text, type } of bubbles) {
        const first = sent[0];
        const bubble: SendMessageParams = {
          ...(first ? { sessionKey: first.sessionKey } : target),
          text,
          ...(type === "action" ? { type } : {}),
          requestId: messagingId([requestId, index]),
        };
        if (
          first &&
          paced &&
          !(await this.accepted(sender, bubble.requestId))
        ) {
          await this.setTyping(
            sender,
            senderName,
            first.sessionKey,
            true,
            undefined,
            assertInvocationCurrent,
          );
          // A paused world holds the next bubble; a stopping Gateway lets the
          // rest go at once rather than wait on a frozen clock.
          paced = await sleepSim(this.deps.clock, typingMs(text), signal, {
            release: this.deps.release ?? shutdownSignal(),
          });
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
      }
    } catch (error) {
      if (!speech.controller.signal.aborted) throw error;
    } finally {
      try {
        // Keep the plan only for a later generation to flush; forget it before
        // releasing the speaker so recovery can never resurrect dropped bubbles.
        if (!this.lifetime.signal.aborted)
          await this.deps.outbox.delete(plan.id);
      } finally {
        if (this.speaking.get(sender) === speech) this.speaking.delete(sender);
        release?.();
        if (this.speechTail.get(sender) === turn)
          this.speechTail.delete(sender);
      }
    }
    const unsaid = bubbles.slice(sent.length).map(readAs);
    if (unsaid.length && sent[0])
      this.clearTyping(sender, undefined, sent[0].chatId);
    return {
      status: unsaid.length
        ? "interrupted"
        : sent.every((result) => result.status === "delivered")
          ? "delivered"
          : "pending",
      sessionKey: sent[0]?.sessionKey ?? target.sessionKey ?? "",
      recipients: sent.at(-1)?.recipients ?? [],
      messageIds: sent.map((result) => result.messageId),
      said: bubbles.slice(0, sent.length).map(readAs),
      unsaid,
    };
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
    const current = this.speaking.get(agentId);
    const stopped = [
      ...(current ? [current] : []),
      ...(this.waitingSpeech.get(agentId) ?? []),
    ];
    for (const speech of stopped)
      speech.controller.abort(new Error("Speech interrupted"));
    return stopped.length > 0;
  }

  currentSpeech(agentId: string): CurrentSpeech | undefined {
    const speech = this.speaking.get(agentId);
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
            unanswered: tail?.since.length ?? 0,
            waitingSince: tail?.since[0]?.timestamp ?? null,
          },
        ];
      });
    });
  }

  /** Send every bubble of plans a previous generation left unfinished. */
  private async flushOutbox(): Promise<void> {
    for (const { value: plan } of await this.deps.outbox.entries()) {
      if (this.lifetime.signal.aborted) return;
      if (
        this.flushing.has(plan.id) ||
        [...this.speaking.values()].some((speech) => speech.planId === plan.id)
      )
        continue;
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
        void runDetachedWebhookWork(() => this.notifyCopy(delivery, copy))
          .catch((error: unknown) => this.warn(error))
          .finally(() => {
            this.notifying.delete(key);
            this.scheduleRetry();
          });
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
      void runDetachedWebhookWork(() => this.resume()).catch((error: unknown) =>
        this.warn(error),
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
    this.typing.clear();
    this.speaking.clear();
    this.waitingSpeech.clear();
    this.speechTail.clear();
    this.listeners.clear();
  }
}
