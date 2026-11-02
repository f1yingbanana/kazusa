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
import { useChatsResource } from "@/hooks/use-chats";
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
import { useKazusaConfig } from "@/lib/state/config-store";
import {
  LEGACY_CAPABILITIES,
  resolveSources,
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

interface SourcesValue {
  readonly resolved: ResolvedSources;
  /** False when the Gateway proxy can't be reached (distinct from "not served"). */
  readonly reachable: boolean;
  readonly backendError?: Error;
  readonly retryBackend: () => void;
  readonly player: { readonly id: string; readonly name: string };
  readonly characters: readonly CharacterSummary[];
  readonly charactersById: ReadonlyMap<string, CharacterSummary>;
  readonly charactersLoading: boolean;
  readonly charactersError?: Error;
}

const SourcesContext = createContext<SourcesValue | null>(null);

export function SourcesProvider({
  children,
  fallback,
}: {
  children: React.ReactNode;
  fallback: React.ReactNode;
}) {
  const config = useKazusaConfig();
  const chats = useChatsResource();
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
      }),
    [reachable, worldResource.data?.capabilities],
  );

  const liveCharacters = useSWR<CharacterSummary[], Error>(
    resolved.characters === "live"
      ? (["kazusa/characters", config.baseUrl, config.token ?? ""] as const)
      : null,
    () => fetchCharacters(config.baseUrl, config.token),
    { revalidateOnFocus: true, refreshInterval: 30_000 },
  );

  const liveDesires = useSWR<DesiresResponse, Error>(
    resolved.desires === "live"
      ? ([DESIRES_KEY, config.baseUrl, config.token ?? ""] as const)
      : null,
    () => fetchDesires(config.baseUrl, config.token),
    { revalidateOnFocus: false },
  );

  // SSE `places` revalidates this when the map changes; records arrive by SSE.
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

  const player = useMemo(
    () => ({
      id: worldResource.data?.user.id ?? config.userId,
      name: worldResource.data?.user.name ?? config.userName,
    }),
    [worldResource.data?.user, config.userId, config.userName],
  );

  const characters = useMemo<readonly CharacterSummary[]>(() => {
    if (resolved.characters === "unavailable") return [];
    const list = liveCharacters.data ?? [];
    if (list.some((c) => c.kind === "player" || c.id === player.id)) {
      return list;
    }
    return [
      ...list,
      { id: player.id, name: player.name, kind: "player", aliases: [] },
    ];
  }, [resolved.characters, liveCharacters.data, player]);

  const charactersById = useMemo(
    () => new Map(characters.map((c) => [c.id, c])),
    [characters],
  );

  useEffect(() => {
    if (resolved.status === "live" && liveCharacters.data) {
      const entries: Array<readonly [string, CharacterStatus]> = [];
      for (const c of liveCharacters.data) {
        if (c.status) entries.push([c.id, c.status]);
      }
      statusStore.reset(entries);
    } else if (resolved.status === "unavailable") {
      statusStore.reset([]);
    }
  }, [resolved.status, liveCharacters.data]);

  useEffect(() => {
    if (resolved.desires === "live" && liveDesires.data) {
      desireConfigStore.set(liveDesires.data.config);
      desireStore.reset(Object.entries(liveDesires.data.records));
    } else if (resolved.desires === "unavailable") {
      desireConfigStore.set(null);
      desireStore.reset([]);
    }
  }, [resolved.desires, liveDesires.data]);

  useEffect(() => {
    if (resolved.places === "live" && livePlaces.data) {
      placesStore.set(buildPlaceIndex(livePlaces.data.places));
    } else if (resolved.places === "unavailable") {
      placesStore.set(null);
    }
  }, [resolved.places, livePlaces.data]);

  useEffect(() => {
    if (resolved.location === "live" && liveLocations.data) {
      locationStore.reset(Object.entries(liveLocations.data.records));
    } else if (resolved.location === "unavailable") {
      locationStore.reset([]);
    }
  }, [resolved.location, liveLocations.data]);

  useEffect(() => {
    journalTailStore.set([]);
  }, [resolved.timeline]);

  useEffect(() => {
    if (resolved.clock === "live" && worldResource.data) {
      clockStore.set({
        clock: worldResource.data.clock,
        offset: worldResource.data.serverNow - Date.now(),
      });
    } else if (resolved.clock === "unavailable") {
      clockStore.set(null);
    }
  }, [resolved.clock, worldResource.data]);

  const value = useMemo<SourcesValue>(
    () => ({
      resolved,
      reachable,
      backendError: chats.error,
      retryBackend: () => void chats.mutate(),
      player,
      characters,
      charactersById,
      charactersLoading:
        resolved.characters === "live" && liveCharacters.isLoading,
      charactersError: liveCharacters.error,
    }),
    [
      resolved,
      reachable,
      chats.error,
      chats.mutate,
      player,
      characters,
      charactersById,
      liveCharacters.isLoading,
      liveCharacters.error,
    ],
  );

  // Hold until capabilities arrive, so no panel flashes as unavailable.
  const probing =
    (chats.isLoading && !chats.error) || (reachable && worldResource.isLoading);
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
