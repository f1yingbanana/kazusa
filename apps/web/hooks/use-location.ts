"use client";

import { useCallback, useMemo } from "react";
import type { LocationRecord } from "@kazusa/client";
import { toast } from "sonner";
import { useCharacterStatus } from "@/hooks/use-characters";
import { useSimNow } from "@/hooks/use-clock";
import { useOffstage } from "@/hooks/use-stage";
import { updateLocation, useLiveStore } from "@/lib/live/state";
import { useAccess } from "@/hooks/use-access";
import { movePlayer } from "@/lib/source/location/http";
import { useSources, usePlacesResource } from "@/lib/source/provider";
import {
  buildPlaceIndex,
  occupancy,
  positionAt,
  type Occupancy,
  type PlaceIndex,
  type Position,
} from "@/lib/location/places";

export function usePlaces(): PlaceIndex | null {
  const { data } = usePlacesResource();
  return useMemo(() => (data ? buildPlaceIndex(data.places) : null), [data]);
}

export function usePlace(id: string | undefined) {
  const places = usePlaces();
  return id ? places?.byId.get(id) : undefined;
}

/** Per-id subscription: a move for one participant re-renders their views only. */
export function useLocationRecord(
  id: string | undefined,
): LocationRecord | undefined {
  return useLiveStore((state) => (id ? state.locations.get(id) : undefined));
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

/**
 * Who is where right now among `ids`; regroups on moves and each sim minute.
 * Offstage characters are left out: they aren't anywhere.
 */
export function useOccupancy(ids: readonly string[]): Occupancy {
  const locations = useLiveStore((state) => state.locations);
  const offstage = useOffstage();
  const now = useSimNow();
  return useMemo(
    () =>
      occupancy(
        ids.filter((id) => !offstage.has(id)),
        (id) => locations.get(id),
        now,
      ),
    [ids, offstage, locations, now],
  );
}

/**
 * Where the player stands now, and `moveTo` for going straight to a place (live
 * worlds only; `undefined` otherwise). Characters there may notice the player
 * come in; leaving takes the player out of their huddles.
 */
export function usePlayer() {
  const { resolved, player } = useSources();
  const { canPlay } = useAccess();
  const position = usePosition(player.id);
  const live = resolved.location === "live";
  const moveTo = useCallback(
    async (placeId: string) => {
      if (!canPlay) return;
      try {
        const { record } = await movePlayer(placeId);
        // SSE brings the same record; don't wait for it.
        updateLocation(player.id, record);
      } catch (error) {
        toast.error("Couldn't go there", {
          description: error instanceof Error ? error.message : undefined,
        });
      }
    },
    [canPlay, player.id],
  );
  return {
    id: player.id,
    placeId: position?.kind === "at" ? position.placeId : undefined,
    live,
    moveTo: live && canPlay ? moveTo : undefined,
  };
}
