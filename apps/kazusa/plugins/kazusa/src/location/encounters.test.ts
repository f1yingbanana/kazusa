import { describe, expect, it } from "vitest";
import { crossings } from "./encounters.ts";
import type { LocationRecord } from "./location.ts";

const T0 = Date.parse("2026-10-27T16:00:00.000Z");
const minutes = (n: number): number => T0 + n * 60_000;

/** Dorm → grounds (5) → gate (8) → street (12). */
const kazusa: LocationRecord = {
  placeId: "dorm",
  since: T0,
  trip: {
    taskId: "t1",
    to: "street",
    departAt: T0,
    arriveAt: minutes(12),
    legs: [
      { placeId: "dorm", at: T0 },
      { placeId: "grounds", at: minutes(5) },
      { placeId: "gate", at: minutes(8) },
      { placeId: "street", at: minutes(12) },
    ],
    usualMinutes: 12,
  },
};

describe("crossings", () => {
  it("finds someone standing where a trip passes, both ways round", () => {
    const natsu: LocationRecord = { placeId: "grounds", since: T0 };
    expect(
      crossings(
        { id: "kazusa", record: kazusa },
        { id: "yutori-natsu", record: natsu },
        T0,
        2 * 60_000,
      ),
    ).toEqual([
      {
        observer: "kazusa",
        subject: "yutori-natsu",
        placeId: "grounds",
        at: minutes(5),
      },
      {
        observer: "yutori-natsu",
        subject: "kazusa",
        placeId: "grounds",
        at: minutes(5),
      },
    ]);
  });

  it("finds two trips passing the same place close in time, and only then", () => {
    // Yoshimi comes out of the library through the gate, the way Kazusa goes.
    const trip = (gateAt: number): LocationRecord => ({
      placeId: "library",
      since: T0,
      trip: {
        taskId: "t2",
        to: "street",
        departAt: T0,
        arriveAt: gateAt + 4 * 60_000,
        legs: [
          { placeId: "library", at: T0 },
          { placeId: "gate", at: gateAt },
          { placeId: "street", at: gateAt + 4 * 60_000 },
        ],
        usualMinutes: 13,
      },
    });
    const near = crossings(
      { id: "kazusa", record: kazusa },
      { id: "yoshimi", record: trip(minutes(9)) },
      T0,
      2 * 60_000,
    );
    expect(near).toHaveLength(2);
    expect(near[0]).toMatchObject({
      placeId: "gate",
      at: minutes(9),
    });
    expect(
      crossings(
        { id: "kazusa", record: kazusa },
        { id: "yoshimi", record: trip(minutes(15)) },
        T0,
        2 * 60_000,
      ),
    ).toEqual([]);
  });

  it("ignores moments already past, and the trip's own start and end", () => {
    const atStreet: LocationRecord = { placeId: "street", since: T0 };
    expect(
      crossings(
        { id: "kazusa", record: kazusa },
        { id: "yoshimi", record: { placeId: "grounds", since: T0 } },
        minutes(6),
        2 * 60_000,
      ),
    ).toEqual([]);
    expect(
      crossings(
        { id: "kazusa", record: kazusa },
        { id: "yoshimi", record: atStreet },
        T0,
        2 * 60_000,
      ),
    ).toEqual([]);
  });

  it("finds people meeting head-on along one stretch, nearer one end", () => {
    // Grounds → dorm in 10, while Kazusa walks dorm → grounds in 5.
    const airi: LocationRecord = {
      placeId: "grounds",
      since: T0,
      trip: {
        taskId: "t2",
        to: "dorm",
        departAt: T0,
        arriveAt: minutes(10),
        legs: [
          { placeId: "grounds", at: T0 },
          { placeId: "dorm", at: minutes(10) },
        ],
        usualMinutes: 10,
      },
    };
    // Shares 1/5 + 1/10 a minute: they meet at 3⅓ min, ⅔ of Kazusa's way.
    const at = T0 + Math.round((10 / 3) * 60_000);
    expect(
      crossings(
        { id: "kazusa", record: kazusa },
        { id: "kurimura-airi", record: airi },
        T0,
        2 * 60_000,
      ),
    ).toEqual([
      {
        observer: "kazusa",
        subject: "kurimura-airi",
        placeId: "grounds",
        at,
        between: "dorm",
      },
      {
        observer: "kurimura-airi",
        subject: "kazusa",
        placeId: "grounds",
        at,
        between: "dorm",
      },
    ]);
    // Already past each other, or never on the stretch together: nothing.
    expect(
      crossings(
        { id: "kazusa", record: kazusa },
        { id: "kurimura-airi", record: airi },
        at + 1,
        2 * 60_000,
      ),
    ).toEqual([]);
    const late: LocationRecord = {
      ...airi,
      trip: {
        ...airi.trip!,
        departAt: minutes(6),
        arriveAt: minutes(16),
        legs: [
          { placeId: "grounds", at: minutes(6) },
          { placeId: "dorm", at: minutes(16) },
        ],
      },
    };
    // (She is still standing on the grounds when Kazusa passes: that one is
    // an ordinary crossing.)
    expect(
      crossings(
        { id: "kazusa", record: kazusa },
        { id: "kurimura-airi", record: late },
        T0,
        2 * 60_000,
      ).filter(({ between }) => between !== undefined),
    ).toEqual([]);
  });

  it("does not also count a head-on meeting as passing the same place", () => {
    // Airi comes gate → grounds (4.5–6) → dorm (16) as Kazusa walks grounds
    // (5) → gate (8): both pass the grounds a minute apart, but they met.
    const airi: LocationRecord = {
      placeId: "gate",
      since: T0,
      trip: {
        taskId: "t2",
        to: "dorm",
        departAt: minutes(4.5),
        arriveAt: minutes(16),
        legs: [
          { placeId: "gate", at: minutes(4.5) },
          { placeId: "grounds", at: minutes(6) },
          { placeId: "dorm", at: minutes(16) },
        ],
        usualMinutes: 11.5,
      },
    };
    const found = crossings(
      { id: "kazusa", record: kazusa },
      { id: "kurimura-airi", record: airi },
      T0,
      2 * 60_000,
    );
    expect(found).toHaveLength(2);
    expect(found.every(({ between }) => between === "gate")).toBe(true);
    expect(found[0]).toMatchObject({ placeId: "grounds" });
  });
});
