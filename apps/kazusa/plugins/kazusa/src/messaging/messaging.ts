import { KeyedAsyncQueue } from "openclaw/plugin-sdk/core";
import type { Clock } from "../clock/clock.ts";
import type { StateStore } from "../state.ts";
import type { Stimulus } from "../stimulus.ts";
import {
  AGENT_ID,
  DELIVERY_REQUEST,
  LIST_CHATS,
  MANAGE_CHAT,
  PARTICIPANT_ID,
  chatSummary,
  conversationId,
  isUser,
  messagingId,
  ownChatSession,
  type ChatConversation,
  type ChatSummary,
  type ManageChatParams,
  type SendMessageParams,
} from "./conversations.ts";

export interface GetChatHistoryInput {
  readonly chatId: string;
  readonly userId: string;
  readonly before?: number;
  readonly limit?: number;
}

export interface ChatHistoryMessage {
  readonly id: string;
  readonly sequence: number;
  readonly sender: string;
  readonly senderName: string;
  readonly text: string;
  readonly timestamp: number;
}

export interface ChatHistoryResult {
  readonly messages: readonly ChatHistoryMessage[];
  readonly nextCursor?: number;
  readonly hasMore: boolean;
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
  readonly clock: Pick<Clock, "init" | "time">;
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
}

/**
 * Owns canonical messages and conversation membership. Native transcripts are
 * private agent projections; Perception owns attention. One queue serializes
 * membership edits with send acceptance so each message freezes one audience.
 * Brain admission runs outside that queue and never blocks the sending tool.
 */
export class Messaging {
  private readonly serial = new KeyedAsyncQueue();
  private readonly lifetime = new AbortController();
  private readonly deliveries = new Map<string, MessageDelivery>();
  private readonly chats = new Map<string, ChatConversation>();
  private readonly notifying = new Set<string>();
  private initialized = false;
  private sequence = 0;
  private timer?: NodeJS.Timeout;

  constructor(private readonly deps: MessagingDeps) {}

  readonly assertCurrent = (): void => this.lifetime.signal.throwIfAborted();

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
    this.chats.set(chat.id, chat);
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
      const full = ownChatSession(sender, params.sessionKey);
      const parts = full.split(":");
      const kind = parts[3];
      const peer = parts.slice(4).join(":");
      const chatId = conversationId(sender, params.sessionKey);
      const existing = this.chats.get(chatId);
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
    const members = [sender, ...others].sort();
    this.validateMembers(members, configuredAgents);
    const kind =
      others.length === 1 && params.title === undefined ? "direct" : "group";
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
      title: kind === "group" ? (params.title ?? "Group chat") : undefined,
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
   * Return subjective, cursor-paginated chat history for a participant.
   * Only messages accepted while the participant was in the frozen audience
   * are returned, strictly respecting join and leave timeline boundaries.
   */
  async getChatHistory(
    input: GetChatHistoryInput,
    assertInvocationCurrent?: () => void,
  ): Promise<ChatHistoryResult> {
    PARTICIPANT_ID.parse(input.userId);
    const chatId = input.chatId;
    const limit = Math.max(1, Math.min(input.limit ?? 30, 100));
    const before = input.before;

    return await this.serial.enqueue("messages", async () => {
      await this.init();
      assertInvocationCurrent?.();

      let candidates: MessageDelivery[];
      if (this.deps.store.entriesInKeyRange) {
        const endSeq = before !== undefined ? before : 9999999999;
        const endPadded = String(endSeq).padStart(10, "0");
        const entries = await this.deps.store.entriesInKeyRange({
          keyStartInclusive: `msg:${chatId}:0000000000`,
          keyEndExclusive: `msg:${chatId}:${endPadded}`,
          limit: (limit + 1) * 2,
          order: "desc",
        });
        candidates = entries.map((e) => e.value);
      } else {
        const entries = await this.deps.store.entries();
        candidates = entries
          .map((e) => e.value)
          .filter((d) => d.chatId === chatId)
          .sort((a, b) => b.sequence - a.sequence);
        if (before !== undefined) {
          candidates = candidates.filter((d) => d.sequence < before);
        }
      }

      const eligible = candidates.filter((d) =>
        d.audience.includes(input.userId),
      );
      const hasMore = eligible.length > limit;
      const page = eligible.slice(0, limit);
      page.sort((a, b) => a.sequence - b.sequence);

      const messages: ChatHistoryMessage[] = page.map((d) => ({
        id: d.id,
        sequence: d.sequence,
        sender: d.sender,
        senderName: d.senderName,
        text: d.params.text,
        timestamp: d.timestamp,
      }));

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
      if (chat.kind !== "group")
        throw new Error(
          "Direct chats have fixed membership; create a new group instead.",
        );
      let members = [...chat.members];
      if (params.action === "add_members") {
        this.validateMembers(params.members, configuredAgents);
        members = [...new Set([...members, ...params.members])].sort();
      } else if (params.action === "remove_members") {
        members = members.filter((member) => !params.members.includes(member));
      } else if (params.action === "leave")
        members = members.filter((member) => member !== agentId);
      this.validateMembers(members);
      const updated: ChatConversation = {
        ...chat,
        members,
        title: params.action === "rename" ? params.title : chat.title,
        needsProjection: true,
      };
      await this.saveChat(updated, assertInvocationCurrent);
      await this.projectChats();
      return chatSummary(updated, agentId);
    });
    this.scheduleRetry();
    return result;
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
    if (params.sessionKey) {
      params.sessionKey = ownChatSession(sender, params.sessionKey);
      params.members = undefined;
      params.title = undefined;
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
        const timestamp = this.deps.clock.time();
        const owners = [
          sender,
          ...chat.members.filter((member) => member !== sender),
        ];
        const activeChat = chat;
        const copies: MessageCopy[] = owners
          .filter((agentId) => !isUser(agentId))
          .map((agentId) => ({
            agentId,
            sessionKey: chatSummary(activeChat, agentId).sessionKey,
            role: agentId === sender ? "assistant" : "user",
          }));
        delivery = {
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
      }
      await this.projectChats();
      await this.flushLedgers();
      return {
        messageId: id,
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

  /** Recover metadata projections and pending copies without invoking a brain. */
  async resume(): Promise<void> {
    try {
      await this.serial.enqueue("messages", async () => {
        await this.init();
        await this.projectChats();
        await this.flushLedgers();
      });
      this.notify();
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
        // receive() may await a brain turn which itself sends a message. Never
        // await it from send() or while holding the ledger/state queue.
        void this.notifyCopy(delivery, copy)
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
        text: delivery.params.text,
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
      void this.resume().catch((error: unknown) => this.warn(error));
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
  }
}
