"use client";

import { createContext, useContext, useEffect, useMemo } from "react";
import useSWR from "swr";
import type { CharacterSummary } from "@kazusa/client";
import { useChats } from "@/hooks/use-chats";
import { clockStore, journalTailStore, statusStore } from "@/lib/live/state";
import { dispatchLive } from "@/lib/registry/live";
import { useKazusaConfig } from "@/lib/state/config-store";
import { simTimeAt } from "@/lib/time/sim";
import {
  LEGACY_CAPABILITIES,
  resolveSources,
  type MockMode,
  type ResolvedSources,
} from "./capabilities";
import { fetchCharacters } from "./characters/http";
import {
  MOCK_WORLD_START,
  advanceMockWorld,
  createMockWorld,
  type MockWorld,
} from "./mock/world";

interface SourcesValue {
  readonly resolved: ResolvedSources;
  readonly mocks: MockMode;
  /** False when the Gateway proxy can't be reached (distinct from "not served"). */
  readonly reachable: boolean;
  readonly backendError?: Error;
  readonly retryBackend: () => void;
  /** The mock "server" for every domain resolved to `mock`. */
  readonly world: MockWorld | null;
  readonly player: { readonly id: string; readonly name: string };
  readonly characters: readonly CharacterSummary[];
  readonly charactersById: ReadonlyMap<string, CharacterSummary>;
  readonly charactersLoading: boolean;
  readonly charactersError?: Error;
}

const SourcesContext = createContext<SourcesValue | null>(null);

const MOCK_TICK_MS = 2_000;
const MOCK_DEFAULT_SPEED = 10;

export function SourcesProvider({
  children,
  fallback,
}: {
  children: React.ReactNode;
  fallback: React.ReactNode;
}) {
  const config = useKazusaConfig();
  const chats = useChats();
  const probing = chats.isLoading && !chats.error;
  const reachable = !chats.error && !chats.isLoading;

  const resolved = useMemo(
    () =>
      resolveSources({
        capabilities: LEGACY_CAPABILITIES,
        reachable,
        mocks: config.mocks,
      }),
    [reachable, config.mocks],
  );

  const liveCharacters = useSWR(
    resolved.characters === "live"
      ? (["kazusa/characters", config.baseUrl, config.token ?? ""] as const)
      : null,
    ([, baseUrl]) => fetchCharacters(baseUrl, config.token),
    { revalidateOnFocus: false },
  );

  const needsWorld =
    resolved.characters === "mock" ||
    resolved.status === "mock" ||
    resolved.timeline === "mock";
  const liveIds = liveCharacters.data?.map((c) => c.id).join("|");

  const world = useMemo(() => {
    if (!needsWorld) return null;
    if (resolved.characters === "mock") return createMockWorld();
    if (!liveCharacters.data) return null;
    return createMockWorld({ characters: liveCharacters.data });
    // Keyed on the id set so a revalidation with the same roster keeps the world.
  }, [needsWorld, resolved.characters, liveIds]);

  const player = useMemo(
    () =>
      resolved.characters === "mock"
        ? { id: "user:you", name: "You" }
        : { id: config.userId, name: config.userName },
    [resolved.characters, config.userId, config.userName],
  );

  const characters = useMemo<readonly CharacterSummary[]>(() => {
    if (resolved.characters === "mock") return world?.characters ?? [];
    if (resolved.characters === "unavailable") return [];
    const list = liveCharacters.data ?? [];
    return [
      ...list,
      { id: player.id, name: player.name, kind: "player", aliases: [] },
    ];
  }, [resolved.characters, world, liveCharacters.data, player]);

  const charactersById = useMemo(
    () => new Map(characters.map((c) => [c.id, c])),
    [characters],
  );

  useEffect(() => {
    if (resolved.status === "mock" && world) statusStore.reset(world.statuses);
    else statusStore.reset([]);
  }, [resolved.status, world]);

  useEffect(() => {
    journalTailStore.set([]);
  }, [world, resolved.timeline]);

  useEffect(() => {
    if (resolved.clock !== "mock") {
      clockStore.set(null);
      return;
    }
    if (!clockStore.get()) {
      clockStore.set({
        clock: {
          simTime: MOCK_WORLD_START,
          speed: MOCK_DEFAULT_SPEED,
          updatedAt: Date.now(),
        },
        offset: 0,
      });
    }
  }, [resolved.clock]);

  useEffect(() => {
    if (!world) return;
    const timer = window.setInterval(() => {
      const anchor = clockStore.get();
      if (!anchor || anchor.clock.speed === 0) return;
      const now = simTimeAt(anchor.clock, Date.now(), anchor.offset);
      for (const event of advanceMockWorld(world, now)) dispatchLive(event);
    }, MOCK_TICK_MS);
    return () => window.clearInterval(timer);
  }, [world]);

  const value = useMemo<SourcesValue>(
    () => ({
      resolved,
      mocks: config.mocks,
      reachable,
      backendError: chats.error,
      retryBackend: () => void chats.reload(),
      world,
      player,
      characters,
      charactersById,
      charactersLoading:
        resolved.characters === "live"
          ? liveCharacters.isLoading
          : resolved.characters === "mock" && !world,
      charactersError: liveCharacters.error,
    }),
    [
      resolved,
      config.mocks,
      reachable,
      chats.error,
      chats.reload,
      world,
      player,
      characters,
      charactersById,
      liveCharacters.isLoading,
      liveCharacters.error,
    ],
  );

  if (probing) return <>{fallback}</>;

  return (
    <SourcesContext.Provider value={value}>{children}</SourcesContext.Provider>
  );
}

export function useSources() {
  const context = useContext(SourcesContext);
  if (!context) throw new Error("useSources must be used within SourcesProvider");
  return context;
}
