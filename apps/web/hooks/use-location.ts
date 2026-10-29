"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { LocationRecord } from "@kazusa/client";
import { toast } from "sonner";
import { useCharacterStatus } from "@/hooks/use-characters";
import { useSimNow } from "@/hooks/use-clock";
import { useOffstage } from "@/hooks/use-stage";
import { locationStore, placesStore } from "@/lib/live/state";
import { movePlayer } from "@/lib/source/location/http";
import { useSources } from "@/lib/source/provider";
import { useKazusaConfig } from "@/lib/state/config-store";
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

/**
 * Where someone is now, recomputed from their record at minute resolution.
 * Offstage characters are nowhere, whatever their last record says.
 */
export function usePosition(id: string | undefined): Position | undefined {
  const record = useLocationRecord(id);
  const offstage = useCharacterStatus(id)?.onstage === false;
  const now = useSimNow();
  return useMemo(
    () =>
      record && !offstage && now > 0 ? positionAt(record, now) : undefined,
    [record, offstage, now],
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

/**
 * Who is where right now among `ids`; regroups on moves and each sim minute.
 * Offstage characters are left out: they aren't anywhere.
 */
export function useOccupancy(ids: readonly string[]): Occupancy {
  const version = useLocationVersion();
  const offstage = useOffstage();
  const now = useSimNow();
  return useMemo(
    () =>
      occupancy(
        ids.filter((id) => !offstage.has(id)),
        (id) => locationStore.get(id),
        now,
      ),
    // `version` stands in for every record in the store.
    [ids, offstage, version, now],
  );
}

/**
 * Where the player stands now, and `moveTo` for going straight to a place (live
 * worlds only; `undefined` otherwise). Characters there may notice the player
 * come in; leaving takes the player out of their huddles.
 */
export function usePlayer() {
  const config = useKazusaConfig();
  const { resolved } = useSources();
  const position = usePosition(config.userId);
  const live = resolved.location === "live";
  const moveTo = useCallback(
    async (placeId: string) => {
      try {
        const { record } = await movePlayer(
          config.baseUrl,
          placeId,
          config.token,
        );
        // SSE brings the same record; don't wait for it.
        locationStore.set(config.userId, record);
      } catch (error) {
        toast.error("Couldn't go there", {
          description: error instanceof Error ? error.message : undefined,
        });
      }
    },
    [config.baseUrl, config.token, config.userId],
  );
  return {
    id: config.userId,
    placeId: position?.kind === "at" ? position.placeId : undefined,
    moveTo: live ? moveTo : undefined,
  };
}
