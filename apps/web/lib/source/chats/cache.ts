import type {
  ChatMessage,
  MessagesResponse,
  ReadStreamEvent,
} from "@kazusa/client";
import { unstable_serialize } from "swr/infinite";
import type { ScopedMutator } from "swr";
import type { ChatInfo } from "./types";
import { messagesKeyGetter } from "./pagination";

export function chatsKey() {
  return ["kazusa/chats"] as const;
}

export function messagesCacheKey(chatId: string, route?: string): string {
  return unstable_serialize(messagesKeyGetter(chatId, route));
}

/** Updates SWR's page cache and its infinite aggregate together. */
async function updateMessagesCache(
  mutate: ScopedMutator,
  chatId: string,
  update: (page: MessagesResponse) => MessagesResponse,
  route: string,
  allPages = false,
): Promise<void> {
  await mutate<MessagesResponse>(
    (key) =>
      Array.isArray(key) &&
      key[0] === route &&
      key[1] === chatId &&
      (allPages || key[2] === null),
    (page) => page && update(page),
    { revalidate: false },
  );
  await mutate<MessagesResponse[]>(
    messagesCacheKey(chatId, route),
    (pages) =>
      pages?.map((page, index) =>
        allPages || index === 0 ? update(page) : page,
      ),
    // A stream event can beat the first history response. Let SWR restart that
    // request rather than discard it and leave an empty mounted resource.
    { revalidate: (pages) => pages === undefined },
  );
}

export function appendCachedMessage(
  mutate: ScopedMutator,
  chatId: string,
  message: ChatMessage,
  route = "kazusa/messages",
): Promise<void> {
  const timed = { ...message, createdAt: message.createdAt ?? Date.now() };
  return updateMessagesCache(
    mutate,
    chatId,
    (page) =>
      page.messages.some((item) => item.id === message.id)
        ? page
        : { ...page, messages: [...page.messages, timed] },
    route,
  );
}

/** Read receipts can refer to any loaded history page. */
export function markCachedMessagesRead(
  mutate: ScopedMutator,
  event: ReadStreamEvent,
): Promise<void> {
  const ids = new Set(event.messageIds);
  return updateMessagesCache(
    mutate,
    event.chatId,
    (page) => ({
      ...page,
      messages: page.messages.map((message) =>
        ids.has(message.id) && message.receipts
          ? {
              ...message,
              receipts: message.receipts.map((receipt) =>
                receipt.id === event.readerId && receipt.readAt === undefined
                  ? { ...receipt, readAt: event.readAt }
                  : receipt,
              ),
            }
          : message,
      ),
    }),
    "kazusa/messages",
    true,
  );
}

export function updateChatPreview<
  T extends { readonly chats: readonly ChatInfo[] },
>(current: T | undefined, chatId: string, message: ChatMessage): T | undefined {
  if (!current) return current;
  return {
    ...current,
    chats: current.chats.map((chat) =>
      chat.id === chatId &&
      (chat.lastMessage?.sequence ?? 0) <= message.sequence
        ? {
            ...chat,
            lastMessage: {
              text: message.text,
              timestamp: message.timestamp,
              sequence: message.sequence,
              senderId: message.senderId,
              senderName: message.senderName,
              type: message.type,
            },
          }
        : chat,
    ),
  };
}
