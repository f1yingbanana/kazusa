import { z } from "zod";
import { readFrontmatter } from "../markdown/frontmatter.ts";

const PLACE_ID = z.string().regex(/^[a-z0-9][a-z0-9_-]*$/u);

/** Implicit links between a place and its area are walked. */
export const WALK = "walk";

const WAY = z.strictObject({
  by: z.string().trim().min(1),
  minutes: z.number().min(0),
});

/** World Wiki place frontmatter (`shared/wiki/entities/places/<id>.md`). */
export const PLACE_FRONTMATTER = z.object({
  place_id: PLACE_ID,
  name: z.string().trim().min(1),
  aliases: z.array(z.string().trim().min(1)).default([]),
  parent: PLACE_ID.optional(),
  summary: z.string().trim().min(1),
  entry_minutes: z.number().min(0).default(1),
  /** Only a picture, so a bad value is dropped rather than failing the world. */
  map: z
    .object({
      plane: z.string().trim().min(1).optional(),
      x: z.number(),
      y: z.number(),
    })
    .optional()
    .catch(undefined),
  /**
   * The backdrop set (`shared/backdrops/<set>/`) it is drawn in front of; a
   * place without one uses its area's. Only a picture: any other value than a
   * name (left empty means none) is kept as written, so `buildMap` reports it
   * like an unknown set instead of the page failing.
   */
  backdrop: z
    .string()
    .trim()
    .min(1)
    .optional()
    .catch(({ value }) => (value === null ? undefined : JSON.stringify(value))),
  connections: z
    .array(
      z.strictObject({
        to: PLACE_ID,
        ways: z.array(WAY).min(1),
        note: z.string().trim().min(1).optional(),
      }),
    )
    .default([]),
});

export interface Way {
  readonly by: string;
  readonly minutes: number;
}

export interface Connection {
  readonly to: string;
  /** The first way is the usual one. */
  readonly ways: readonly Way[];
  readonly note?: string;
}

export interface Place {
  readonly id: string;
  readonly name: string;
  readonly aliases: readonly string[];
  /** The area this place is inside; absent at top level. */
  readonly parent?: string;
  readonly summary: string;
  /** Walking minutes to the parent's open space. */
  readonly entryMinutes: number;
  readonly connections: readonly Connection[];
  /** Where it's drawn on the map. Routes and travel times never read this. */
  readonly map?: {
    readonly plane?: string;
    readonly x: number;
    readonly y: number;
  };
  /** The backdrop set its page names; `backdropOf` resolves it up the tree. */
  readonly backdrop?: string;
  readonly bodyMarkdown: string;
}

export function parsePlace(text: string): Place {
  const { data, body } = readFrontmatter(text, PLACE_FRONTMATTER);
  return {
    id: data.place_id,
    name: data.name,
    aliases: data.aliases,
    ...(data.parent === undefined ? {} : { parent: data.parent }),
    summary: data.summary,
    entryMinutes: data.entry_minutes,
    connections: data.connections,
    ...(data.map === undefined ? {} : { map: data.map }),
    ...(data.backdrop === undefined ? {} : { backdrop: data.backdrop }),
    bodyMarkdown: body,
  };
}

interface Edge {
  readonly to: string;
  readonly ways: readonly Way[];
}

/** Something wrong with the map, which it works around until it's fixed. */
export interface MapProblem {
  /** The place it's on; absent for the map as a whole. */
  readonly place?: string;
  readonly message: string;
}

/**
 * The map as it can be used. A problem never stops it loading: what's broken is
 * left out (a connection to nowhere, a second page with the same id) or made
 * safe (an unknown parent puts the place at top level), and listed in
 * `problems` for `wiki_lint`. Live, one bad line kept a whole edit out of the
 * map, with nothing to say why.
 */
export interface WorldMap {
  readonly places: ReadonlyMap<string, Place>;
  /** Depth-first tree order: each area, then its places by name. */
  readonly order: readonly string[];
  readonly children: ReadonlyMap<string, readonly string[]>;
  readonly edges: ReadonlyMap<string, readonly Edge[]>;
  readonly problems: readonly MapProblem[];
}

const byName =
  (places: ReadonlyMap<string, Place>) =>
  (a: string, b: string): number =>
    places.get(a)!.name.localeCompare(places.get(b)!.name) ||
    a.localeCompare(b);

const withoutParent = ({ parent: _parent, ...place }: Place): Place => place;

const withoutBackdrop = ({ backdrop: _backdrop, ...place }: Place): Place =>
  place;

/**
 * Builds the graph from what's usable, listing every problem it worked around.
 * `backdrops` are the sets the world's library has; a page naming any other is
 * a problem, and the place takes its area's.
 */
export function buildMap(
  list: readonly Place[],
  backdrops: ReadonlySet<string> = new Set(),
): WorldMap {
  const problems: MapProblem[] = [];
  const places = new Map<string, Place>();
  for (const place of list) {
    if (places.has(place.id)) {
      problems.push({
        place: place.id,
        message: `two pages say \`place_id: ${place.id}\`; only the first is used`,
      });
      continue;
    }
    places.set(place.id, place);
  }
  for (const place of places.values()) {
    if (place.parent !== undefined && !places.has(place.parent)) {
      problems.push({
        place: place.id,
        message: `unknown parent ${place.parent}, so it's at top level for now`,
      });
      places.set(place.id, withoutParent(place));
    }
  }
  for (const place of places.values()) {
    if (place.backdrop === undefined || backdrops.has(place.backdrop)) continue;
    problems.push({
      place: place.id,
      message: `backdrop ${place.backdrop} isn't a set in shared/backdrops (a folder with a picture), so it uses its area's for now`,
    });
    places.set(place.id, withoutBackdrop(place));
  }
  for (const id of places.keys()) {
    const seen = new Set([id]);
    for (
      let up = places.get(id)!.parent;
      up !== undefined;
      up = places.get(up)?.parent
    ) {
      if (up === id) {
        problems.push({
          place: id,
          message: `parent cycle through ${places.get(id)!.parent}, so it's at top level for now`,
        });
        places.set(id, withoutParent(places.get(id)!));
        break;
      }
      // A cycle above this place: its own members break it.
      if (seen.has(up)) break;
      seen.add(up);
    }
  }

  const edges = new Map<string, Edge[]>();
  const link = (from: string, to: string, ways: readonly Way[]): void => {
    edges.set(from, [...(edges.get(from) ?? []), { to, ways }]);
  };
  const declared = new Set<string>();
  for (const place of places.values()) {
    if (place.parent !== undefined) {
      const ways = [{ by: WALK, minutes: place.entryMinutes }];
      link(place.id, place.parent, ways);
      link(place.parent, place.id, ways);
    }
    const kept: Connection[] = [];
    for (const connection of place.connections) {
      const pair = [place.id, connection.to].sort().join("~");
      const problem = !places.has(connection.to)
        ? `connection to unknown ${connection.to} is left out`
        : connection.to === place.id
          ? "connection to itself is left out"
          : declared.has(pair)
            ? `connection to ${connection.to} is declared on both pages; only the first is used`
            : undefined;
      if (problem !== undefined) {
        problems.push({ place: place.id, message: problem });
        continue;
      }
      declared.add(pair);
      kept.push(connection);
      link(place.id, connection.to, connection.ways);
      link(connection.to, place.id, connection.ways);
    }
    if (kept.length !== place.connections.length)
      places.set(place.id, { ...place, connections: kept });
  }

  const groups: string[][] = [];
  const grouped = new Set<string>();
  for (const start of places.keys()) {
    if (grouped.has(start)) continue;
    const group: string[] = [];
    const stack = [start];
    while (stack.length) {
      const next = stack.pop()!;
      if (grouped.has(next)) continue;
      grouped.add(next);
      group.push(next);
      for (const { to } of edges.get(next) ?? []) stack.push(to);
    }
    groups.push(group);
  }
  if (groups.length > 1) {
    groups.sort((a, b) => b.length - a.length);
    problems.push({
      message: `the map is ${groups.length} separate parts with no way between them, so nobody can travel from one to another until the smaller parts get a \`parent\` or a connection: ${groups
        .map((group) => `[${group.join(", ")}]`)
        .join(" ")}`,
    });
  }

  const children = new Map<string, string[]>();
  const roots: string[] = [];
  for (const place of places.values()) {
    if (place.parent === undefined) roots.push(place.id);
    else
      children.set(place.parent, [
        ...(children.get(place.parent) ?? []),
        place.id,
      ]);
  }
  const sort = byName(places);
  for (const ids of children.values()) ids.sort(sort);
  const order: string[] = [];
  const visit = (id: string): void => {
    order.push(id);
    for (const child of children.get(id) ?? []) visit(child);
  };
  for (const root of roots.sort(sort)) visit(root);
  return { places, order, children, edges, problems };
}

/** One step of a route, arriving at `placeId`. */
export interface Leg {
  readonly placeId: string;
  readonly ways: readonly Way[];
}

export interface Route {
  readonly from: string;
  readonly to: string;
  readonly legs: readonly Leg[];
  /** Usual minutes: each leg by its first way. */
  readonly minutes: number;
}

/** Usual routes from `from` to every place (Dijkstra on usual minutes). */
export function routesFrom(map: WorldMap, from: string): Map<string, Route> {
  const distance = new Map<string, number>([[from, 0]]);
  const previous = new Map<
    string,
    { readonly from: string; readonly edge: Edge }
  >();
  const done = new Set<string>();
  for (;;) {
    let next: string | undefined;
    for (const [id, minutes] of distance) {
      if (done.has(id)) continue;
      if (
        next === undefined ||
        minutes < distance.get(next)! ||
        (minutes === distance.get(next)! && id < next)
      ) {
        next = id;
      }
    }
    if (next === undefined) break;
    done.add(next);
    for (const edge of map.edges.get(next) ?? []) {
      const minutes = distance.get(next)! + edge.ways[0].minutes;
      if (done.has(edge.to) || minutes >= (distance.get(edge.to) ?? Infinity))
        continue;
      distance.set(edge.to, minutes);
      previous.set(edge.to, { from: next, edge });
    }
  }
  const routes = new Map<string, Route>();
  for (const [to, minutes] of distance) {
    const legs: Leg[] = [];
    for (let at = to; at !== from;) {
      const step = previous.get(at)!;
      legs.unshift({ placeId: at, ways: step.edge.ways });
      at = step.from;
    }
    routes.set(to, { from, to, legs, minutes });
  }
  return routes;
}

/** Throws when there is no way between them: two parts of a broken map. */
export function routeBetween(map: WorldMap, from: string, to: string): Route {
  const route = routesFrom(map, from).get(to);
  if (!route) throw new Error(`No route from ${from} to ${to}.`);
  return route;
}

/**
 * "13 min on foot, 7 by bike", "39 min (by monorail)": the usual time, its
 * non-walking ways, and alternatives that save at least a quarter of it.
 */
export function describeTravel(route: Route): string {
  const usual = route.minutes;
  const modes = [
    ...new Set(
      route.legs.map(({ ways }) => ways[0].by).filter((by) => by !== WALK),
    ),
  ];
  const alternatives = [
    ...new Set(
      route.legs.flatMap(({ ways }) => ways.slice(1).map((way) => way.by)),
    ),
  ]
    .map((by) => ({
      by,
      minutes: route.legs.reduce(
        (sum, { ways }) =>
          sum + (ways.find((way) => way.by === by) ?? ways[0]).minutes,
        0,
      ),
    }))
    .filter(({ minutes }) => usual > 0 && minutes <= usual * 0.75);
  let text = `${Math.round(usual)} min`;
  if (modes.length > 0) text += ` (by ${modes.join(", ")})`;
  else if (alternatives.length > 0) text += " on foot";
  for (const alternative of alternatives) {
    text += `, ${Math.round(alternative.minutes)} by ${alternative.by}`;
  }
  return text;
}

/** The areas containing a place, innermost first. */
export function ancestors(map: WorldMap, id: string): string[] {
  const chain: string[] = [];
  for (
    let up = map.places.get(id)?.parent;
    up !== undefined;
    up = map.places.get(up)?.parent
  ) {
    chain.push(up);
  }
  return chain;
}

/** The backdrop set a place is drawn in: its own, else the nearest area's. */
export function backdropOf(map: WorldMap, id: string): string | undefined {
  const own = map.places.get(id)?.backdrop;
  if (own !== undefined) return own;
  for (const up of ancestors(map, id)) {
    const backdrop = map.places.get(up)?.backdrop;
    if (backdrop !== undefined) return backdrop;
  }
  return undefined;
}

/** `Sweets Club Room `sweets_club_room` (West Annex › Trinity General School)`. */
export function placeLabel(map: WorldMap, id: string): string {
  const name = map.places.get(id)?.name ?? id;
  const areas = ancestors(map, id).map((up) => map.places.get(up)!.name);
  return `${name} \`${id}\`${areas.length > 0 ? ` (${areas.join(" › ")})` : ""}`;
}

/**
 * A place by id, name or alias, ignoring case. A label copied whole from `Where
 * you are` ("Sweets Club Room `sweets_club_room`") resolves by its id.
 */
export function resolvePlace(map: WorldMap, text: string): Place | undefined {
  const wanted = text.trim().toLowerCase();
  const exact = map.places.get(wanted);
  if (exact) return exact;
  const quoted = /`([^`]+)`/u.exec(wanted)?.[1];
  const labelled = quoted === undefined ? undefined : map.places.get(quoted);
  if (labelled) return labelled;
  for (const id of map.order) {
    const place = map.places.get(id)!;
    if (
      place.name.toLowerCase() === wanted ||
      place.aliases.some((alias) => alias.toLowerCase() === wanted)
    ) {
      return place;
    }
  }
  return undefined;
}

/**
 * What can be seen from a place: its area, the places inside it, its neighbours
 * in the same area, and where its connections lead. Whether something is tucked
 * away is for its description to say.
 */
export function visibleFrom(map: WorldMap, from: string): string[] {
  const place = map.places.get(from);
  if (!place) return [];
  const siblings =
    place.parent === undefined
      ? []
      : (map.children.get(place.parent) ?? []).filter((id) => id !== from);
  return [
    ...new Set([
      ...(place.parent === undefined ? [] : [place.parent]),
      ...(map.children.get(from) ?? []),
      ...siblings,
      ...(map.edges.get(from) ?? []).map(({ to }) => to),
    ]),
  ];
}

/** `Name `id` 13 min on foot, 7 by bike`, nearest first; no way, not listed. */
export function renderTravelTimes(
  map: WorldMap,
  from: string,
  ids: readonly string[],
  limit = Infinity,
): string {
  const routes = routesFrom(map, from);
  return ids
    .filter((id) => routes.has(id))
    .sort(
      (a, b) =>
        routes.get(a)!.minutes - routes.get(b)!.minutes || a.localeCompare(b),
    )
    .slice(0, limit)
    .map(
      (id) =>
        `${map.places.get(id)!.name} \`${id}\` ${describeTravel(routes.get(id)!)}`,
    )
    .join(" · ");
}
