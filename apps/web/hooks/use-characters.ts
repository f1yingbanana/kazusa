"use client";

import { useCallback, useMemo } from "react";
import { useSWRConfig } from "swr";
import type { CharacterStatus, CharacterSummary } from "@kazusa/client";
import { useLiveStore } from "@/lib/live/state";
import {
  CHARACTERS_KEY,
  useSources,
  useCharactersResource,
} from "@/lib/source/provider";
import { WIKI_KEY } from "@/lib/source/wiki/http";

const EMPTY_CHARACTERS: readonly CharacterSummary[] = [];

/** One of the world's cast: a character, not an NPC or the system agent. */
export function isCast(
  character: Pick<CharacterSummary, "kind" | "isSystemAgent"> | undefined,
): boolean {
  return character?.kind === "agent" && !character.isSystemAgent;
}

/** The cast by name. */
export function useCast(): readonly CharacterSummary[] {
  const { characters } = useCharacters();
  return useMemo(
    () =>
      characters
        .filter(isCast)
        .toSorted((a, b) => a.name.localeCompare(b.name)),
    [characters],
  );
}

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
