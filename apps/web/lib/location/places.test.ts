import { describe, expect, it } from "vitest";
import type { LocationRecord, Place } from "@kazusa/client";
import {
  ancestors,
  buildPlaceIndex,
  connectionsOf,
  describeWay,
  headingTo,
  isWithin,
  occupancy,
  peopleWithin,
  positionAt,
} from "./places";

const place = (
  id: string,
  parent?: string,
  connections: Place["connections"] = [],
): Place => ({
  id,
  name: id.toUpperCase(),
  aliases: [],
  ...(parent ? { parent } : {}),
  summary: "",
  entryMinutes: 1,
  connections,
  bodyMarkdown: "",
});

const index = buildPlaceIndex([
  place("town", undefined, [
    { to: "hill", ways: [{ by: "walk", minutes: 12 }] },
  ]),
  place("square", "town"),
  place("cafe", "square"),
  place("hill"),
  place("tower", "hill"),
]);

const trip = (
  from: string,
  legs: [string, number][],
  extra: Partial<NonNullable<LocationRecord["trip"]>> = {},
): LocationRecord => ({
  placeId: from,
  since: 0,
  trip: {
    taskId: "t1",
    to: legs.at(-1)![0],
    departAt: legs[0][1],
    arriveAt: legs.at(-1)![1],
    legs: legs.map(([placeId, at]) => ({ placeId, at })),
    usualMinutes: 10,
    ...extra,
  },
});

describe("place tree", () => {
  it("indexes depth, children and ancestors", () => {
    expect(index.depth.get("town")).toBe(0);
    expect(index.depth.get("cafe")).toBe(2);
    expect(index.children.get("town")).toEqual(["square"]);
    expect(ancestors(index, "cafe")).toEqual(["square", "town"]);
    expect(isWithin(index, "cafe", "town")).toBe(true);
    expect(isWithin(index, "tower", "town")).toBe(false);
  });

  it("survives a parent cycle without looping", () => {
    const looped = buildPlaceIndex([place("a", "b"), place("b", "a")]);
    expect(ancestors(looped, "a")).toEqual(["b"]);
  });

  it("lists connections declared from either end", () => {
    expect(connectionsOf(index, "hill").map(({ to }) => to)).toEqual(["town"]);
    expect(connectionsOf(index, "town").map(({ to }) => to)).toEqual(["hill"]);
    expect(describeWay({ by: "walk", minutes: 3 })).toBe("3 min on foot");
    expect(describeWay({ by: "bike", minutes: 2.4 })).toBe("2 min by bike");
  });
});

describe("positionAt", () => {
  const record = trip("cafe", [
    ["cafe", 100],
    ["square", 200],
    ["town", 300],
    ["hill", 1000],
  ]);

  it("is at the origin before departing and at the destination after", () => {
    expect(positionAt(record, 50)).toEqual({
      kind: "at",
      placeId: "cafe",
      since: 0,
    });
    expect(positionAt(record, 1000)).toEqual({
      kind: "at",
      placeId: "hill",
      since: 1000,
    });
  });

  it("is near the closest route place in time while traveling", () => {
    const position = positionAt(record, 320);
    expect(position.kind).toBe("traveling");
    if (position.kind !== "traveling") return;
    expect(position.near).toBe("town");
    expect(position.passed).toBe("town");
    expect(position.next).toBe("hill");
    expect(position.from).toBe("cafe");
  });
});

describe("occupancy", () => {
  const records = new Map<string, LocationRecord>([
    ["ada", { placeId: "cafe", since: 0 }],
    ["bram", { placeId: "square", since: 0 }],
    [
      "cleo",
      trip("tower", [
        ["tower", 0],
        ["hill", 50],
        ["town", 500],
      ]),
    ],
  ]);
  const ids = ["ada", "bram", "cleo", "dario"];

  it("buckets people at places, on the way, and unplaced", () => {
    const now = occupancy(ids, (id) => records.get(id), 100);
    expect(now.at.get("cafe")).toEqual(["ada"]);
    expect(now.traveling).toEqual(["cleo"]);
    expect(now.unplaced).toEqual(["dario"]);
    expect(peopleWithin(index, now, "town")).toEqual(["bram", "ada"]);
  });

  it("puts finished trips at their destination", () => {
    const later = occupancy(ids, (id) => records.get(id), 600);
    expect(later.at.get("town")).toEqual(["cleo"]);
    expect(later.traveling).toEqual([]);
  });

  it("lists who is heading somewhere, soonest first", () => {
    expect(headingTo(ids, (id) => records.get(id), "town", 100)).toEqual([
      { id: "cleo", arriveAt: 500 },
    ]);
    expect(headingTo(ids, (id) => records.get(id), "town", 600)).toEqual([]);
  });
});
