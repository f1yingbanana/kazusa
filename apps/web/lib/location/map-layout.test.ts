import type { Place } from "@kazusa/client";
import { describe, expect, it } from "vitest";
import { buildPlaceIndex } from "./places";
import {
  PLACE_RADIUS,
  collectEdges,
  MAP_SCALE,
  computeMapGeometry,
  positionsToSave,
  shiftPlace,
  type MapNode,
} from "./map-layout";

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

const distance = (a: MapNode, b: MapNode) => Math.hypot(a.x - b.x, a.y - b.y);

const world = buildPlaceIndex([
  place("town", undefined, { port: 30, keep: 4 }),
  place("square", "town", { market: 1 }),
  place("market", "town", { dock: 20 }),
  place("keep"),
  place("port"),
  place("dock", "port"),
  place("ferry", "port"),
  place("island"),
]);

function expectNoOverlap(nodes: readonly MapNode[]) {
  for (const a of nodes) {
    for (const b of nodes) {
      if (a.id >= b.id) continue;
      expect(distance(a, b)).toBeGreaterThanOrEqual(a.radius + b.radius);
    }
  }
}

describe("computeMapGeometry", () => {
  it("comes out the same every time", () => {
    const one = computeMapGeometry(world, {});
    const two = computeMapGeometry(world, {});
    expect(one.coordinates).toEqual(two.coordinates);
  });

  it("keeps siblings apart at every level and children inside their area", () => {
    const { nodes } = computeMapGeometry(world, {});
    const all = [...nodes.values()];
    expectNoOverlap(all.filter((node) => node.depth === 0));
    expectNoOverlap(all.filter((node) => node.parent === "town"));
    for (const node of all) {
      if (!node.parent) continue;
      const area = nodes.get(node.parent)!;
      expect(distance(node, area) + node.radius).toBeLessThanOrEqual(
        area.radius,
      );
    }
  });

  it("draws shorter trips shorter when nothing says where places are", () => {
    const { nodes } = computeMapGeometry(world, {});
    expect(distance(nodes.get("town")!, nodes.get("keep")!)).toBeLessThan(
      distance(nodes.get("town")!, nodes.get("port")!),
    );
  });

  it("puts places at their coordinates when they have room", () => {
    const { nodes } = computeMapGeometry(world, {
      keep: { x: 0.9, y: 0.1 },
      island: { x: 0.1, y: 0.8 },
    });
    expect(nodes.get("keep")).toMatchObject({
      x: 0.9 * MAP_SCALE,
      y: 0.1 * MAP_SCALE,
    });
    expect(nodes.get("island")).toMatchObject({
      x: 0.1 * MAP_SCALE,
      y: 0.8 * MAP_SCALE,
    });
  });

  it("spreads places that share a coordinate, and solves the rest around them", () => {
    const { nodes } = computeMapGeometry(world, {
      keep: { x: 0.5, y: 0.5 },
      island: { x: 0.5, y: 0.5 },
    });
    expectNoOverlap([...nodes.values()].filter((node) => node.depth === 0));
    expect(nodes.get("town")).toBeDefined();
  });

  it("places an area without a coordinate amid the places inside it", () => {
    const { nodes } = computeMapGeometry(world, {
      dock: { x: 0.3, y: 0.3 },
      ferry: { x: 0.5, y: 0.3 },
    });
    const port = nodes.get("port")!;
    expect(port.x).toBeCloseTo(0.4 * MAP_SCALE, 0);
    expect(port.y).toBeCloseTo(0.3 * MAP_SCALE, 0);
    expect(nodes.get("ferry")!.x - nodes.get("dock")!.x).toBeCloseTo(
      0.2 * MAP_SCALE,
      0,
    );
  });

  it("brings back an arranged layout exactly", () => {
    const first = computeMapGeometry(world, {});
    const again = computeMapGeometry(world, first.coordinates);
    for (const [id, node] of first.nodes) {
      expect(again.nodes.get(id)!.x).toBeCloseTo(node.x, 4);
      expect(again.nodes.get(id)!.y).toBeCloseTo(node.y, 4);
    }
  });

  it("copes with loops, missing parents, a road to its own area and no roads", () => {
    const odd = buildPlaceIndex([
      place("a", "b"),
      place("b", "a"),
      place("orphan", "nowhere"),
      place("hall", undefined, { room: 1 }),
      place("room", "hall"),
      ...Array.from({ length: 40 }, (_, i) => place(`p${i}`)),
    ]);
    const { nodes, edges } = computeMapGeometry(odd, {});
    expect(nodes.size).toBe(odd.places.length);
    expect(edges).toHaveLength(1);
    for (const node of nodes.values()) {
      expect(Number.isFinite(node.x) && Number.isFinite(node.y)).toBe(true);
    }
    expectNoOverlap([...nodes.values()].filter((node) => node.depth === 0));
  });

  it("keeps an empty map empty", () => {
    expect(computeMapGeometry(buildPlaceIndex([]), {}).nodes.size).toBe(0);
  });
});

describe("collectEdges", () => {
  it("merges a road declared from both ends, keeping the quicker", () => {
    const edges = collectEdges([
      place("a", undefined, { b: 9, ghost: 1, a: 1 }),
      place("b", undefined, { a: 5 }),
    ]);
    expect(edges).toEqual([{ a: "a", b: "b", minutes: 5, by: "walk" }]);
  });
});

describe("moving a place", () => {
  const start = computeMapGeometry(world, {});

  it("takes everything inside along", () => {
    const moved = shiftPlace(start, start.coordinates, "town", 0.5, 0);
    expect(moved.town.x).toBeCloseTo(start.coordinates.town.x + 0.5);
    expect(moved.square.x).toBeCloseTo(start.coordinates.square.x + 0.5);
    expect(moved.keep).toEqual(start.coordinates.keep);
  });

  it("stays where it was dropped while others make room", () => {
    const town = start.coordinates.town;
    const onTop = { ...start.coordinates, keep: { x: town.x, y: town.y } };
    const next = computeMapGeometry(world, onTop, "keep");
    expect(next.coordinates.keep.x).toBeCloseTo(town.x);
    expect(next.coordinates.keep.y).toBeCloseTo(town.y);
    expectNoOverlap([...next.nodes.values()].filter((n) => n.depth === 0));
    // And it holds on a fresh load, with nothing held.
    const reload = computeMapGeometry(world, next.coordinates);
    expect(reload.coordinates.keep.x).toBeCloseTo(town.x);
  });

  it("grows the area around a sub-place dragged far away", () => {
    const far = {
      ...start.coordinates,
      square: { x: start.coordinates.town.x + 0.4, y: 0 },
    };
    const next = computeMapGeometry(world, far, "square");
    expect(next.nodes.get("town")!.radius).toBeGreaterThan(0.3 * MAP_SCALE);
    expect(next.nodes.get("square")!.radius).toBe(PLACE_RADIUS);
    expectNoOverlap([...next.nodes.values()].filter((n) => n.depth === 0));
  });
});

describe("positionsToSave", () => {
  const start = computeMapGeometry(world, {});
  const moved = (id: string, dx: number) =>
    computeMapGeometry(
      world,
      shiftPlace(start, start.coordinates, id, dx, 0),
      id,
    );

  it("writes nothing when nothing moved", () => {
    expect(
      positionsToSave({
        geometry: start,
        before: start.coordinates,
        stored: {},
      }),
    ).toEqual({});
  });

  it("writes a sub-place's area-mates and the levels above, not other areas' insides", () => {
    // A small step that doesn't grow the area, so nothing above it moves.
    const { square, town } = start.coordinates;
    const saved = positionsToSave({
      geometry: moved("square", (town.x - square.x) * 0.02),
      before: start.coordinates,
      stored: {},
    });
    expect(Object.keys(saved)).toEqual(
      expect.arrayContaining(["square", "market", "town", "port", "keep"]),
    );
    expect(saved).not.toHaveProperty("dock");
    expect(saved).not.toHaveProperty("ferry");
  });

  it("includes what's inside a moved area", () => {
    const saved = positionsToSave({
      geometry: moved("port", 0.5),
      before: start.coordinates,
      stored: {},
    });
    expect(saved).toHaveProperty("dock");
    expect(saved).toHaveProperty("ferry");
    expect(saved).not.toHaveProperty("square");
  });

  it("skips pages already saying the right thing", () => {
    const geometry = moved("keep", 0.5);
    const saved = positionsToSave({
      geometry,
      before: start.coordinates,
      stored: { island: geometry.coordinates.island },
    });
    expect(saved).not.toHaveProperty("island");
    expect(saved).toHaveProperty("keep");
  });

  it("comes back the same after saving and reloading", () => {
    const geometry = moved("keep", 0.5);
    const saved = positionsToSave({
      geometry,
      before: start.coordinates,
      stored: {},
    });
    const reload = computeMapGeometry(world, saved);
    for (const id of Object.keys(saved)) {
      expect(reload.coordinates[id].x).toBeCloseTo(
        geometry.coordinates[id].x,
        3,
      );
    }
  });
});
