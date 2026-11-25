import type { LocationRecord, Place } from "@kazusa/client";
import { describe, expect, it } from "vitest";
import {
  computeMapGeometry,
  type MapGeometry,
  type MapNode,
} from "./map-layout";
import {
  computeRegions,
  computeReveal,
  curveBetween,
  edgesAt,
  markerFor,
  planLabels,
  pointOnCurve,
  revealAt,
  REVEAL_STEP,
  roadPath,
  routeStops,
  travelerPoint,
} from "./map-view";
import { buildPlaceIndex } from "./places";

function place(
  id: string,
  parent?: string,
  connections: Record<string, number> = {},
): Place {
  return {
    id,
    name: id,
    aliases: [],
    ...(parent ? { parent } : {}),
    summary: "",
    entryMinutes: 2,
    connections: Object.entries(connections).map(([to, minutes]) => ({
      to,
      ways: [{ by: "walk", minutes }],
    })),
    bodyMarkdown: "",
  };
}

const geometry = computeMapGeometry(
  buildPlaceIndex([
    place("town", undefined, { port: 30 }),
    place("square", "town", { market: 1, dock: 9 }),
    place("market", "town", { dock: 20 }),
    place("port"),
    place("dock", "port"),
    place("ferry", "port"),
  ]),
  {},
);
const reveal = computeReveal(geometry);

describe("reveal", () => {
  it("shows an area's inside only after the area itself", () => {
    expect(reveal.get("town")).toBe(0);
    expect(reveal.get("square")).toBeGreaterThan(0);
  });

  it("stands a hidden place in for its area", () => {
    expect(markerFor(geometry, reveal, "square", 0.001)).toBe("town");
    expect(markerFor(geometry, reveal, "square", 5)).toBe("square");
  });
});

describe("revealAt", () => {
  const shownAt = (zoom: number, options = {}) => {
    const at = revealAt(geometry, { zoom, ...options });
    return new Set([...geometry.nodes.keys()].filter((id) => at.get(id) === 0));
  };

  it("always shows the top of the map, and an area's inside once it has room", () => {
    expect(shownAt(0.0001)).toEqual(new Set(["town", "port"]));
    expect(shownAt(5)).toEqual(new Set(geometry.nodes.keys()));
  });

  it("opens an area as soon as one place inside it fits", () => {
    const opened = [0.02, 0.05, 0.1, 0.2, 0.5, 1].map((zoom) => {
      const at = revealAt(geometry, { zoom });
      return at.get("open:town") === 0;
    });
    expect(opened).toContain(true);
    expect(opened[0]).toBe(false);
  });

  it("lets the busiest place in first when only one fits", () => {
    const first = [0.02, 0.05, 0.1, 0.2, 0.5]
      .map((zoom) =>
        shownAt(zoom, { weight: (id: string) => (id === "market" ? 9 : 0) }),
      )
      .find((busy) => busy.has("square") || busy.has("market"));
    expect(first?.has("market")).toBe(true);
  });

  it("keeps a place out when its whole name has no room", () => {
    const tight = shownAt(1, { nameWidth: () => 10_000 });
    expect(tight.has("square") && tight.has("market")).toBe(false);
  });

  it("never takes back a place as you zoom in", () => {
    // "quiet" shows once the west opens; later the east opens and its busier
    // "busy" would claim the same spot, before both fit further in.
    const node = (
      id: string,
      x: number,
      radius: number,
      parent?: string,
    ): MapNode => ({
      id,
      x,
      y: 0,
      radius,
      isArea: radius > 100,
      depth: parent ? (parent === "city" ? 1 : 2) : 0,
      ...(parent ? { parent } : {}),
    });
    const nodes = [
      node("city", -9000, 3000),
      node("west", -2000, 600, "city"),
      node("east", 2000, 200, "city"),
      node("quiet", 0, 40, "west"),
      node("busy", 50, 40, "east"),
    ];
    const crowded: MapGeometry = {
      nodes: new Map(nodes.map((n) => [n.id, n])),
      order: nodes.map((n) => n.id),
      coordinates: {},
      edges: [],
    };
    const weight = (id: string) => (id === "busy" ? 9 : 0);
    const shown = (zoom: number) =>
      revealAt(crowded, { zoom, weight }).get("quiet") === 0;
    const steps = Array.from({ length: 30 }, (_, k) => REVEAL_STEP ** (k - 20));
    const first = steps.findIndex(shown);
    expect(first).toBeGreaterThan(-1);
    for (const zoom of steps.slice(first))
      expect(shown(zoom), `at ${zoom}`).toBe(true);
  });

  it("shows a pinned place and the areas around it, whatever the room", () => {
    expect(shownAt(0.0001, { pinned: ["dock"] })).toEqual(
      new Set(["town", "port", "dock"]),
    );
  });
});

describe("planLabels", () => {
  const plan = (zoom: number, people: Record<string, number> = {}) =>
    planLabels({
      geometry,
      regions: computeRegions(geometry),
      reveal,
      edges: edgesAt(geometry, reveal, zoom),
      zoom,
      nameOf: (id) => id,
      peopleAt: (id) => people[id] ?? 0,
      maxAvatars: 4,
    });

  it("names areas first when zoomed out, and never on top of each other", () => {
    const far = plan(0.2);
    expect([...far.areaNames.keys()].sort()).toEqual(["port", "town"]);
    expect(plan(0.001).areaNames.size).toBeLessThanOrEqual(1);
  });

  it("writes everything once there's room", () => {
    const near = plan(5);
    expect(near.names).toEqual(new Set(["square", "market", "dock", "ferry"]));
    expect(near.times.size).toBeGreaterThan(0);
  });

  it("reduces a crowd that won't fit to a count", () => {
    const crowded = plan(0.01, { town: 30, port: 2 });
    expect(crowded.avatars.get("town")).toBeLessThanOrEqual(4);
    expect(crowded.avatars.has("port")).toBe(true);
  });
});

describe("edgesAt", () => {
  it("merges roads between closed areas and drops those inside them", () => {
    const far = edgesAt(geometry, reveal, 0.001);
    expect(far).toHaveLength(1);
    expect(far[0]).toMatchObject({ exact: false, minutes: 9 });
    expect(new Set([far[0].from, far[0].to])).toEqual(
      new Set(["town", "port"]),
    );
  });

  it("draws every road once zoomed in", () => {
    const near = edgesAt(geometry, reveal, 5);
    expect(near.map((edge) => edge.exact)).toEqual(near.map(() => true));
    expect(near).toHaveLength(geometry.edges.length);
  });
});

describe("computeRegions", () => {
  it("makes one closed region per area, parents first", () => {
    const regions = computeRegions(geometry);
    expect(regions.map((region) => region.id).sort()).toEqual(["port", "town"]);
    for (const region of regions) expect(region.path.endsWith("Z")).toBe(true);
  });
});

describe("travelers", () => {
  const record: LocationRecord = {
    placeId: "square",
    since: 0,
    trip: {
      to: "dock",
      departAt: 100,
      arriveAt: 300,
      legs: [{ placeId: "market", at: 200 }],
    },
  } as unknown as LocationRecord;

  it("lists a trip's stops in order", () => {
    expect(routeStops(record)).toEqual(["square", "market", "dock"]);
  });

  it("puts a traveler on the road between stops", () => {
    const a = geometry.nodes.get("square")!;
    const b = geometry.nodes.get("market")!;
    const mid = travelerPoint(record, 150, geometry)!;
    const expected = pointOnCurve(curveBetween(a, b), 0.5);
    expect(mid.x).toBeCloseTo(expected.x);
    expect(mid.y).toBeCloseTo(expected.y);
    expect(travelerPoint(record, 50, geometry)).toBeUndefined();
    expect(travelerPoint(record, 400, geometry)).toBeUndefined();
  });
});

describe("roadPath", () => {
  it("draws the same curve from whichever end it starts", () => {
    const a = { id: "a", x: 0, y: 0 };
    const b = { id: "b", x: 100, y: 0 };
    expect(roadPath(a, b)).toMatch(/^M0\.0 0\.0Q.* 100\.0 0\.0$/);
    expect(roadPath(b, a)).toMatch(/^M100\.0 0\.0Q.* 0\.0 0\.0$/);
    const control = (path: string) => path.split("Q")[1].split(" ").slice(0, 2);
    expect(control(roadPath(a, b))).toEqual(control(roadPath(b, a)));
  });
});
