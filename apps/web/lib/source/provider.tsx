"use client";

import { useEffect, useMemo } from "react";
import useSWR, {
  unstable_serialize,
  useSWRConfig,
  type Cache,
  type SWRResponse,
} from "swr";
import type {
  CharacterSummary,
  DesiresResponse,
  Domain,
  LocationsResponse,
  PlacesResponse,
  WorldResponse,
  WorldMeta,
} from "@kazusa/client";
import {
  clearJournal,
  setDesires,
  setLocations,
  setStatuses,
  useLiveStore,
} from "@/lib/live/state";
import { sampleClock, setClock, useClockStore } from "@/lib/live/clock-state";
import { resolveSources, type ResolvedSources } from "./capabilities";
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
  readonly reachable: boolean;
  readonly backendError?: Error;
  readonly retryBackend: () => void;
  readonly player: { readonly id: string; readonly name: string };
  readonly world?: WorldMeta;
  readonly worldResource: SWRResponse<WorldResponse, Error>;
  readonly probing: boolean;
}

const NO_PLAYER = { id: "", name: "You" };
const WORLD_KEY = ["kazusa/world"] as const;
const WORLD_CACHE_KEY = unstable_serialize(WORLD_KEY);

function isLive(cache: Cache<unknown>, domain: Domain): boolean {
  const world = cache.get(WORLD_CACHE_KEY)?.data as WorldResponse | undefined;
  return world?.capabilities[domain] === "live";
}

// Capture the live projection before each request. An SSE update that arrives
// while HTTP is in flight wins over that request's older snapshot.
async function loadWorld(cache: Cache<unknown>): Promise<WorldResponse> {
  const baselineWorld = cache.get(WORLD_CACHE_KEY)?.data;
  const baseline = useClockStore.getState().clock;
  const world = await fetchWorld();
  if (
    useClockStore.getState().clock === baseline &&
    cache.get(WORLD_CACHE_KEY)?.data === baselineWorld
  ) {
    setClock(
      world.capabilities.clock === "live"
        ? {
            clock: world.clock,
            offset: world.serverNow - Date.now(),
          }
        : null,
    );
  }
  return world;
}

async function loadCharacters(
  cache: Cache<unknown>,
): Promise<CharacterSummary[]> {
  const baseline = useLiveStore.getState().statuses;
  const characters = await fetchCharacters();
  if (isLive(cache, "characters") && isLive(cache, "status")) {
    setStatuses(
      characters.flatMap((c) => (c.status ? [[c.id, c.status] as const] : [])),
      baseline,
    );
  }
  return characters;
}

async function loadDesires(cache: Cache<unknown>): Promise<DesiresResponse> {
  const baseline = useLiveStore.getState().desires;
  const data = await fetchDesires();
  if (isLive(cache, "desires"))
    setDesires(Object.entries(data.records), baseline);
  return data;
}

async function loadLocations(
  cache: Cache<unknown>,
): Promise<LocationsResponse> {
  const baseline = useLiveStore.getState().locations;
  const data = await fetchLocations();
  if (isLive(cache, "location"))
    setLocations(Object.entries(data.records), baseline);
  return data;
}

/** Shared resource hooks read SWR directly; no second response cache. */
export function useSources(): SourcesValue {
  const { cache } = useSWRConfig();
  const worldResource = useSWR<WorldResponse, Error>(
    WORLD_KEY,
    () => loadWorld(cache),
    { revalidateOnFocus: false, revalidateIfStale: false },
  );
  const reachable = Boolean(worldResource.data) && !worldResource.error;

  const resolved = useMemo(
    () =>
      resolveSources({
        capabilities: worldResource.data?.capabilities ?? {},
        // Keep cached resources usable during a transient revalidation error.
        reachable: Boolean(worldResource.data),
      }),
    [worldResource.data?.capabilities],
  );

  return {
    resolved,
    reachable,
    backendError: worldResource.error,
    retryBackend: () => void worldResource.mutate(),
    player: worldResource.data?.user ?? NO_PLAYER,
    world: worldResource.data?.world,
    worldResource,
    probing: worldResource.isLoading && !worldResource.error,
  };
}

export function useCharactersResource(
  poll = false,
): SWRResponse<CharacterSummary[], Error> {
  const { cache } = useSWRConfig();
  const { resolved } = useSources();
  return useSWR<CharacterSummary[], Error>(
    resolved.characters === "live" ? (["kazusa/characters"] as const) : null,
    () => loadCharacters(cache),
    {
      revalidateOnFocus: true,
      refreshInterval: poll ? 30_000 : 0,
      revalidateIfStale: false,
    },
  );
}

export function useDesiresResource(): SWRResponse<DesiresResponse, Error> {
  const { cache } = useSWRConfig();
  const { resolved } = useSources();
  return useSWR<DesiresResponse, Error>(
    resolved.desires === "live" ? ([DESIRES_KEY] as const) : null,
    () => loadDesires(cache),
    { revalidateOnFocus: false, revalidateIfStale: false },
  );
}

export function usePlacesResource(): SWRResponse<PlacesResponse, Error> {
  const { resolved } = useSources();
  return useSWR<PlacesResponse, Error>(
    resolved.places === "live" ? ([PLACES_KEY] as const) : null,
    () => fetchPlaces(),
    { revalidateOnFocus: false, revalidateIfStale: false },
  );
}

/** Seeds live projections from SWR and owns the one simulation ticker. */
export function SourcesProvider({
  children,
  fallback,
}: {
  children: React.ReactNode;
  fallback: React.ReactNode;
}) {
  const { cache } = useSWRConfig();
  const { resolved, probing } = useSources();
  useCharactersResource(true);
  useDesiresResource();
  // Keep the resource mounted so map edits revalidate even on other views.
  usePlacesResource();
  useSWR<LocationsResponse, Error>(
    resolved.location === "live" ? ([LOCATIONS_KEY] as const) : null,
    () => loadLocations(cache),
    { revalidateOnFocus: false, revalidateIfStale: false },
  );
  useEffect(() => {
    const timer = window.setInterval(sampleClock, 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (resolved.status === "unavailable") setStatuses([]);
  }, [resolved.status]);

  useEffect(() => {
    if (resolved.desires === "unavailable") setDesires([]);
  }, [resolved.desires]);

  useEffect(() => {
    if (resolved.location === "unavailable") setLocations([]);
  }, [resolved.location]);

  useEffect(() => {
    clearJournal();
  }, [resolved.timeline]);

  useEffect(() => {
    if (resolved.clock === "unavailable") setClock(null);
  }, [resolved.clock]);

  return <>{probing ? fallback : children}</>;
}
