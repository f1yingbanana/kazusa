"use client";

import { useSyncExternalStore } from "react";
import useSWR from "swr";
import type { CharacterDetail, CharacterStatus } from "@kazusa/client";
import { statusStore } from "@/lib/live/state";
import { fetchCharacterDetail } from "@/lib/source/characters/http";
import { useSources } from "@/lib/source/provider";
import { useKazusaConfig } from "@/lib/state/config-store";

export function useCharacters() {
  const {
    characters,
    charactersById,
    charactersLoading,
    charactersError,
    resolved,
  } = useSources();
  return {
    characters,
    byId: charactersById,
    isLoading: charactersLoading,
    error: charactersError,
    source: resolved.characters,
  };
}

export function useCharacter(id: string | undefined) {
  const { charactersById } = useSources();
  return id ? charactersById.get(id) : undefined;
}

/**
 * Full profile. Reads live GET /kazusa/character when live, or fallback mock
 * world.
 */
export function useCharacterDetail(id: string): {
  detail: CharacterDetail | undefined;
  available: boolean;
} {
  const { resolved, world } = useSources();
  const config = useKazusaConfig();
  const isLive = resolved.characters === "live";

  const { data: liveDetail } = useSWR(
    isLive
      ? (["kazusa/character", config.baseUrl, id, config.token ?? ""] as const)
      : null,
    ([, baseUrl, charId]) =>
      fetchCharacterDetail(baseUrl, charId, config.token),
    { revalidateOnFocus: true, refreshInterval: 30_000 },
  );

  if (isLive) {
    return { detail: liveDetail, available: Boolean(liveDetail) };
  }
  if (resolved.characters === "mock")
    return { detail: world?.details.get(id), available: true };
  return { detail: undefined, available: false };
}

/** Per-id live subscription: a delta for one character re-renders one row. */
export function useCharacterStatus(
  id: string | undefined,
): CharacterStatus | undefined {
  return useSyncExternalStore(
    (listener) => (id ? statusStore.subscribeKey(id, listener) : () => {}),
    () => (id ? statusStore.get(id) : undefined),
    () => undefined,
  );
}

/** Aggregate subscription for summaries and status-based grouping. */
export function useStatusVersion() {
  return useSyncExternalStore(
    (listener) => statusStore.subscribe(listener),
    () => statusStore.version(),
    () => 0,
  );
}
