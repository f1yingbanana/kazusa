"use client";

import { createContext, useContext, useEffect, useMemo } from "react";
import useSWR from "swr";
import type {
  CharacterStatus,
  CharacterSummary,
  DesiresResponse,
  LocationsResponse,
  PlacesResponse,
  WorldResponse,
} from "@kazusa/client";
import { useChats } from "@/hooks/use-chats";
import {
  clockStore,
  desireConfigStore,
  desireStore,
  journalTailStore,
  locationStore,
  placesStore,
  statusStore,
} from "@/lib/live/state";
import { buildPlaceIndex } from "@/lib/location/places";
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
import { DESIRES_KEY, fetchDesires } from "./desires/http";
import {
  LOCATIONS_KEY,
  PLACES_KEY,
  fetchLocations,
  fetchPlaces,
} from "./location/http";
import { fetchWorld } from "./clock/http";
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

  const worldResource = useSWR<WorldResponse, Error>(
    reachable
      ? (["kazusa/world", config.baseUrl, config.token ?? ""] as const)
      : null,
    () => fetchWorld(config.baseUrl, config.token),
    { revalidateOnFocus: false },
  );

  const resolved = useMemo(
    () =>
      resolveSources({
        capabilities: worldResource.data?.capabilities ?? LEGACY_CAPABILITIES,
        reachable,
        mocks: config.mocks,
      }),
    [reachable, config.mocks, worldResource.data?.capabilities],
  );

  const liveCharacters = useSWR<CharacterSummary[], Error>(
    resolved.characters === "live"
      ? (["kazusa/characters", config.baseUrl, config.token ?? ""] as const)
      : null,
    () => fetchCharacters(config.baseUrl, config.token),
    { revalidateOnFocus: false },
  );

  const liveDesires = useSWR<DesiresResponse, Error>(
    resolved.desires === "live"
      ? ([DESIRES_KEY, config.baseUrl, config.token ?? ""] as const)
      : null,
    () => fetchDesires(config.baseUrl, config.token),
    { revalidateOnFocus: false },
  );

  // The map never changes while the Gateway runs; records arrive by SSE.
  const livePlaces = useSWR<PlacesResponse, Error>(
    resolved.places === "live"
      ? ([PLACES_KEY, config.baseUrl, config.token ?? ""] as const)
      : null,
    () => fetchPlaces(config.baseUrl, config.token),
    { revalidateOnFocus: false },
  );

  const liveLocations = useSWR<LocationsResponse, Error>(
    resolved.location === "live"
      ? ([LOCATIONS_KEY, config.baseUrl, config.token ?? ""] as const)
      : null,
    () => fetchLocations(config.baseUrl, config.token),
    { revalidateOnFocus: false },
  );

  const needsWorld =
    resolved.characters === "mock" ||
    resolved.status === "mock" ||
    resolved.timeline === "mock" ||
    resolved.desires === "mock" ||
    resolved.places === "mock" ||
    resolved.location === "mock";
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
        : {
            id: worldResource.data?.user.id ?? config.userId,
            name: worldResource.data?.user.name ?? config.userName,
          },
    [
      resolved.characters,
      worldResource.data?.user,
      config.userId,
      config.userName,
    ],
  );

  const characters = useMemo<readonly CharacterSummary[]>(() => {
    if (resolved.characters === "mock") return world?.characters ?? [];
    if (resolved.characters === "unavailable") return [];
    const list = liveCharacters.data ?? [];
    if (list.some((c) => c.kind === "player" || c.id === player.id)) {
      return list;
    }
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
    if (resolved.status === "mock" && world) {
      statusStore.reset(world.statuses);
    } else if (resolved.status === "live" && liveCharacters.data) {
      const entries: Array<readonly [string, CharacterStatus]> = [];
      for (const c of liveCharacters.data) {
        if (c.status) entries.push([c.id, c.status]);
      }
      statusStore.reset(entries);
    } else if (resolved.status === "unavailable") {
      statusStore.reset([]);
    }
  }, [resolved.status, world, liveCharacters.data]);

  useEffect(() => {
    if (resolved.desires === "mock" && world) {
      desireConfigStore.set(world.desireConfig);
      desireStore.reset(world.desires);
    } else if (resolved.desires === "live" && liveDesires.data) {
      desireConfigStore.set(liveDesires.data.config);
      desireStore.reset(Object.entries(liveDesires.data.records));
    } else if (resolved.desires === "unavailable") {
      desireConfigStore.set(null);
      desireStore.reset([]);
    }
  }, [resolved.desires, world, liveDesires.data]);

  useEffect(() => {
    if (resolved.places === "mock" && world) {
      placesStore.set(buildPlaceIndex(world.places));
    } else if (resolved.places === "live" && livePlaces.data) {
      placesStore.set(buildPlaceIndex(livePlaces.data.places));
    } else if (resolved.places === "unavailable") {
      placesStore.set(null);
    }
  }, [resolved.places, world, livePlaces.data]);

  useEffect(() => {
    if (resolved.location === "mock" && world) {
      locationStore.reset(world.locations);
    } else if (resolved.location === "live" && liveLocations.data) {
      locationStore.reset(Object.entries(liveLocations.data.records));
    } else if (resolved.location === "unavailable") {
      locationStore.reset([]);
    }
  }, [resolved.location, world, liveLocations.data]);

  useEffect(() => {
    journalTailStore.set([]);
  }, [world, resolved.timeline]);

  useEffect(() => {
    if (resolved.clock === "live" && worldResource.data) {
      clockStore.set({
        clock: worldResource.data.clock,
        offset: worldResource.data.serverNow - Date.now(),
      });
    } else if (resolved.clock === "mock") {
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
    } else if (resolved.clock === "unavailable") {
      clockStore.set(null);
    }
  }, [resolved.clock, worldResource.data]);

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
  if (!context)
    throw new Error("useSources must be used within SourcesProvider");
  return context;
}
