"use client";

import { useMemo, useSyncExternalStore } from "react";
import type { LocationRecord } from "@kazusa/client";
import { useSimNow } from "@/hooks/use-clock";
import { locationStore, placesStore } from "@/lib/live/state";
import {
  occupancy,
  positionAt,
  type Occupancy,
  type PlaceIndex,
  type Position,
} from "@/lib/location/places";

export function usePlaces(): PlaceIndex | null {
  return useSyncExternalStore(
    (listener) => placesStore.subscribe(listener),
    () => placesStore.get(),
    () => null,
  );
}

export function usePlace(id: string | undefined) {
  const places = usePlaces();
  return id ? places?.byId.get(id) : undefined;
}

/** Per-id subscription: a move for one participant re-renders their views only. */
export function useLocationRecord(
  id: string | undefined,
): LocationRecord | undefined {
  return useSyncExternalStore(
    (listener) => (id ? locationStore.subscribeKey(id, listener) : () => {}),
    () => (id ? locationStore.get(id) : undefined),
    () => undefined,
  );
}

/** Where someone is now, recomputed from their record at minute resolution. */
export function usePosition(id: string | undefined): Position | undefined {
  const record = useLocationRecord(id);
  const now = useSimNow();
  return useMemo(
    () => (record && now > 0 ? positionAt(record, now) : undefined),
    [record, now],
  );
}

/** Aggregate subscription for occupancy and place grouping. */
export function useLocationVersion() {
  return useSyncExternalStore(
    (listener) => locationStore.subscribe(listener),
    () => locationStore.version(),
    () => 0,
  );
}

/** Who is where right now among `ids`; regroups on moves and each sim minute. */
export function useOccupancy(ids: readonly string[]): Occupancy {
  const version = useLocationVersion();
  const now = useSimNow();
  return useMemo(
    () => occupancy(ids, (id) => locationStore.get(id), now),
    // `version` stands in for every record in the store.
    [ids, version, now],
  );
}
