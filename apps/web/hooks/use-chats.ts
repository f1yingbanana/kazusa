"use client";

import { useMemo } from "react";
import useSWR, { useSWRConfig } from "swr";
import useSWRInfinite from "swr/infinite";
import {
  fetchChats,
  fetchMessages,
  manageChat,
  sendMessage,
} from "@/lib/source/chats/http";
import { useAccess } from "@/hooks/use-access";
import { useCharacters } from "@/hooks/use-characters";
import { chatTitle } from "@/lib/source/chats/display";
import { observedChatsKey } from "@/lib/source/observe/http";
import { messagesKeyGetter } from "@/lib/source/chats/pagination";
import { useSources } from "@/lib/source/provider";
import { applySceneEvent, syncSceneMembers } from "@/lib/live/scene-state";
import {
  appendCachedMessage,
  chatsKey,
  updateChatPreview,
} from "@/lib/source/chats/cache";
import type {
  ChatMessage,
  ChatType,
  ChatsResponse,
  ManageChatPayload,
  MessagesResponse,
} from "@kazusa/client";
import type { Chat, ChatInfo, MessageType } from "@/lib/source/chats/types";

export function sortChats<T extends ChatInfo>(chats: T[]) {
  return [...chats].sort(
    (a, b) => (b.lastMessage?.sequence ?? 0) - (a.lastMessage?.sequence ?? 0),
  );
}

/**
 * The player's raw chat list, shared with setup polling and SSE updates. Each
 * accepted read (SSE `chats` refetches it) gives open scenes their members.
 */
export function useChatsResource() {
  return useSWR<ChatsResponse, Error, ReturnType<typeof chatsKey>>(
    chatsKey(),
    fetchChats,
    { onSuccess: ({ chats }) => syncSceneMembers(chats) },
  );
}

/** The player's chats, newest first, titled for display. */
export function useChats() {
  const { player } = useSources();
  const { data, error, isLoading, mutate } = useChatsResource();
  const { byId } = useCharacters();
  const chats = useMemo(() => {
    const userId = player.id;
    const nameOf = (id: string) =>
      byId.get(id)?.name ?? (id === userId ? player.name : undefined) ?? id;
    return sortChats(
      (data?.chats ?? []).map((chat) => ({
        ...chat,
        name: chatTitle(chat, userId, nameOf),
      })),
    );
  }, [data, byId, player.id, player.name]);

  return {
    chats,
    error,
    isLoading,
    reload: mutate,
  };
}

export function useMessages(chatId: string | null) {
  return usePagedMessages(messagesKeyGetter(chatId), (id, before) =>
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
      ([, id, before]) => fetchPage(id, before),
      {
        revalidateFirstPage: true,
        revalidateOnFocus: false,
        // The latest page seeds an open scene with what it hasn't seen. Here,
        // not in the fetcher: SWR stores the pages right after this, so a
        // scene opening meanwhile reads them from the cache instead.
        onSuccess: (pages) => {
          const chatId = getKey(0, null)?.[1];
          const latest = pages[0];
          if (chatId && latest)
            applySceneEvent(chatId, {
              type: "history",
              messages: latest.messages,
              at: Date.now(),
            });
        },
      },
    );

  const messages = useMemo(() => {
    const seen = new Map<string, ChatMessage>();
    for (const page of data ?? []) {
      for (const message of page.messages) seen.set(message.id, message);
    }
    return [...seen.values()].sort((a, b) => a.sequence - b.sequence);
  }, [data]);

  const lastPage = data?.[data.length - 1];
  const hasMore = Boolean(
    lastPage?.hasMore && lastPage.nextCursor !== undefined,
  );
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

export function useChatActions() {
  const { player } = useSources();
  const { canPlay } = useAccess();
  const { mutate } = useSWRConfig();

  async function send(
    chat: Chat,
    text: string,
    requestId: string,
    type?: MessageType,
  ) {
    if (!canPlay) {
      throw new Error("You do not have permission to send messages.");
    }
    return sendMessage(
      chat.draft
        ? {
            requestId,
            text,
            members: chat.members.filter((id) => id !== player.id),
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
    applySceneEvent(chatId, { type: "message", message, at: Date.now() });
    void appendCachedMessage(mutate, chatId, message);
    void mutate(
      chatsKey(),
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
      members: [...new Set([player.id, ...input.members])],
      draft: true,
    };
  }

  /**
   * Renames a group or changes who is in it. Leaving drops it from the player's
   * chats (it is read-only under Other chats from then on).
   */
  async function manage(payload: ManageChatPayload) {
    if (!canPlay) {
      throw new Error("You do not have permission to manage chats.");
    }
    const response = await manageChat(payload);
    const left = !response.chat.members.includes(player.id);
    await mutate(
      chatsKey(),
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
    if (!canPlay) {
      throw new Error("You do not have permission to call people over.");
    }
    const response = await sendMessage({
      requestId: crypto.randomUUID(),
      text,
      type: "action",
      aloud: true,
      members,
    });
    commitSentMessage(response.chatId, response.message);
    await mutate(chatsKey());
    if (response.chatId !== chat.id) await mutate(observedChatsKey());
    return response;
  }

  async function refreshChats() {
    await mutate(chatsKey());
  }
  return {
    player,
    send,
    commitSentMessage,
    createChat,
    manage,
    callOver,
    refreshChats,
  };
}
