"use client";

import { useMemo } from "react";
import { useChats } from "@/hooks/use-chats";
import { useObservedChat, useObservedChats } from "@/hooks/use-observed-chats";
import { useSelfIn } from "@/hooks/use-self";
import { useRealtimeStore } from "@/lib/live/realtime-state";
import type { Chat, ChatInfo } from "@/lib/source/chats/types";
import { useDraftChat } from "@/lib/state/chat-draft";

export interface Talk {
  readonly chat: ChatInfo;
  /** Yours, so you can speak in it. */
  readonly mine: boolean;
  /** Everyone in it but you. */
  readonly others: readonly string[];
}

/**
 * Conversations held face to face right now, by the place they're at: yours,
 * and others' you may watch. A talk everyone else has left, or that has ended,
 * isn't happening, nor is someone watched standing alone. Busiest first in each
 * place: someone speaking, then yours, then the latest line.
 */
export function talksByPlace(
  mine: readonly ChatInfo[],
  observed: readonly ChatInfo[],
  selfOf: (chat: ChatInfo) => string,
  speaking: Readonly<Record<string, readonly unknown[]>>,
): ReadonlyMap<string, readonly Talk[]> {
  const mineIds = new Set(mine.map((c) => c.id));
  const byPlace = new Map<string, Talk[]>();
  const add = (chat: ChatInfo, own: boolean) => {
    if (chat.type !== "huddle" || !chat.placeId || chat.ended) return;
    const self = own ? selfOf(chat) : "";
    const others = chat.members.filter((m) => m !== self);
    if (others.length <= (own ? 0 : 1)) return;
    const list = byPlace.get(chat.placeId) ?? [];
    list.push({ chat, mine: own, others });
    byPlace.set(chat.placeId, list);
  };
  for (const chat of mine) add(chat, true);
  for (const chat of observed) if (!mineIds.has(chat.id)) add(chat, false);
  const lively = (talk: Talk) =>
    (speaking[talk.chat.id]?.length ?? 0) > 0 ? 1 : 0;
  for (const list of byPlace.values())
    list.sort(
      (a, b) =>
        lively(b) - lively(a) ||
        Number(b.mine) - Number(a.mine) ||
        (b.chat.lastMessage?.timestamp ?? 0) -
          (a.chat.lastMessage?.timestamp ?? 0),
    );
  return byPlace;
}

export function useTalks(): ReadonlyMap<string, readonly Talk[]> {
  const { chats } = useChats();
  const observed = useObservedChats();
  const selfOf = useSelfIn();
  const speaking = useRealtimeStore((state) => state.typingByChat);
  return useMemo(
    () => talksByPlace(chats, observed.chats, selfOf, speaking),
    [chats, observed.chats, selfOf, speaking],
  );
}

/** A talk by id: yours (a draft included), or one you may watch. */
export function useTalk(id: string | null): {
  own: Chat | null;
  observed: ChatInfo | null;
} {
  const { chats } = useChats();
  const draft = useDraftChat();
  const own =
    (id && chats.find((chat) => chat.id === id)) ||
    (id && draft?.id === id ? draft : null) ||
    null;
  const observed = useObservedChat(own ? null : id).chat ?? null;
  return { own, observed };
}

/**
 * Rooms as the sidebar lists them: where you stand first, then where someone is
 * speaking now, then where people talk (latest line first), then the fullest,
 * then by name.
 */
export function rankRooms<
  R extends {
    readonly placeId: string;
    readonly label: string;
    readonly members: readonly unknown[];
  },
>(
  rooms: readonly R[],
  talks: ReadonlyMap<string, readonly Talk[]>,
  here: string | undefined,
  speaking: Readonly<Record<string, readonly unknown[]>>,
): R[] {
  const lively = (placeId: string) =>
    (talks.get(placeId) ?? []).some(
      (talk) => (speaking[talk.chat.id]?.length ?? 0) > 0,
    );
  const latest = (placeId: string) =>
    Math.max(
      -1,
      ...(talks.get(placeId) ?? []).map(
        (talk) => talk.chat.lastMessage?.timestamp ?? 0,
      ),
    );
  return [...rooms].sort(
    (a, b) =>
      Number(b.placeId === here) - Number(a.placeId === here) ||
      Number(lively(b.placeId)) - Number(lively(a.placeId)) ||
      latest(b.placeId) - latest(a.placeId) ||
      b.members.length - a.members.length ||
      a.label.localeCompare(b.label),
  );
}
