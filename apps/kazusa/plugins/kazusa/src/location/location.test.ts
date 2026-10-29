import { describe, expect, it } from "vitest";
import type { ActiveTask } from "../taskman/types.ts";
import {
  arrive,
  planDelay,
  planStart,
  positionAt,
  renderWhereabouts,
  type LocationRecord,
} from "./location.ts";
import { buildMap, type Place } from "./map.ts";

const T0 = Date.parse("2026-10-27T16:00:00.000Z");
const minutes = (n: number): number => T0 + n * 60_000;

function place(id: string, extra: Partial<Omit<Place, "id">> = {}): Place {
  return {
    id,
    name: id[0].toUpperCase() + id.slice(1),
    aliases: [],
    summary: `The ${id}.`,
    entryMinutes: 1,
    connections: [],
    bodyMarkdown: "",
    ...extra,
  };
}

/** Club › annex › school ═10 min walk═ dorm › room (private to kazusa). */
const map = buildMap([
  place("school", {
    connections: [{ to: "dorm", ways: [{ by: "walk", minutes: 10 }] }],
  }),
  place("annex", { parent: "school", entryMinutes: 2 }),
  place("club", { parent: "annex" }),
  place("dorm"),
  place("room", { parent: "dorm" }),
]);

function task(duration: number, extra: Partial<ActiveTask> = {}): ActiveTask {
  return {
    id: "task-1",
    type: "traveling",
    description: "Heading out",
    startedAt: new Date(T0).toISOString(),
    endAt: new Date(minutes(duration)).toISOString(),
    duration,
    ...extra,
  };
}

const atClub: LocationRecord = { placeId: "club", since: minutes(-60) };

const start = (
  overrides: Partial<Parameters<typeof planStart>[0]> = {},
): ReturnType<typeof planStart> =>
  planStart({
    map,
    record: atClub,
    at: T0,
    task: task(26),
    where: "dorm",
    travel: true,
    ...overrides,
  });

describe("location", () => {
  it("scales a trip's usual legs to its duration and arrives at its end", async () => {
    // club → annex 1 → school 2 → dorm 10: 13 usual minutes, taken in 26.
    const move = await start();
    expect(move.record?.trip).toMatchObject({ to: "dorm" });
    // The trip is the activity, so it has no separate purpose or check-in.
    expect(move.record?.trip?.purpose).toBeUndefined();
    expect(move.checkInAt).toBeUndefined();
    expect(move.record?.trip?.legs).toEqual([
      { placeId: "club", at: T0 },
      { placeId: "annex", at: minutes(2) },
      { placeId: "school", at: minutes(6) },
      { placeId: "dorm", at: minutes(26) },
    ]);
    expect(move.note).toBe(
      "Traveling from Club to Dorm (usually 13 min); arriving Tue 2026-10-27 16:26.",
    );
    expect(move.payload).toEqual({
      where: "dorm",
      from: "club",
      arriveAt: minutes(26),
      usualMinutes: 13,
    });

    const record = move.record!;
    expect(positionAt(record, minutes(1.5))).toMatchObject({
      kind: "traveling",
      near: "annex",
    });
    expect(positionAt(record, minutes(26))).toEqual({
      kind: "at",
      placeId: "dorm",
      since: minutes(26),
    });
    expect(arrive(map, record, minutes(25))).toBeUndefined();
    expect(arrive(map, record, minutes(26))).toEqual({
      record: { placeId: "dorm", since: minutes(26) },
      note: "You've arrived at Dorm `dorm`.",
    });
  });

  it("walks over at the usual pace for an activity somewhere else", async () => {
    const move = await start({
      task: task(60, { type: "eating" }),
      travel: false,
    });
    expect(move.record?.trip).toMatchObject({
      arriveAt: minutes(13),
      purpose: { description: "Heading out", minutes: 47 },
    });
    // The lease checks in on arrival: its one wake is the arrival.
    expect(move.checkInAt).toBe(minutes(13));
    expect(move.note).toBe(
      "You walk over from Club first (usually 13 min), arriving Tue 2026-10-27 16:13. You'll check in when you get there.",
    );
  });

  it("refuses an activity elsewhere too short for the walk there", async () => {
    for (const duration of [10, 13]) {
      await expect(
        start({ task: task(duration, { type: "eating" }), travel: false }),
      ).rejects.toThrow(
        `Getting from Club to Dorm usually takes 13 min, which doesn't fit in this ${duration}-minute activity.`,
      );
    }
    // A trip of its own may take as long as the character likes.
    expect((await start({ task: task(10) })).record?.trip?.arriveAt).toBe(
      minutes(10),
    );
  });

  it("arrives without a judgment, reminded what they came for", async () => {
    // Getting in is the character's to play out from the place's description.
    const record = (
      await start({ task: task(30, { type: "eating" }), travel: false })
    ).record!;
    expect(arrive(map, record, record.trip!.arriveAt)).toEqual({
      record: { placeId: "dorm", since: minutes(13) },
      note: 'You\'ve arrived at Dorm `dorm`. You came here for "Heading out", planning about 17 min. Carry on with it, or change your mind.',
    });
  });

  it("stays put for an activity here, by id or by name", async () => {
    for (const where of ["club", "CLUB"]) {
      expect(
        await start({
          where,
          task: task(30, { type: "eating" }),
          travel: false,
        }),
      ).toEqual({
        record: atClub,
        note: "At Club.",
        payload: { where: "club" },
      });
    }
  });

  it("keeps an unmapped spot in the character's words, where they are", async () => {
    expect(
      await start({
        where: "the bench under the willow",
        task: task(30, { type: "having fun" }),
        travel: false,
      }),
    ).toEqual({
      record: atClub,
      note: "At the bench under the willow, in Club: somewhere only you have noticed so far.",
      payload: { where: "club", spot: "the bench under the willow" },
    });
  });

  it("keeps a trip to somewhere off the map where they are, and says so", async () => {
    expect(
      await start({ where: "Trinity Beach", task: task(30), travel: true }),
    ).toEqual({
      record: atClub,
      note: "You don't know the way to \"Trinity Beach\": it isn't anywhere you know how to get to. You're still at Club; ask someone, or head for a place you know.",
      payload: { where: "club", unknown: "Trinity Beach" },
    });
  });

  it("places a character with no position where their first activity is", async () => {
    const move = await start({ record: undefined, where: "dorm" });
    expect(move.record).toEqual({
      placeId: "dorm",
      since: T0,
    });
  });

  it("stops a trip at the place being passed when something else starts", async () => {
    const trip = (await start()).record!;
    const later = minutes(5);
    expect(
      (
        await start({
          record: trip,
          at: later,
          task: task(20, { id: "task-2", type: "socializing" }),
          where: "school",
          travel: false,
        })
      ).record,
    ).toEqual({ placeId: "school", since: later });
    const onward = await start({
      record: trip,
      at: later,
      task: task(60, { id: "task-2", type: "eating" }),
      where: "dorm",
      travel: false,
    });
    expect(onward.record?.trip).toMatchObject({
      departAt: later,
      purpose: { description: "Heading out" },
    });
    expect(onward.record?.placeId).toBe("school");
  });

  it("moves a delayed trip's arrival with the lease's end", async () => {
    const record = (await start()).record!;
    const delayed = planDelay({
      map,
      record,
      at: minutes(4),
      task: task(48),
    });
    expect(delayed.record?.trip?.legs.map(({ at }) => at)).toEqual([
      T0,
      minutes(2),
      minutes(8),
      minutes(48),
    ]);
    expect(delayed.note).toBe("Now arriving at Dorm Tue 2026-10-27 16:48.");
    expect(
      planDelay({ map, record, at: minutes(4), task: task(48, { id: "x" }) }),
    ).toEqual({});
  });

  it("renders the place, what is around and the places on the character's mind", async () => {
    const knowledge = { known: new Set(["club", "dorm"]), named: ["room"] };
    expect(renderWhereabouts(map, atClub, T0, knowledge, 8)).toBe(
      [
        "Club `club` (Annex › School). The club.",
        "With you: no one you've noticed.",
        "Around you: Annex `annex` 1 min",
        "Places you know: Dorm `dorm` 13 min · Room `room` 14 min",
      ].join("\n"),
    );
    // Somewhere without a card yet: the whole description, once.
    const fresh = buildMap([
      place("cafe", { bodyMarkdown: "# Cafe\n\nWarm light and old jazz." }),
    ]);
    expect(
      renderWhereabouts(
        fresh,
        { placeId: "cafe", since: T0 },
        T0,
        { known: new Set(), named: [] },
        8,
      ),
    ).toBe(
      "Cafe `cafe`. The cafe.\nNew to you; you take it all in: Warm light and old jazz.\nWith you: no one you've noticed.",
    );
    const trip = (await start()).record!;
    expect(renderWhereabouts(map, trip, minutes(5), knowledge, 8)).toBe(
      "On your way from Club to Dorm `dorm`; near School `school` now. Arriving Tue 2026-10-27 16:26.",
    );
    expect(renderWhereabouts(map, undefined, T0, knowledge, 8)).toContain(
      "You haven't settled anywhere yet",
    );
  });
});
