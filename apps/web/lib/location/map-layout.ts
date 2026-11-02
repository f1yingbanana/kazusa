import type { Place } from "@kazusa/client";
import type { PlaceIndex } from "./places";

/*
 * Where each place goes on the map. A page can say where it is (`map` in its
 * frontmatter, as a fraction of the map); each area is then laid out on its own,
 * innermost first: its sub-places and its own open space (the area's id) become
 * circles, and the area is one circle in the area around it. Keeping every area
 * inside its circle means regions never cross, whatever the graph looks like.
 *
 * A coordinate is where a place starts: it moves only as far as it must to stop
 * overlapping a neighbour, so real geography survives and a layout someone
 * arranged, which is already clear of overlaps, comes back exactly.
 *
 * Places with no coordinate are solved around the others by stress minimization,
 * so drawn distance follows travel time, the only distance they have. SGD (Zheng,
 * Pawar & Goodman 2018) with a seeded shuffle: the same map comes out the same.
 */

/** Drawing units per map unit: a map 1 wide fits hundreds of places. */
export const MAP_SCALE = 10000;

/** Room for a marker, its label and a few people. */
export const PLACE_RADIUS = 40;
const SIBLING_GAP = 14;
const AREA_PADDING = 22;
/** Long trips shouldn't stretch the map: length grows with the root of the time. */
const UNITS_PER_ROOT_MINUTE = 12;
const ITERATIONS = 30;
const OVERLAP_PASSES = 200;
const COMPACT_ROUNDS = 40;
const COMPACT_PULL = 0.07;

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface MapNode extends Point {
  readonly id: string;
  /** The area this place is drawn inside; absent at the top of the map. */
  readonly parent?: string;
  readonly depth: number;
  readonly isArea: boolean;
  /** The circle everything inside this place fits in. */
  readonly radius: number;
}

export interface MapEdge {
  readonly a: string;
  readonly b: string;
  readonly minutes: number;
  readonly by: string;
  readonly note?: string;
}

export interface MapGeometry {
  readonly nodes: ReadonlyMap<string, MapNode>;
  /** Parents before children, so drawing in order stacks regions correctly. */
  readonly order: readonly string[];
  /** Where each place ended up, in map units: what saving it would write. */
  readonly coordinates: Readonly<Record<string, Point>>;
  readonly edges: readonly MapEdge[];
}

function hash(text: string): number {
  let value = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    value = Math.imul(value ^ text.charCodeAt(i), 16777619);
  }
  return value >>> 0;
}

/** Small seeded generator (mulberry32). */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Places whose `parent` is missing or part of a loop count as top level. */
function topLevel(index: PlaceIndex): string[] {
  const reached = new Set<string>();
  const roots: string[] = [];
  const visit = (id: string) => {
    reached.add(id);
    for (const child of index.children.get(id) ?? []) {
      if (!reached.has(child)) visit(child);
    }
  };
  for (const place of index.places) {
    if (place.parent === undefined || !index.byId.has(place.parent)) {
      roots.push(place.id);
      visit(place.id);
    }
  }
  for (const place of index.places) {
    if (!reached.has(place.id)) {
      roots.push(place.id);
      visit(place.id);
    }
  }
  return roots;
}

/** The usual way between each pair of places, once per pair. */
export function collectEdges(places: readonly Place[]): MapEdge[] {
  const byId = new Set(places.map((place) => place.id));
  const edges = new Map<string, MapEdge>();
  for (const place of places) {
    for (const connection of place.connections) {
      if (!byId.has(connection.to) || connection.to === place.id) continue;
      const [a, b] = [place.id, connection.to].sort() as [string, string];
      const usual = connection.ways[0];
      if (!usual) continue;
      const key = `${a}\n${b}`;
      const known = edges.get(key);
      if (!known || usual.minutes < known.minutes) {
        edges.set(key, {
          a,
          b,
          minutes: usual.minutes,
          by: usual.by,
          ...(connection.note ? { note: connection.note } : {}),
        });
      }
    }
  }
  return [...edges.values()];
}

interface Item {
  readonly id: string;
  readonly radius: number;
  readonly pinned: boolean;
  x: number;
  y: number;
}

/** Pushes overlapping circles apart; pinned circles stay where they were put. */
export function separate(
  items: readonly Item[],
  passes = OVERLAP_PASSES,
): void {
  for (let pass = 0; pass < passes; pass += 1) {
    let moved = false;
    for (let i = 0; i < items.length; i += 1) {
      for (let j = i + 1; j < items.length; j += 1) {
        const a = items[i];
        const b = items[j];
        if (a.pinned && b.pinned) continue;
        const need = a.radius + b.radius + SIBLING_GAP;
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let distance = Math.hypot(dx, dy);
        if (distance >= need) continue;
        if (distance < 1e-6) {
          const angle = (hash(`${a.id}\n${b.id}`) / 2 ** 32) * Math.PI * 2;
          dx = Math.cos(angle);
          dy = Math.sin(angle);
          distance = 1;
        }
        const push = (need - distance) / distance;
        const shareA = a.pinned ? 0 : b.pinned ? 1 : 0.5;
        const shareB = b.pinned ? 0 : a.pinned ? 1 : 0.5;
        a.x -= dx * push * shareA;
        a.y -= dy * push * shareA;
        b.x += dx * push * shareB;
        b.y += dy * push * shareB;
        moved = true;
      }
    }
    if (!moved) return;
  }
}

/**
 * Pulls a solved layout in until it's packed. Path lengths add up every radius
 * along the way, which on big worlds leaves areas many times wider than they
 * need; this keeps who is near whom while spending that space on the screen.
 */
function compact(items: readonly Item[]): void {
  const free = items.filter((item) => !item.pinned);
  for (let round = 0; round < COMPACT_ROUNDS; round += 1) {
    // Toward the middle of everything; an area's centre is at its origin.
    const cx = items.reduce((sum, item) => sum + item.x, 0) / items.length;
    const cy = items.reduce((sum, item) => sum + item.y, 0) / items.length;
    for (const item of free) {
      item.x -= (item.x - cx) * COMPACT_PULL;
      item.y -= (item.y - cy) * COMPACT_PULL;
    }
    separate(items, 8);
  }
}

/** Shortest drawn length between all items; Infinity across components. */
function allPairs(
  count: number,
  links: ReadonlyMap<string, number>,
): Float64Array {
  const distance = new Float64Array(count * count).fill(Infinity);
  for (let i = 0; i < count; i += 1) distance[i * count + i] = 0;
  for (const [key, length] of links) {
    const [i, j] = key.split(":").map(Number) as [number, number];
    distance[i * count + j] = Math.min(distance[i * count + j], length);
    distance[j * count + i] = distance[i * count + j]!;
  }
  for (let k = 0; k < count; k += 1) {
    for (let i = 0; i < count; i += 1) {
      const viaK = distance[i * count + k];
      if (viaK === Infinity) continue;
      for (let j = 0; j < count; j += 1) {
        const through = viaK + distance[k * count + j];
        if (through < distance[i * count + j]) {
          distance[i * count + j] = through;
        }
      }
    }
  }
  return distance;
}

/** Moves unpinned items so their distances approach the shortest-path lengths. */
function minimizeStress(
  items: readonly Item[],
  links: ReadonlyMap<string, number>,
  random: () => number,
): void {
  const count = items.length;
  const distance = allPairs(count, links);
  let longest = 0;
  for (const value of distance) {
    if (value !== Infinity && value > longest) longest = value;
  }
  // Unconnected pieces sit a little past the longest route, held only loosely.
  const fallback =
    Math.max(longest, ...items.map((item) => item.radius * 2)) * 1.1 +
    SIBLING_GAP;
  const pairs: { i: number; j: number; d: number; w: number }[] = [];
  let smallest = Infinity;
  let largest = 0;
  for (let i = 0; i < count; i += 1) {
    for (let j = i + 1; j < count; j += 1) {
      if (items[i].pinned && items[j].pinned) continue;
      const known = distance[i * count + j];
      const d = Math.max(
        known === Infinity ? fallback : known,
        items[i].radius + items[j].radius,
      );
      pairs.push({
        i,
        j,
        d,
        w: (known === Infinity ? 0.1 : 1) / (d * d),
      });
      smallest = Math.min(smallest, d);
      largest = Math.max(largest, d);
    }
  }
  if (pairs.length === 0) return;
  const start = largest * largest;
  const end = 0.1 * smallest * smallest;
  const decay = Math.log(start / end) / (ITERATIONS - 1);
  for (let t = 0; t < ITERATIONS; t += 1) {
    const step = start * Math.exp(-decay * t);
    for (let p = pairs.length - 1; p > 0; p -= 1) {
      const q = Math.floor(random() * (p + 1));
      [pairs[p], pairs[q]] = [pairs[q], pairs[p]];
    }
    for (const { i, j, d, w } of pairs) {
      const a = items[i];
      const b = items[j];
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const length = Math.hypot(dx, dy) || 1e-6;
      const move = (Math.min(1, w * step) * (length - d)) / 2 / length;
      const shareA = a.pinned ? 0 : b.pinned ? 2 : 1;
      const shareB = b.pinned ? 0 : a.pinned ? 2 : 1;
      a.x -= dx * move * shareA;
      a.y -= dy * move * shareA;
      b.x += dx * move * shareB;
      b.y += dy * move * shareB;
    }
  }
}

/** Turns a free layout so its long side runs across: screens are wide. */
function alignLongSide(items: readonly Item[]): void {
  // Weighted by size: a big area sets the shape more than a lone place does.
  let total = 0;
  let cx = 0;
  let cy = 0;
  for (const { x, y, radius } of items) {
    const weight = radius * radius;
    total += weight;
    cx += x * weight;
    cy += y * weight;
  }
  cx /= total;
  cy /= total;
  let xx = 0;
  let yy = 0;
  let xy = 0;
  for (const { x, y, radius } of items) {
    const weight = radius * radius;
    xx += weight * (x - cx) ** 2;
    yy += weight * (y - cy) ** 2;
    xy += weight * (x - cx) * (y - cy);
  }
  const angle = -0.5 * Math.atan2(2 * xy, xx - yy);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  for (const item of items) {
    const x = item.x - cx;
    const y = item.y - cy;
    item.x = x * cos - y * sin;
    item.y = x * sin + y * cos;
  }
}

/**
 * @param coordinates Where places start, in map units; usually from their
 *   pages.
 * @param held A place being moved: it and the areas around it stay put, and
 *   everything else makes room.
 */
export function computeMapGeometry(
  index: PlaceIndex,
  coordinates: Readonly<Record<string, Point>>,
  held?: string,
): MapGeometry {
  const edges = collectEdges(index.places);
  const roots = topLevel(index);
  const parentOf = new Map<string, string | undefined>();
  const childrenOf = (id: string | undefined): readonly string[] =>
    id === undefined ? roots : (index.children.get(id) ?? []);
  const fill = (id: string | undefined) => {
    for (const child of childrenOf(id)) {
      if (parentOf.has(child)) continue;
      parentOf.set(child, id);
      fill(child);
    }
  };
  fill(undefined);
  const inFrame = (frame: string | undefined) =>
    childrenOf(frame).filter((id) => parentOf.get(id) === frame);

  // From a place up to the top of the map, itself first.
  const chainOf = (id: string): string[] => {
    const chain: string[] = [];
    for (
      let at: string | undefined = id;
      at !== undefined;
      at = parentOf.get(at)
    ) {
      chain.push(at);
    }
    return chain;
  };
  const heldChain = new Set(
    held !== undefined && parentOf.has(held) ? chainOf(held) : [],
  );

  // An area with no coordinate of its own sits amid the places inside it.
  const known = new Map<string, Point>();
  const resolve = (id: string) => {
    const inside: Point[] = [];
    for (const child of inFrame(id)) {
      resolve(child);
      const at = known.get(child);
      if (at) inside.push(at);
    }
    const own = coordinates[id];
    if (own) {
      known.set(id, own);
    } else if (inside.length > 0) {
      known.set(id, {
        x: inside.reduce((sum, at) => sum + at.x, 0) / inside.length,
        y: inside.reduce((sum, at) => sum + at.y, 0) / inside.length,
      });
    }
  };
  for (const root of roots) resolve(root);

  // Each connection belongs to the innermost area holding both ends, between
  // whichever of its items hold them. A cross-area road pulls the areas together.
  const linksIn = new Map<string | undefined, MapEdge[]>();
  const lifted = new Map<MapEdge, readonly [string, string]>();
  for (const edge of edges) {
    if (!parentOf.has(edge.a) || !parentOf.has(edge.b)) continue;
    const chainA = chainOf(edge.a).reverse();
    const chainB = chainOf(edge.b).reverse();
    let shared = 0;
    while (
      shared < chainA.length &&
      shared < chainB.length &&
      chainA[shared] === chainB[shared]
    ) {
      shared += 1;
    }
    const frame = shared > 0 ? chainA[shared - 1] : undefined;
    // An end that is the area itself is its open space: the item with its id.
    lifted.set(edge, [chainA[shared] ?? frame!, chainB[shared] ?? frame!]);
    linksIn.set(frame, [...(linksIn.get(frame) ?? []), edge]);
  }

  const local: Record<string, Point> = {};
  const radii = new Map<string, number>();

  const layOut = (frame: string | undefined): number => {
    const childIds = inFrame(frame);
    for (const child of childIds) {
      radii.set(
        child,
        inFrame(child).length > 0 ? layOut(child) : PLACE_RADIUS,
      );
    }
    const random = seeded(hash(frame ?? "\0top"));
    const origin = frame === undefined ? undefined : known.get(frame);
    const placedAt = (id: string): Point | undefined => {
      const at = known.get(id);
      if (!at) return undefined;
      return {
        x: (at.x - (origin?.x ?? 0)) * MAP_SCALE,
        y: (at.y - (origin?.y ?? 0)) * MAP_SCALE,
      };
    };
    const placed = childIds.flatMap((id) => placedAt(id) ?? []);
    const middle = {
      x: placed.reduce((sum, at) => sum + at.x, 0) / (placed.length || 1),
      y: placed.reduce((sum, at) => sum + at.y, 0) / (placed.length || 1),
    };
    // An area's own open space is its fixed centre.
    const items: Item[] = [
      ...(frame === undefined
        ? []
        : [
            {
              id: frame,
              radius: PLACE_RADIUS,
              pinned: true,
              x: 0,
              y: 0,
            },
          ]),
      ...childIds.map((id) => {
        const at = placedAt(id);
        const angle = random() * Math.PI * 2;
        const spread =
          (radii.get(id) ?? PLACE_RADIUS) * 2 + childIds.length * 30;
        return {
          id,
          radius: radii.get(id) ?? PLACE_RADIUS,
          pinned: at !== undefined,
          x: at?.x ?? middle.x + Math.cos(angle) * spread * random(),
          y: at?.y ?? middle.y + Math.sin(angle) * spread * random(),
        };
      }),
    ];

    if (items.some((item) => !item.pinned)) {
      const indexOf = new Map(items.map((item, i) => [item.id, i]));
      const links = new Map<string, number>();
      const link = (a: string, b: string, minutes: number) => {
        const i = indexOf.get(a);
        const j = indexOf.get(b);
        if (i === undefined || j === undefined || i === j) return;
        const key = i < j ? `${i}:${j}` : `${j}:${i}`;
        const length =
          items[i].radius +
          items[j].radius +
          SIBLING_GAP +
          Math.sqrt(minutes) * UNITS_PER_ROOT_MINUTE;
        links.set(key, Math.min(links.get(key) ?? Infinity, length));
      };
      for (const edge of linksIn.get(frame) ?? []) {
        const [a, b] = lifted.get(edge)!;
        link(a, b, edge.minutes);
      }
      if (frame !== undefined) {
        for (const id of childIds) {
          link(frame, id, index.byId.get(id)?.entryMinutes ?? 1);
        }
      }
      minimizeStress(items, links, random);
      separate(items);
      compact(items);
      if (frame === undefined && !items.some((item) => item.pinned)) {
        alignLongSide(items);
      }
    }
    // From here coordinates give way too; only the centre and what's held stay.
    const settling = items.map((item) => ({
      ...item,
      pinned: item.id === frame || heldChain.has(item.id),
    }));
    separate(settling);

    let radius = PLACE_RADIUS;
    for (const item of settling) {
      if (item.id !== frame) local[item.id] = { x: item.x, y: item.y };
      radius = Math.max(radius, Math.hypot(item.x, item.y) + item.radius);
    }
    return radius + AREA_PADDING;
  };
  layOut(undefined);

  const nodes = new Map<string, MapNode>();
  const order: string[] = [];
  const solved: Record<string, Point> = {};
  const place = (
    id: string,
    parent: string | undefined,
    depth: number,
    origin: Point,
  ) => {
    const here = local[id] ?? { x: 0, y: 0 };
    const x = origin.x + here.x;
    const y = origin.y + here.y;
    const children = inFrame(id);
    nodes.set(id, {
      id,
      ...(parent === undefined ? {} : { parent }),
      depth,
      isArea: children.length > 0,
      radius: radii.get(id) ?? PLACE_RADIUS,
      x,
      y,
    });
    solved[id] = { x: x / MAP_SCALE, y: y / MAP_SCALE };
    order.push(id);
    for (const child of children) place(child, id, depth + 1, { x, y });
  };
  for (const root of roots) place(root, undefined, 0, { x: 0, y: 0 });

  return { nodes, order, coordinates: solved, edges };
}

/** Moves a place by a distance in map units, and everything inside it along. */
export function shiftPlace(
  geometry: MapGeometry,
  coordinates: Readonly<Record<string, Point>>,
  id: string,
  dx: number,
  dy: number,
): Record<string, Point> {
  const next = { ...coordinates };
  const within = new Set([id]);
  // `order` has parents first, so one pass finds every descendant.
  for (const other of geometry.order) {
    const parent = geometry.nodes.get(other)?.parent;
    if (parent !== undefined && within.has(parent)) within.add(other);
  }
  for (const other of within) {
    const at = next[other];
    if (at) next[other] = { x: at.x + dx, y: at.y + dy };
  }
  return next;
}

const SAME_SPOT = 0.00005;
const differs = (a: Point | undefined, b: Point | undefined) =>
  !a ||
  !b ||
  Math.abs(a.x - b.x) > SAME_SPOT ||
  Math.abs(a.y - b.y) > SAME_SPOT;

/**
 * What to write after arranging. Only pages that need it: what moved, and at
 * every level above it, its neighbours, so places laid out automatically or
 * nudged off their coordinate stay exactly where the arranging left them.
 * Rounded to about one drawing unit, finer than anyone can see.
 */
export function positionsToSave({
  geometry,
  before,
  stored,
}: {
  readonly geometry: MapGeometry;
  /** Where everything was drawn when arranging began. */
  readonly before: Readonly<Record<string, Point>>;
  /** What the pages say now. */
  readonly stored: Readonly<Record<string, Point>>;
}): Record<string, Point> {
  const { nodes, order, coordinates } = geometry;
  const frames = new Set<string | undefined>();
  for (const id of order) {
    if (!differs(coordinates[id], before[id])) continue;
    for (
      let at: string | undefined = id;
      at !== undefined;
      at = nodes.get(at)?.parent
    ) {
      frames.add(nodes.get(at)?.parent);
    }
  }
  const round = (value: number) => Math.round(value * 10000) / 10000;
  const save: Record<string, Point> = {};
  for (const id of order) {
    if (!frames.has(nodes.get(id)?.parent)) continue;
    const at = coordinates[id];
    if (at && differs(at, stored[id])) {
      save[id] = { x: round(at.x), y: round(at.y) };
    }
  }
  return save;
}

/** The whole map's bounds, for fitting it to a screen. */
export function boundsOf(nodes: Iterable<MapNode>) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    minX = Math.min(minX, node.x - node.radius);
    minY = Math.min(minY, node.y - node.radius);
    maxX = Math.max(maxX, node.x + node.radius);
    maxY = Math.max(maxY, node.y + node.radius);
  }
  return { minX, minY, maxX, maxY };
}
