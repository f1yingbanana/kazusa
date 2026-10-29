import type { LocationRecord, Place } from "@kazusa/client";

/*
 * Client mirror of the plugin's closed-form position (`location/location.ts`):
 * a record says where someone is at any sim time, so nothing polls. The map is
 * a tree through `parent`; areas are places too (their open space).
 */

export interface PlaceIndex {
  readonly places: readonly Place[];
  readonly byId: ReadonlyMap<string, Place>;
  /** Tree order as served: each area, then its places by name. */
  readonly order: readonly string[];
  readonly children: ReadonlyMap<string, readonly string[]>;
  /** 0 for top-level places. */
  readonly depth: ReadonlyMap<string, number>;
}

export function buildPlaceIndex(places: readonly Place[]): PlaceIndex {
  const byId = new Map(places.map((place) => [place.id, place]));
  const children = new Map<string, string[]>();
  for (const place of places) {
    if (place.parent === undefined || !byId.has(place.parent)) continue;
    children.set(place.parent, [
      ...(children.get(place.parent) ?? []),
      place.id,
    ]);
  }
  const depth = new Map<string, number>();
  for (const place of places) {
    let levels = 0;
    const seen = new Set([place.id]);
    for (
      let up = place.parent;
      up !== undefined && byId.has(up) && !seen.has(up);
      up = byId.get(up)?.parent
    ) {
      seen.add(up);
      levels += 1;
    }
    depth.set(place.id, levels);
  }
  return {
    places,
    byId,
    order: places.map((place) => place.id),
    children,
    depth,
  };
}

/** The areas containing a place, innermost first. */
export function ancestors(index: PlaceIndex, id: string): string[] {
  const chain: string[] = [];
  const seen = new Set([id]);
  for (
    let up = index.byId.get(id)?.parent;
    up !== undefined && index.byId.has(up) && !seen.has(up);
    up = index.byId.get(up)?.parent
  ) {
    seen.add(up);
    chain.push(up);
  }
  return chain;
}

export function placeName(index: PlaceIndex | null, id: string): string {
  return index?.byId.get(id)?.name ?? id;
}

/** "Old Town › Market Square": the areas around a place, outermost first. */
export function areaPath(index: PlaceIndex, id: string): string {
  return ancestors(index, id)
    .reverse()
    .map((up) => placeName(index, up))
    .join(" › ");
}

/** Whether `id` is `area` or somewhere inside it. */
export function isWithin(index: PlaceIndex, id: string, area: string) {
  return id === area || ancestors(index, id).includes(area);
}

export type Trip = NonNullable<LocationRecord["trip"]>;

export type Position =
  | { readonly kind: "at"; readonly placeId: string; readonly since: number }
  | {
      readonly kind: "traveling";
      readonly from: string;
      readonly trip: Trip;
      /** The route place nearest in time: passing, about to reach, or just left. */
      readonly near: string;
      /** The last route place reached, and the next one ahead. */
      readonly passed: string;
      readonly next: string;
    };

/** Position as a pure function of sim time; mirrors the plugin's `positionAt`. */
export function positionAt(record: LocationRecord, at: number): Position {
  const { trip } = record;
  if (!trip || at < trip.departAt) {
    return { kind: "at", placeId: record.placeId, since: record.since };
  }
  if (at >= trip.arriveAt) {
    return { kind: "at", placeId: trip.to, since: trip.arriveAt };
  }
  let near = trip.legs[0] ?? { placeId: record.placeId, at: trip.departAt };
  for (const leg of trip.legs) {
    if (Math.abs(leg.at - at) < Math.abs(near.at - at)) near = leg;
  }
  const passed =
    trip.legs.filter((leg) => leg.at <= at).at(-1)?.placeId ?? record.placeId;
  const next = trip.legs.find((leg) => leg.at > at)?.placeId ?? trip.to;
  return {
    kind: "traveling",
    from: record.placeId,
    trip,
    near: near.placeId,
    passed,
    next,
  };
}

/** Who is where at one moment. Ids without a record are unplaced. */
export interface Occupancy {
  /** Standing directly at each place (not inside its sub-places). */
  readonly at: ReadonlyMap<string, readonly string[]>;
  readonly traveling: readonly string[];
  readonly unplaced: readonly string[];
}

export function occupancy(
  ids: readonly string[],
  recordOf: (id: string) => LocationRecord | undefined,
  at: number,
): Occupancy {
  const here = new Map<string, string[]>();
  const traveling: string[] = [];
  const unplaced: string[] = [];
  for (const id of ids) {
    const record = recordOf(id);
    if (!record) {
      unplaced.push(id);
      continue;
    }
    const position = positionAt(record, at);
    if (position.kind === "traveling") traveling.push(id);
    else
      here.set(position.placeId, [...(here.get(position.placeId) ?? []), id]);
  }
  return { at: here, traveling, unplaced };
}

/** Everyone standing at `placeId` or anywhere inside it. */
export function peopleWithin(
  index: PlaceIndex,
  occupied: Occupancy,
  placeId: string,
): string[] {
  const people: string[] = [];
  const visit = (id: string) => {
    people.push(...(occupied.at.get(id) ?? []));
    for (const child of index.children.get(id) ?? []) visit(child);
  };
  visit(placeId);
  return people;
}

/** Everyone whose current trip ends at `placeId`, soonest first. */
export function headingTo(
  ids: readonly string[],
  recordOf: (id: string) => LocationRecord | undefined,
  placeId: string,
  at: number,
): { readonly id: string; readonly arriveAt: number }[] {
  const arrivals: { id: string; arriveAt: number }[] = [];
  for (const id of ids) {
    const trip = recordOf(id)?.trip;
    if (trip && trip.to === placeId && at < trip.arriveAt) {
      arrivals.push({ id, arriveAt: trip.arriveAt });
    }
  }
  return arrivals.sort((a, b) => a.arriveAt - b.arriveAt);
}

/** Two-way connections touching a place: its own and those declared toward it. */
export function connectionsOf(index: PlaceIndex, id: string) {
  const own = index.byId.get(id)?.connections ?? [];
  const incoming = index.places.flatMap((place) =>
    place.connections
      .filter((connection) => connection.to === id)
      .map((connection) => ({ ...connection, to: place.id })),
  );
  return [...own, ...incoming];
}

/** "3 min on foot", "12 min by monorail"; `walk` reads as on foot. */
export function describeWay(way: { by: string; minutes: number }) {
  const minutes = `${Math.round(way.minutes)} min`;
  return way.by === "walk" ? `${minutes} on foot` : `${minutes} by ${way.by}`;
}
