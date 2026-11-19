"use client";

import { useCallback, useMemo } from "react";
import useSWR, { useSWRConfig } from "swr";
import type {
  CharacterDetail,
  CharacterStatus,
  CharacterSummary,
} from "@kazusa/client";
import { useLiveStore } from "@/lib/live/state";
import { fetchCharacterDetail } from "@/lib/source/characters/http";
import {
  CHARACTERS_KEY,
  useSources,
  useCharactersResource,
} from "@/lib/source/provider";
import { WIKI_KEY } from "@/lib/source/wiki/http";

const EMPTY_CHARACTERS: readonly CharacterSummary[] = [];
export function useCharacters() {
  const { resolved } = useSources();
  const resource = useCharactersResource();
  const characters = resource.data ?? EMPTY_CHARACTERS;
  const byId = useMemo(
    () => new Map(characters.map((character) => [character.id, character])),
    [characters],
  );
  return {
    characters,
    byId,
    isLoading: resource.isLoading,
    error: resource.error,
    source: resolved.characters,
  };
}

export function useCharacter(id: string | undefined) {
  const { data } = useCharactersResource();
  return id ? data?.find((character) => character.id === id) : undefined;
}

/** Full profile, from GET /kazusa/character. */
export function useCharacterDetail(id: string): {
  detail: CharacterDetail | undefined;
  available: boolean;
} {
  const { resolved } = useSources();
  const isLive = resolved.characters === "live";

  const { data: liveDetail } = useSWR(
    isLive ? (["kazusa/character", id] as const) : null,
    ([, charId]) => fetchCharacterDetail(charId),
    { revalidateOnFocus: true, refreshInterval: 30_000 },
  );

  return isLive
    ? { detail: liveDetail, available: Boolean(liveDetail) }
    : { detail: undefined, available: false };
}

/** Per-id live subscription: a delta for one character re-renders one row. */
export function useCharacterStatus(
  id: string | undefined,
): CharacterStatus | undefined {
  return useLiveStore((state) => (id ? state.statuses.get(id) : undefined));
}

/**
 * Makes or deletes a character, then has the roster and the wiki read again,
 * keeping what they show meanwhile.
 */
export function useCastChange() {
  const { mutate } = useSWRConfig();
  return useCallback(
    async <T>(change: () => Promise<T>): Promise<T> => {
      const result = await change();
      void mutate(CHARACTERS_KEY);
      void mutate((key) => Array.isArray(key) && key[0] === WIKI_KEY);
      return result;
    },
    [mutate],
  );
}
