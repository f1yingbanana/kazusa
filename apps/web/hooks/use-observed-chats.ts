"use client";

import { useMemo } from "react";
import useSWR from "swr";
import type { MessagesResponse, ObservedChatsResponse } from "@kazusa/client";
import { usePagedMessages, sortChats } from "@/hooks/use-chats";
import { chatTitle } from "@/lib/source/chats/display";
import { messagesKeyGetter } from "@/lib/source/chats/pagination";
import {
  OBSERVED_MESSAGES_KEY,
  fetchObservedChats,
  fetchObservedMessages,
  observedChatsKey,
} from "@/lib/source/observe/http";
import { useSources } from "@/lib/source/provider";
import { useKazusaConfig } from "@/lib/state/config-store";

/**
 * The one read path for chats the player isn't in. Reads nothing in the world
 * and changes nothing; when the Player lens comes, redaction belongs here.
 */
function useObservedResource() {
  const { resolved } = useSources();
  const live = resolved.observe === "live";
  const resource = useSWR<ObservedChatsResponse, Error>(
    live ? observedChatsKey() : null,
    () => fetchObservedChats(),
    { revalidateOnFocus: false },
  );
  return { ...resource, available: live };
}

/** Chats the player isn't in, newest first, titled for display. */
export function useObservedChats() {
  const { data, error, isLoading, mutate, available } = useObservedResource();
  const { charactersById, player } = useSources();
  const chats = useMemo(() => {
    const nameOf = (id: string) => charactersById.get(id)?.name ?? id;
    return sortChats(
      (data?.chats ?? []).map((chat) => ({
        ...chat,
        name: chatTitle(chat, player.id, nameOf),
      })),
    );
  }, [data, charactersById, player.id]);
  return { chats, error, isLoading, reload: mutate, available };
}

/** One observed chat by id: chips can ask without sorting the whole list. */
export function useObservedChat(id: string | null | undefined) {
  const { data, available } = useObservedResource();
  const { charactersById, player } = useSources();
  const chat = id ? data?.chats.find((candidate) => candidate.id === id) : null;
  return {
    available,
    chat: chat
      ? {
          ...chat,
          name: chatTitle(
            chat,
            player.id,
            (member) => charactersById.get(member)?.name ?? member,
          ),
        }
      : null,
  };
}

export function useObservedMessages(chatId: string | null) {
  const config = useKazusaConfig();
  return usePagedMessages<MessagesResponse>(
    messagesKeyGetter(config, chatId, OBSERVED_MESSAGES_KEY),
    (id, before) => fetchObservedMessages({ chatId: id, before }),
  );
}
