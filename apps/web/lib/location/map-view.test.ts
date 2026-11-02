import type { LocationRecord, Place } from "@kazusa/client";
import { describe, expect, it } from "vitest";
import { computeMapGeometry } from "./map-layout";
import {
  computeRegions,
  computeReveal,
  curveBetween,
  edgesAt,
  markerFor,
  planLabels,
  pointOnCurve,
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
