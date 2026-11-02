import type { LocationRecord } from "@kazusa/client";
import {
  PLACE_RADIUS,
  type MapEdge,
  type MapGeometry,
  type MapNode,
  type Point,
} from "./map-layout";
import { positionAt } from "./places";

/*
 * What the map shows at a zoom level, and the shapes it draws. A region's inside
 * appears once there's room on screen, like the streets of a town on a road
 * atlas; until then roads and people count toward the nearest thing still shown.
 */

/**
 * An area opens once its closest places are this far apart on screen, in
 * pixels.
 */
const OPEN_SPACING = 25;

/** Zoom from which each place's marker shows, and (`open:<id>`) each area opens. */
export type Reveal = ReadonlyMap<string, number>;

export function computeReveal(geometry: MapGeometry): Reveal {
  const inside = new Map<string, MapNode[]>();
  for (const id of geometry.order) {
    const node = geometry.nodes.get(id)!;
    if (node.parent) {
      inside.set(node.parent, [...(inside.get(node.parent) ?? []), node]);
    }
  }
  const marker = new Map<string, number>();
  for (const id of geometry.order) {
    const node = geometry.nodes.get(id)!;
    const parent = node.parent ? geometry.nodes.get(node.parent) : undefined;
    marker.set(id, parent ? (marker.get(`open:${parent.id}`) ?? 0) : 0);
    const children = inside.get(id);
    if (!children) continue;
    // Everything in an area opens together, when its tightest pair has room.
    let closest = Infinity;
    for (let i = 0; i < children.length; i += 1) {
      const a = children[i];
      closest = Math.min(closest, Math.hypot(a.x - node.x, a.y - node.y));
      for (let j = i + 1; j < children.length; j += 1) {
        const b = children[j];
        closest = Math.min(closest, Math.hypot(a.x - b.x, a.y - b.y));
      }
    }
    marker.set(
      `open:${id}`,
      Math.max(marker.get(id) ?? 0, OPEN_SPACING / Math.max(closest, 1)),
    );
  }
  return marker;
}

/** The zoom at which an area's inside shows. */
export const opensAt = (reveal: Reveal, id: string) =>
  reveal.get(`open:${id}`) ?? 0;

/** Whether an area's inside isn't showing yet at this zoom. */
export const isClosed = (reveal: Reveal, id: string, zoom: number) =>
  (reveal.get(`open:${id}`) ?? 0) > zoom;

/** The nearest place at or above `id` whose marker shows at this zoom. */
export function markerFor(
  geometry: MapGeometry,
  reveal: Reveal,
  id: string,
  zoom: number,
): string {
  let at = id;
  for (;;) {
    if ((reveal.get(at) ?? 0) <= zoom) return at;
    const parent = geometry.nodes.get(at)?.parent;
    if (parent === undefined) return at;
    at = parent;
  }
}

export interface ShownEdge extends MapEdge {
  readonly key: string;
  /** The road as drawn at this zoom; its ends may stand in for hidden places. */
  readonly from: string;
  readonly to: string;
  readonly exact: boolean;
}

/** Roads at this zoom: ends move up to what's shown, and duplicates merge. */
export function edgesAt(
  geometry: MapGeometry,
  reveal: Reveal,
  zoom: number,
): ShownEdge[] {
  const shown = new Map<string, ShownEdge>();
  for (const edge of geometry.edges) {
    if (!geometry.nodes.has(edge.a) || !geometry.nodes.has(edge.b)) continue;
    const from = markerFor(geometry, reveal, edge.a, zoom);
    const to = markerFor(geometry, reveal, edge.b, zoom);
    if (from === to) continue;
    const key = from < to ? `${from}\n${to}` : `${to}\n${from}`;
    const exact = from === edge.a && to === edge.b;
    const known = shown.get(key);
    if (!known || edge.minutes < known.minutes) {
      shown.set(key, {
        ...edge,
        key,
        from,
        to,
        exact: exact && (known === undefined || known.exact),
      });
    } else if (known.exact) {
      shown.set(key, { ...known, exact: false });
    }
  }
  return [...shown.values()];
}

export interface Curve {
  readonly from: Point;
  readonly control: Point;
  readonly to: Point;
}

/**
 * A gentle bend, always the same way for a pair of places, so roads meeting at
 * one place fan apart and read as roads rather than a diagram's straight
 * lines.
 */
export function curveBetween(
  a: Point & { readonly id: string },
  b: Point & { readonly id: string },
): Curve {
  const [start, end] = a.id < b.id ? [a, b] : [b, a];
  let seed = 0;
  for (const char of `${start.id}${end.id}`)
    seed = (seed * 31 + char.charCodeAt(0)) | 0;
  const bend = (seed & 1 ? 1 : -1) * (0.06 + ((seed >>> 1) % 7) * 0.012);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  return {
    from: start,
    to: end,
    control: {
      x: (start.x + end.x) / 2 - dy * bend,
      y: (start.y + end.y) / 2 + dx * bend,
    },
  };
}

export const curvePath = ({ from, control, to }: Curve) =>
  `M${from.x.toFixed(1)} ${from.y.toFixed(1)}Q${control.x.toFixed(1)} ${control.y.toFixed(1)} ${to.x.toFixed(1)} ${to.y.toFixed(1)}`;

export function pointOnCurve({ from, control, to }: Curve, t: number): Point {
  const u = 1 - t;
  return {
    x: u * u * from.x + 2 * u * t * control.x + t * t * to.x,
    y: u * u * from.y + 2 * u * t * control.y + t * t * to.y,
  };
}

function convexHull(points: Point[]): Point[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: Point, a: Point, b: Point) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const half = (list: Point[]) => {
    const chain: Point[] = [];
    for (const point of list) {
      while (
        chain.length >= 2 &&
        cross(chain[chain.length - 2], chain[chain.length - 1], point) <= 0
      ) {
        chain.pop();
      }
      chain.push(point);
    }
    chain.pop();
    return chain;
  };
  return [...half(sorted), ...half([...sorted].reverse())];
}

/** A closed smooth outline around circles. */
function outline(
  circles: readonly (Point & { readonly r: number })[],
  padding: number,
): { readonly path: string; readonly top: Point; readonly bottom: Point } {
  const samples: Point[] = [];
  for (const { x, y, r } of circles) {
    for (let i = 0; i < 12; i += 1) {
      const angle = (i / 12) * Math.PI * 2;
      samples.push({
        x: x + Math.cos(angle) * (r + padding),
        y: y + Math.sin(angle) * (r + padding),
      });
    }
  }
  const hull = convexHull(samples);
  const mid = (a: Point, b: Point) => ({
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  });
  const fmt = ({ x, y }: Point) => `${x.toFixed(1)} ${y.toFixed(1)}`;
  const start = mid(hull[hull.length - 1], hull[0]);
  let path = `M${fmt(start)}`;
  hull.forEach((point, i) => {
    path += `Q${fmt(point)} ${fmt(mid(point, hull[(i + 1) % hull.length]))}`;
  });
  const top = hull.reduce((best, point) => (point.y < best.y ? point : best));
  const bottom = hull.reduce((best, point) =>
    point.y > best.y ? point : best,
  );
  return { path: `${path}Z`, top, bottom };
}

export interface Region {
  readonly id: string;
  readonly depth: number;
  readonly path: string;
  /** A second, wider line around it: one more contour on the way up. */
  readonly contour: string;
  /** Where the area's name can sit: its upper edge, or else its lower. */
  readonly top: Point;
  readonly bottom: Point;
}

/** One smooth region for each area, parents first so children stack on top. */
export function computeRegions(geometry: MapGeometry): Region[] {
  const inside = new Map<string, (Point & { r: number })[]>();
  for (const id of geometry.order) {
    const node = geometry.nodes.get(id)!;
    // The wide centre keeps an area with few places a region, not a sausage.
    if (node.isArea) {
      inside.set(id, [{ x: node.x, y: node.y, r: node.radius * 0.62 }]);
    }
    if (node.parent) {
      inside.get(node.parent)?.push({
        x: node.x,
        y: node.y,
        r: node.isArea ? node.radius - 8 : PLACE_RADIUS * 0.8,
      });
    }
  }
  const regions: Region[] = [];
  for (const id of geometry.order) {
    const circles = inside.get(id);
    if (!circles) continue;
    const { path, top, bottom } = outline(circles, 8);
    regions.push({
      id,
      depth: geometry.nodes.get(id)!.depth,
      path,
      contour: outline(circles, 15).path,
      top,
      bottom,
    });
  }
  return regions;
}

/** Where someone on a trip is drawn, between the last place passed and the next. */
export function travelerPoint(
  record: LocationRecord,
  at: number,
  geometry: MapGeometry,
): Point | undefined {
  const position = positionAt(record, at);
  if (position.kind !== "traveling") return undefined;
  const a = geometry.nodes.get(position.passed);
  const b = geometry.nodes.get(position.next);
  if (!a || !b) return undefined;
  const { trip } = position;
  const startAt =
    trip.legs.filter((leg) => leg.at <= at).at(-1)?.at ?? trip.departAt;
  const endAt = trip.legs.find((leg) => leg.at > at)?.at ?? trip.arriveAt;
  const t = endAt > startAt ? (at - startAt) / (endAt - startAt) : 0;
  const curve = curveBetween(a, b);
  return pointOnCurve(curve, a.id < b.id ? t : 1 - t);
}

/** Every stop of a trip in order, for drawing its route. */
export function routeStops(record: LocationRecord): string[] {
  const { trip } = record;
  if (!trip) return [];
  const stops = [record.placeId];
  for (const id of [...trip.legs.map((leg) => leg.placeId), trip.to]) {
    if (stops[stops.length - 1] !== id) stops.push(id);
  }
  return stops;
}

/* Screen-space label placement ------------------------------------------- */

const CHAR_WIDTH = 6.1;
const LABEL_HEIGHT = 15;
const MARKER_SIZE = 12;
const LABEL_GAP = 9;
const AVATAR_STEP = 16;
const AVATAR_SIZE = 23;
const LABEL_MAX_WIDTH = 144;
const AREA_LABEL_MAX_WIDTH = 208;
const CELL = 96;

interface Rect {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** A bucket grid of what's been placed, so each test only looks nearby. */
class Occupied {
  private readonly cells = new Map<string, Rect[]>();

  private *keys({ x0, y0, x1, y1 }: Rect) {
    for (let x = Math.floor(x0 / CELL); x <= Math.floor(x1 / CELL); x += 1) {
      for (let y = Math.floor(y0 / CELL); y <= Math.floor(y1 / CELL); y += 1) {
        yield `${x}:${y}`;
      }
    }
  }

  free(rect: Rect): boolean {
    for (const key of this.keys(rect)) {
      for (const other of this.cells.get(key) ?? []) {
        if (
          rect.x0 < other.x1 &&
          rect.x1 > other.x0 &&
          rect.y0 < other.y1 &&
          rect.y1 > other.y0
        ) {
          return false;
        }
      }
    }
    return true;
  }

  add(rect: Rect): void {
    for (const key of this.keys(rect)) {
      const cell = this.cells.get(key);
      if (cell) cell.push(rect);
      else this.cells.set(key, [rect]);
    }
  }
}

const textWidth = (text: string, max: number) =>
  Math.min(text.length * CHAR_WIDTH + 4, max);

export interface LabelPlan {
  /** Places whose names show. */
  readonly names: ReadonlySet<string>;
  /** Areas whose names show, and on which edge of the region. */
  readonly areaNames: ReadonlyMap<string, Point>;
  /** Avatars to draw per place; the rest of its people become a count. */
  readonly avatars: ReadonlyMap<string, number>;
  /** Roads with room for their travel time. */
  readonly times: ReadonlySet<string>;
}

/**
 * Decides what's written on the map at one zoom, in order of importance, on
 * screen pixels: as much as fits without anything landing on anything else. A
 * fixed reveal threshold would leave a sparse overview empty and a dense one
 * unreadable. Everywhere a person is matters most, then big areas, then the
 * rest.
 */
export function planLabels({
  geometry,
  regions,
  reveal,
  edges,
  zoom,
  nameOf,
  peopleAt,
  maxAvatars,
}: {
  readonly geometry: MapGeometry;
  readonly regions: readonly Region[];
  readonly reveal: Reveal;
  readonly edges: readonly ShownEdge[];
  readonly zoom: number;
  readonly nameOf: (id: string) => string;
  /** How many people are drawn at each place. */
  readonly peopleAt: (id: string) => number;
  readonly maxAvatars: number;
}): LabelPlan {
  const occupied = new Occupied();
  const shown = geometry.order
    .map((id) => geometry.nodes.get(id)!)
    .filter((node) => (reveal.get(node.id) ?? 0) <= zoom);

  // Every marker is taken before any words are placed.
  for (const node of shown) {
    occupied.add({
      x0: node.x * zoom - MARKER_SIZE / 2,
      y0: node.y * zoom - MARKER_SIZE / 2,
      x1: node.x * zoom + MARKER_SIZE / 2,
      y1: node.y * zoom + MARKER_SIZE / 2,
    });
  }

  const names = new Set<string>();
  const areaNames = new Map<string, Point>();
  const avatars = new Map<string, number>();

  const below = (
    node: MapNode,
    width: number,
    top: number,
    height: number,
  ) => ({
    x0: node.x * zoom - width / 2,
    y0: node.y * zoom + top,
    x1: node.x * zoom + width / 2,
    y1: node.y * zoom + top + height,
  });
  const clusterWidth = (count: number) => {
    const faces = Math.min(count, maxAvatars);
    return (
      AVATAR_SIZE +
      Math.max(0, faces - 1) * AVATAR_STEP +
      (count > faces ? AVATAR_SIZE : 0)
    );
  };

  // Places with people: name and faces, else just faces, else a count.
  const busy = shown
    .filter((node) => peopleAt(node.id) > 0)
    .sort((a, b) => peopleAt(b.id) - peopleAt(a.id));
  for (const node of busy) {
    const count = peopleAt(node.id);
    const width = clusterWidth(count);
    const name = node.isArea ? undefined : nameOf(node.id);
    const nameRect =
      name === undefined
        ? undefined
        : below(
            node,
            textWidth(name, LABEL_MAX_WIDTH),
            LABEL_GAP,
            LABEL_HEIGHT,
          );
    const under = nameRect ? LABEL_GAP + LABEL_HEIGHT + 2 : LABEL_GAP;
    const faces = below(node, width, under, AVATAR_SIZE);
    if ((!nameRect || occupied.free(nameRect)) && occupied.free(faces)) {
      if (nameRect) {
        occupied.add(nameRect);
        names.add(node.id);
      }
      occupied.add(faces);
      avatars.set(node.id, Math.min(count, maxAvatars));
      continue;
    }
    const alone = below(node, width, LABEL_GAP, AVATAR_SIZE);
    if (occupied.free(alone)) {
      occupied.add(alone);
      avatars.set(node.id, Math.min(count, maxAvatars));
      continue;
    }
    occupied.add(below(node, AVATAR_SIZE, LABEL_GAP, AVATAR_SIZE));
    avatars.set(node.id, 0);
  }

  // Area names, outermost and largest first.
  const byImportance = [...regions].sort(
    (a, b) =>
      a.depth - b.depth ||
      geometry.nodes.get(b.id)!.radius - geometry.nodes.get(a.id)!.radius,
  );
  for (const region of byImportance) {
    if ((reveal.get(region.id) ?? 0) > zoom) continue;
    const width = textWidth(nameOf(region.id), AREA_LABEL_MAX_WIDTH) * 1.15;
    for (const spot of [region.top, region.bottom]) {
      const rect = {
        x0: spot.x * zoom - width / 2,
        y0: spot.y * zoom - LABEL_HEIGHT / 2 - 1,
        x1: spot.x * zoom + width / 2,
        y1: spot.y * zoom + LABEL_HEIGHT / 2 + 1,
      };
      if (!occupied.free(rect)) continue;
      occupied.add(rect);
      areaNames.set(region.id, spot);
      break;
    }
  }

  // Remaining places, shallowest first.
  const quiet = shown
    .filter(
      (node) => !node.isArea && !names.has(node.id) && !avatars.has(node.id),
    )
    .sort((a, b) => a.depth - b.depth);
  for (const node of quiet) {
    const rect = below(
      node,
      textWidth(nameOf(node.id), LABEL_MAX_WIDTH),
      LABEL_GAP,
      LABEL_HEIGHT,
    );
    if (!occupied.free(rect)) continue;
    occupied.add(rect);
    names.add(node.id);
  }

  // Travel times take whatever room is left along their roads.
  const times = new Set<string>();
  for (const edge of edges) {
    if (!edge.exact) continue;
    const point = edgeMiddle(edge, geometry);
    if (!point) continue;
    const half = 26;
    const rect = {
      x0: point.x * zoom - half,
      y0: point.y * zoom - 7,
      x1: point.x * zoom + half,
      y1: point.y * zoom + 7,
    };
    if (!occupied.free(rect)) continue;
    occupied.add(rect);
    times.add(edge.key);
  }
  return { names, areaNames, avatars, times };
}

export function edgeMiddle(
  edge: ShownEdge,
  geometry: MapGeometry,
): Point | undefined {
  const a = geometry.nodes.get(edge.from);
  const b = geometry.nodes.get(edge.to);
  return a && b ? pointOnCurve(curveBetween(a, b), 0.5) : undefined;
}
