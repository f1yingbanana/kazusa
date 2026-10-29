import type { LocationRecord, Place } from "@kazusa/client";
import { MINUTE } from "../../time/sim";

/*
 * A small generic town for the mock world (D1: no lore). Same shape as World
 * Wiki places: a tree through `parent`, two-way connections declared once.
 */

type Seed = {
  id: string;
  name: string;
  parent?: string;
  summary: string;
  entry?: number;
  connections?: Place["connections"];
};

const SEEDS: readonly Seed[] = [
  {
    id: "old-town",
    name: "Old Town",
    summary: "Cobbled lanes around the market; busiest at midday.",
    connections: [
      {
        to: "riverside",
        ways: [
          { by: "walk", minutes: 8 },
          { by: "tram", minutes: 4 },
        ],
      },
      {
        to: "the-hill",
        ways: [
          { by: "walk", minutes: 14 },
          { by: "bike", minutes: 7 },
        ],
      },
      { to: "residences", ways: [{ by: "walk", minutes: 9 }] },
    ],
  },
  {
    id: "market-square",
    name: "Market Square",
    parent: "old-town",
    summary: "Open square with a fountain; stalls fold up at dusk.",
    entry: 2,
  },
  {
    id: "night-market",
    name: "Night Market",
    parent: "market-square",
    summary: "Food stalls under strung lights, open from late afternoon.",
  },
  {
    id: "courier-office",
    name: "Courier Office",
    parent: "market-square",
    summary: "Sorting tables and pigeonholes; the counter closes at six.",
  },
  {
    id: "clocktower",
    name: "Clocktower Workshop",
    parent: "old-town",
    summary: "Gears, oil and a long workbench under the clock face.",
    entry: 3,
  },
  {
    id: "archive",
    name: "Archive",
    parent: "old-town",
    summary: "Stacks of ledgers and maps; quiet voices only.",
    entry: 2,
  },
  {
    id: "reading-room",
    name: "Reading Room",
    parent: "archive",
    summary: "Long tables and green lamps; members sign in at the door.",
  },
  {
    id: "riverside",
    name: "Riverside",
    summary: "Embankment path along the water, windy in the evenings.",
    connections: [{ to: "residences", ways: [{ by: "walk", minutes: 6 }] }],
  },
  {
    id: "harbor",
    name: "Harbor",
    parent: "riverside",
    summary: "Moored boats, rope and crates; the watch keeps an eye on it.",
    entry: 3,
  },
  {
    id: "watch-house",
    name: "Watch House",
    parent: "harbor",
    summary: "Lookout post with a logbook; always someone on shift.",
  },
  {
    id: "river-clinic",
    name: "River Clinic",
    parent: "riverside",
    summary: "Whitewashed rooms and a waiting bench; open around the clock.",
    entry: 2,
  },
  {
    id: "lantern-theatre",
    name: "Lantern Theatre",
    parent: "riverside",
    summary: "Small stage and creaky seats; rehearsals most afternoons.",
    entry: 2,
  },
  {
    id: "the-hill",
    name: "The Hill",
    summary: "Steep streets up to the academy and the observatory.",
    connections: [{ to: "residences", ways: [{ by: "walk", minutes: 10 }] }],
  },
  {
    id: "academy",
    name: "Academy",
    parent: "the-hill",
    summary: "Stone halls around a courtyard; gates lock at ten.",
    entry: 3,
  },
  {
    id: "lecture-hall",
    name: "Lecture Hall",
    parent: "academy",
    summary: "Tiered benches facing a chalkboard.",
  },
  {
    id: "library",
    name: "Library",
    parent: "academy",
    summary: "Two floors of shelves and window seats.",
  },
  {
    id: "observatory",
    name: "Observatory",
    parent: "the-hill",
    summary: "Domed roof at the top of the hill; busiest after dark.",
    entry: 5,
  },
  {
    id: "botanical-garden",
    name: "Botanical Garden",
    parent: "the-hill",
    summary: "Terraced beds and gravel paths.",
    entry: 4,
  },
  {
    id: "glasshouse",
    name: "Glasshouse",
    parent: "botanical-garden",
    summary: "Warm, humid and green; the door sticks.",
  },
  {
    id: "residences",
    name: "Residences",
    summary: "Rows of narrow houses between the river and the hill.",
  },
  {
    id: "north-row",
    name: "North Row",
    parent: "residences",
    summary: "Terraced houses with window boxes.",
    entry: 2,
  },
  {
    id: "south-row",
    name: "South Row",
    parent: "residences",
    summary: "Older houses facing the river path.",
    entry: 2,
  },
  {
    id: "boarding-house",
    name: "Boarding House",
    parent: "residences",
    summary: "Shared kitchen downstairs, rooms up three flights.",
    entry: 1,
  },
];

export const MOCK_PLACES: readonly Place[] = SEEDS.map((seed) => ({
  id: seed.id,
  name: seed.name,
  aliases: [],
  ...(seed.parent ? { parent: seed.parent } : {}),
  summary: seed.summary,
  entryMinutes: seed.entry ?? 1,
  connections: seed.connections ?? [],
  bodyMarkdown: `# ${seed.name}\n\n${seed.summary} Placeholder description from the mock world; the real one comes from the World Wiki.`,
}));

export const MOCK_HOMES = ["north-row", "south-row", "boarding-house"] as const;

/** Where each mock affiliation spends its working hours. */
export const MOCK_WORKPLACES: Readonly<Record<string, string>> = {
  "Archive Society": "archive",
  "Harbor Watch": "watch-house",
  "Botanical Circle": "glasshouse",
  "Clocktower Workshop": "clocktower",
  "River Clinic": "river-clinic",
  "Lantern Theatre": "lantern-theatre",
  Observatory: "observatory",
  "Night Market": "night-market",
  "Courier Office": "courier-office",
  Academy: "lecture-hall",
};

/**
 * Where a mock activity of each category tends to happen, if not at home or
 * work.
 */
export const MOCK_HANGOUTS: Readonly<Record<string, readonly string[]>> = {
  eating: ["night-market", "market-square", "boarding-house"],
  studying: ["library", "reading-room"],
  socializing: [
    "market-square",
    "riverside",
    "lantern-theatre",
    "botanical-garden",
  ],
  "having fun": ["lantern-theatre", "riverside", "botanical-garden", "harbor"],
  traveling: ["old-town", "riverside", "the-hill", "harbor", "market-square"],
};

type Edge = { to: string; minutes: number };

const EDGES: ReadonlyMap<string, readonly Edge[]> = (() => {
  const edges = new Map<string, Edge[]>();
  const link = (a: string, b: string, minutes: number) => {
    edges.set(a, [...(edges.get(a) ?? []), { to: b, minutes }]);
    edges.set(b, [...(edges.get(b) ?? []), { to: a, minutes }]);
  };
  for (const place of MOCK_PLACES) {
    if (place.parent) link(place.id, place.parent, place.entryMinutes);
    for (const connection of place.connections) {
      link(place.id, connection.to, connection.ways[0].minutes);
    }
  }
  return edges;
})();

/**
 * The usual route (Dijkstra on usual minutes), origin first, with cumulative
 * minutes.
 */
export function mockRoute(from: string, to: string) {
  const distance = new Map<string, number>([[from, 0]]);
  const previous = new Map<string, string>();
  const done = new Set<string>();
  for (;;) {
    let next: string | undefined;
    for (const [id, minutes] of distance) {
      if (done.has(id)) continue;
      if (next === undefined || minutes < distance.get(next)!) next = id;
    }
    if (next === undefined || next === to) break;
    done.add(next);
    for (const edge of EDGES.get(next) ?? []) {
      const minutes = distance.get(next)! + edge.minutes;
      if (minutes < (distance.get(edge.to) ?? Infinity)) {
        distance.set(edge.to, minutes);
        previous.set(edge.to, next);
      }
    }
  }
  const path = [to];
  for (let at = to; at !== from;) {
    const step = previous.get(at);
    if (step === undefined) return undefined;
    path.unshift(step);
    at = step;
  }
  return {
    stops: path.map((placeId) => ({
      placeId,
      minutes: distance.get(placeId)!,
    })),
    minutes: distance.get(to)!,
  };
}

/**
 * A trip record from where someone stands. `arriveAt` absent walks at the usual
 * pace (a walk over, with `purpose`); present, the trip is the activity.
 */
export function mockTrip(params: {
  readonly from: string;
  readonly to: string;
  readonly taskId: string;
  readonly departAt: number;
  readonly arriveAt?: number;
  readonly purpose?: { readonly description: string; readonly minutes: number };
}): LocationRecord | undefined {
  const route = mockRoute(params.from, params.to);
  if (!route || route.minutes === 0) return undefined;
  const arriveAt = params.arriveAt ?? params.departAt + route.minutes * MINUTE;
  const span = arriveAt - params.departAt;
  return {
    placeId: params.from,
    since: params.departAt,
    trip: {
      taskId: params.taskId,
      ...(params.purpose ? { purpose: { ...params.purpose } } : {}),
      to: params.to,
      departAt: params.departAt,
      arriveAt,
      legs: route.stops.map((stop, index) => ({
        placeId: stop.placeId,
        at:
          index === route.stops.length - 1
            ? arriveAt
            : params.departAt +
              Math.round((span * stop.minutes) / route.minutes),
      })),
      usualMinutes: route.minutes,
    },
  };
}
