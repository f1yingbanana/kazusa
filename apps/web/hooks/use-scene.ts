"use client";

import { useEffect, useMemo } from "react";
import useSWR, {
  unstable_serialize,
  useSWRConfig,
  type Cache,
  type SWRResponse,
} from "swr";
import type {
  BackdropFile,
  CharacterSummary,
  ChatsResponse,
  MessagesResponse,
  ObservedChat,
  ObservedChatsResponse,
  PortraitsResponse,
} from "@kazusa/client";
import { useCharacter } from "@/hooks/use-characters";
import { useClockStore } from "@/lib/live/clock-state";
import { useRealtimeStore } from "@/lib/live/realtime-state";
import { applySceneEvent, closeScene, openScene } from "@/lib/live/scene-state";
import { drawableIds, type SceneSeed } from "@/lib/scene/director";
import type { SlotCount } from "@/lib/scene/layout";
import { pickBackdrop } from "@/lib/scene/pick";
import { chatsKey, messagesCacheKey } from "@/lib/source/chats/cache";
import {
  OBSERVED_MESSAGES_KEY,
  observedChatsKey,
} from "@/lib/source/observe/http";
import {
  CHARACTERS_KEY,
  usePlacesResource,
  useSources,
} from "@/lib/source/provider";
import { PORTRAITS_KEY, fetchPortraits } from "@/lib/source/scene/http";
import { MINUTE, bucket } from "@/lib/time/sim";

/**
 * What a scene opens with, from what this tab already holds: the huddle's
 * members from the chat lists, its latest cached page of messages, who is
 * speaking now and, from the roster, who can be drawn (nobody without the scene
 * capability; not known while the roster is unread). Nothing is fetched; reads
 * that land later reach the scene through their own fetchers.
 */
export function sceneSeed(
  cache: Cache<unknown>,
  chatId: string,
  playerId: string,
  slots: SlotCount,
  sceneLive: boolean,
): SceneSeed {
  const listed = (key: readonly unknown[]) =>
    (
      cache.get(unstable_serialize(key))?.data as
        ChatsResponse | ObservedChatsResponse | undefined
    )?.chats.find((chat) => chat.id === chatId) as
      Pick<ObservedChat, "members" | "placeId" | "ended"> | undefined;
  const own = listed(chatsKey());
  const chat = own ?? listed(observedChatsKey());
  const pages = cache.get(
    messagesCacheKey(chatId, own || !chat ? undefined : OBSERVED_MESSAGES_KEY),
  )?.data as MessagesResponse[] | undefined;
  const roster = cache.get(unstable_serialize(CHARACTERS_KEY))?.data as
    CharacterSummary[] | undefined;
  return {
    chatId,
    playerId,
    members: chat && !chat.ended ? chat.members : [],
    placeId: chat?.placeId,
    messages: pages?.[0]?.messages ?? [],
    speaking: useRealtimeStore.getState().typingByChat[chatId] ?? [],
    drawable: roster && (sceneLive ? drawableIds(roster) : new Set<string>()),
    slots,
  };
}

/**
 * Keeps a chat's scene open while the calling view is mounted, seeded from what
 * is cached, and tells it whether it has five slots or one. Live events, chat
 * list, roster and history reads keep it current from then on.
 */
export function useSceneSession(chatId: string | null, slots: SlotCount): void {
  const { cache } = useSWRConfig();
  const { player, resolved } = useSources();
  const playerId = player.id;
  const sceneLive = resolved.scene === "live";
  useEffect(() => {
    if (!chatId) return;
    return () => closeScene(chatId);
  }, [chatId]);
  useEffect(() => {
    if (!chatId) return;
    // A no-op once open: later runs only resize.
    openScene(sceneSeed(cache, chatId, playerId, slots, sceneLive));
    applySceneEvent(chatId, { type: "slots", count: slots });
  }, [cache, chatId, playerId, slots, sceneLive]);
}

/**
 * A character's portrait set, fetched only for one who has portraits
 * (`portraitUrl`, whose version also refreshes the set when it changes).
 */
export function usePortraits(
  characterId: string | undefined,
): SWRResponse<PortraitsResponse, Error> {
  const { resolved } = useSources();
  const portraitUrl = useCharacter(characterId)?.portraitUrl;
  return useSWR<PortraitsResponse, Error>(
    resolved.scene === "live" && characterId && portraitUrl
      ? ([PORTRAITS_KEY, characterId, portraitUrl] as const)
      : null,
    ([, id]: readonly [string, string, string]) => fetchPortraits(id),
    { revalidateOnFocus: false },
  );
}

/**
 * The picture behind a place now: its set's file for the sim time of day, if
 * the world has a set for it. Re-renders only when the picture changes, not
 * with each clock sample.
 */
export function useBackdrop(
  placeId: string | undefined,
): BackdropFile | undefined {
  const { resolved } = useSources();
  const { data } = usePlacesResource();
  const set = useMemo(() => {
    if (resolved.scene !== "live" || !placeId || !data) return undefined;
    const name = data.places.find((place) => place.id === placeId)?.backdrop;
    return name === undefined ? undefined : data.backdrops[name];
  }, [resolved.scene, placeId, data]);
  const times = data?.times;
  return useClockStore((state) =>
    set && times
      ? pickBackdrop(set, times, bucket(state.simNow, MINUTE))
      : undefined,
  );
}
