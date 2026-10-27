"use client";

import { useSyncExternalStore } from "react";
import type { CharacterDetail, CharacterStatus } from "@kazusa/client";
import { statusStore } from "@/lib/live/state";
import { useSources } from "@/lib/source/provider";

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
 * Full profile. The plugin has no `/kazusa/character` route yet, so live
 * characters return `undefined` here and the Profile section says so.
 */
export function useCharacterDetail(id: string): {
  detail: CharacterDetail | undefined;
  available: boolean;
} {
  const { resolved, world } = useSources();
  if (resolved.characters === "mock")
    return { detail: world?.details.get(id), available: true };
  return { detail: undefined, available: false };
}

/** Per-id live subscription: a delta for one character re-renders one row. */
export function useCharacterStatus(id: string | undefined): CharacterStatus | undefined {
  return useSyncExternalStore(
    (listener) => (id ? statusStore.subscribeKey(id, listener) : () => {}),
    () => (id ? statusStore.get(id) : undefined),
    () => undefined,
  );
}

/** Aggregate subscription for summaries and status-based grouping. */
export function useStatusVersion() {
  return useSyncExternalStore(
    statusStore.subscribe,
    statusStore.version,
    () => 0,
  );
}
