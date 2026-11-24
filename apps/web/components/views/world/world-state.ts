"use client";

import { useMemo } from "react";
import type { CharacterSummary } from "@kazusa/client";
import { isCast, useCharacters } from "@/hooks/use-characters";
import { useOccupancy, usePlaces } from "@/hooks/use-location";
import { useOffstage } from "@/hooks/use-stage";
import { useLiveStore } from "@/lib/live/state";
import { ancestors, placeName } from "@/lib/location/places";
import { useSources } from "@/lib/source/provider";
import { useWatchlist } from "@/lib/state/preferences-store";

/*
 * URL params:
 *   world.in    – the place the map flies to, as `place:<id>`.
 *   world.plane – which map, in worlds with several. Absent means where the
 *                 open place or the player is, or else the largest.
 */
export const PLACE_PREFIX = "place:";

/** The map needs both places and positions. */
export function usePlacesAvailable() {
  const { resolved } = useSources();
  return (
    resolved.places !== "unavailable" && resolved.location !== "unavailable"
  );
}

/** A place someone stands in right now, and who. */
export interface Room {
  readonly placeId: string;
  readonly label: string;
  /** The outermost area it sits in, as the map labels it ("Trinity"). */
  readonly area: string;
  readonly members: readonly CharacterSummary[];
}

const byName = (a: CharacterSummary, b: CharacterSummary) =>
  a.name.localeCompare(b.name);

/**
 * The world as it is now: only the onstage cast, since offstage characters
 * aren't anywhere and the system agent directs rather than lives in it. Rooms
 * are the places with someone in them, in map order.
 */
export function useWorldNow() {
  const { characters, byId, isLoading, error } = useCharacters();
  const offstage = useOffstage();
  const watchlist = useWatchlist();
  const places = usePlaces();
  const locations = useLiveStore((state) => state.locations);

  const onstage = useMemo(
    () =>
      characters.filter((c) => isCast(c) && !offstage.has(c.id)).sort(byName),
    [characters, offstage],
  );
  const onstageIds = useMemo(() => onstage.map((c) => c.id), [onstage]);
  const occupied = useOccupancy(onstageIds);

  const people = useMemo(
    () => (ids: readonly string[]) =>
      ids
        .map((id) => byId.get(id))
        .filter((c): c is CharacterSummary => Boolean(c))
        .sort(byName),
    [byId],
  );

  const rooms: readonly Room[] = useMemo(() => {
    if (!places) return [];
    return places.order
      .filter((id) => (occupied.at.get(id)?.length ?? 0) > 0)
      .map((id) => ({
        placeId: id,
        label: placeName(places, id),
        area: placeName(places, ancestors(places, id).at(-1) ?? ""),
        members: people(occupied.at.get(id) ?? []),
      }));
  }, [places, occupied, people]);

  const travelers = useMemo(
    () =>
      people(occupied.traveling).sort(
        (a, b) =>
          (locations.get(a.id)?.trip?.arriveAt ?? 0) -
          (locations.get(b.id)?.trip?.arriveAt ?? 0),
      ),
    [people, occupied, locations],
  );
  const unplaced = useMemo(() => people(occupied.unplaced), [people, occupied]);
  const watched = useMemo(() => {
    const on = new Set(onstageIds);
    return people(watchlist.filter((id) => on.has(id)));
  }, [people, watchlist, onstageIds]);
  const cast = useMemo(
    () => ({
      total: characters.filter(isCast).length,
      onstage: onstage.length,
    }),
    [characters, onstage],
  );

  return {
    characters,
    onstage,
    cast,
    rooms,
    travelers,
    unplaced,
    watched,
    places,
    isLoading,
    error,
  };
}
