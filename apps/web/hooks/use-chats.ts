"use client";

import { useEffect, useMemo } from "react";
import useSWR, { useSWRConfig } from "swr";
import useSWRInfinite, { unstable_serialize } from "swr/infinite";
import {
  fetchChats,
  fetchMessages,
  manageChat,
  sendMessage,
} from "@/lib/source/chats/http";
import { useCharacters } from "@/hooks/use-characters";
import { chatTitle } from "@/lib/source/chats/display";
import { observedChatsKey } from "@/lib/source/observe/http";
import { messagesKeyGetter } from "@/lib/source/chats/pagination";
import { saveConfig, useKazusaConfig } from "@/lib/state/config-store";
import type {
  ChatMessage,
  ChatType,
  ChatsResponse,
  ManageChatPayload,
  MessagesResponse,
  ReadStreamEvent,
} from "@kazusa/client";
import type { Chat, ChatInfo, MessageType } from "@/lib/source/chats/types";
import type { KazusaConfig } from "@/lib/state/config-store";

export function chatsKey(config: Pick<KazusaConfig, "userId">) {
  return ["kazusa/chats", config.userId] as const;
}

export function messagesCacheKey(config: KazusaConfig, chatId: string) {
  return unstable_serialize(messagesKeyGetter(config, chatId));
}

export function sortChats<T extends ChatInfo>(chats: T[]) {
  return [...chats].sort(
    (a, b) => (b.lastMessage?.sequence ?? 0) - (a.lastMessage?.sequence ?? 0),
  );
}

/**
 * The raw chats resource. The sources provider reads it as the reachability
 * probe, so it must not depend on anything the provider supplies.
 */
export function useChatsResource() {
  const config = useKazusaConfig();
  const resource = useSWR<ChatsResponse, Error, ReturnType<typeof chatsKey>>(
    chatsKey(config),
    () => fetchChats(),
  );
  const { data } = resource;

  useEffect(() => {
    if (
      data &&
      (config.userId !== data.user.id || config.userName !== data.user.name)
    ) {
      saveConfig({ ...config, userId: data.user.id, userName: data.user.name });
    }
  }, [data, config]);

  return resource;
}

/** The player's chats, newest first, titled for display. */
export function useChats() {
  const config = useKazusaConfig();
  const { data, error, isLoading, mutate } = useChatsResource();
  const { byId } = useCharacters();
  const chats = useMemo(() => {
    const userId = data?.user.id ?? config.userId;
    const nameOf = (id: string) =>
      byId.get(id)?.name ?? (id === userId ? data?.user.name : undefined) ?? id;
    return sortChats(
      (data?.chats ?? []).map((chat) => ({
        ...chat,
        name: chatTitle(chat, userId, nameOf),
      })),
    );
  }, [data, byId, config.userId]);

  return {
    chats,
    error,
    isLoading,
    reload: mutate,
  };
}

export function useMessages(chatId: string | null) {
  const config = useKazusaConfig();
  return usePagedMessages(messagesKeyGetter(config, chatId), (id, before) =>
    fetchMessages({ chatId: id, before }),
  );
}

/** Pages of one chat's history, merged and deduplicated, oldest first. */
export function usePagedMessages<T extends MessagesResponse>(
  getKey: ReturnType<typeof messagesKeyGetter>,
  fetchPage: (chatId: string, before: number | null) => Promise<T>,
) {
  const { data, error, isLoading, size, setSize, isValidating, mutate } =
    useSWRInfinite<T, Error, ReturnType<typeof messagesKeyGetter>>(
      getKey,
      ([, , id, before]) => fetchPage(id, before),
      { revalidateFirstPage: true, revalidateOnFocus: false },
    );

  const messages = useMemo(() => {
    const seen = new Map<string, ChatMessage>();
    for (const page of data ?? []) {
      for (const message of page.messages) seen.set(message.id, message);
    }
    return [...seen.values()].sort((a, b) => a.sequence - b.sequence);
  }, [data]);

  const lastPage = data?.[data.length - 1];
  const hasMore = Boolean(lastPage?.hasMore);
  const isLoadingOlder =
    size > 0 && data !== undefined && typeof data[size - 1] === "undefined";

  return {
    messages,
    error,
    isLoading,
    isValidating,
    hasMore,
    isLoadingOlder,
    loadOlder: () => setSize(size + 1),
    mutate,
  };
}

export function appendMessageToPages(
  pages: MessagesResponse[] | undefined,
  message: ChatMessage,
) {
  if (!pages || pages.length === 0) return pages;
  if (pages.some((page) => page.messages.some((m) => m.id === message.id))) {
    return pages;
  }
  const [first, ...rest] = pages;
  // History gets this from the stored record; a live message arrives as it's sent.
  const timed = { ...message, createdAt: message.createdAt ?? Date.now() };
  return [{ ...first, messages: [...first.messages, timed] }, ...rest];
}

/** A character read these messages: their receipts gain the time. */
export function markReadInPages(
  pages: MessagesResponse[] | undefined,
  { readerId, readAt, messageIds }: ReadStreamEvent,
) {
  if (!pages) return pages;
  const ids = new Set(messageIds);
  return pages.map((page) => ({
    ...page,
    messages: page.messages.map((message) =>
      ids.has(message.id) && message.receipts
        ? {
            ...message,
            receipts: message.receipts.map((receipt) =>
              receipt.id === readerId && receipt.readAt === undefined
                ? { ...receipt, readAt }
                : receipt,
            ),
          }
        : message,
    ),
  }));
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

export function useChatActions() {
  const config = useKazusaConfig();
  const { mutate } = useSWRConfig();

  async function send(
    chat: Chat,
    text: string,
    requestId: string,
    type?: MessageType,
  ) {
    return sendMessage(
      chat.draft
        ? {
            requestId,
            text,
            members: chat.members.filter((id) => id !== config.userId),
            ...(chat.type === "group" ? { title: chat.name } : {}),
            // Face to face: it joins or starts a huddle where you stand.
            ...(chat.type === "huddle"
              ? { aloud: true, ...(type === "action" ? { type } : {}) }
              : {}),
          }
        : {
            requestId,
            text,
            sessionKey: chat.sessionKey,
            ...(type === "action" ? { type } : {}),
          },
    );
  }

  function commitSentMessage(chatId: string, message: ChatMessage) {
    void mutate(
      messagesCacheKey(config, chatId),
      (pages?: MessagesResponse[]) => appendMessageToPages(pages, message),
      { revalidate: false },
    );
    void mutate(
      chatsKey(config),
      (current?: ChatsResponse) => updateChatPreview(current, chatId, message),
      { revalidate: false },
    );
  }

  function createChat(input: {
    type: ChatType;
    name: string;
    members: string[];
    placeId?: string;
  }): Chat {
    return {
      ...input,
      id: `draft:${crypto.randomUUID()}`,
      sessionKey: "",
      members: [...new Set([config.userId, ...input.members])],
      draft: true,
    };
  }

  /**
   * Renames a group or changes who is in it. Leaving drops it from the player's
   * chats (it is read-only under Other chats from then on).
   */
  async function manage(payload: ManageChatPayload) {
    const response = await manageChat(payload);
    const left = !response.chat.members.includes(config.userId);
    await mutate(
      chatsKey(config),
      (current?: ChatsResponse) =>
        current && {
          ...current,
          chats: left
            ? current.chats.filter((chat) => chat.id !== response.chat.id)
            : current.chats.map((chat) =>
                chat.id === response.chat.id ? response.chat : chat,
              ),
        },
      { revalidate: true },
    );
    if (left) await mutate(observedChatsKey());
    return response.chat;
  }

  /**
   * Calls people standing where you are over to your conversation in person: an
   * action said aloud to them, which brings in anyone not already talking with
   * someone else.
   */
  async function callOver(chat: Chat, members: string[], text: string) {
    const response = await sendMessage({
      requestId: crypto.randomUUID(),
      text,
      type: "action",
      aloud: true,
      members,
    });
    commitSentMessage(response.chatId, response.message);
    await mutate(chatsKey(config));
    if (response.chatId !== chat.id) await mutate(observedChatsKey());
    return response;
  }

  async function refreshChats() {
    await mutate(chatsKey(config));
  }
  return {
    config,
    send,
    commitSentMessage,
    createChat,
    manage,
    callOver,
    refreshChats,
  };
}
