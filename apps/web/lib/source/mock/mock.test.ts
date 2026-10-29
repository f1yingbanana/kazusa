import { describe, expect, it } from "vitest";
import {
  CharacterSummarySchema,
  JournalEventSchema,
  StreamEventSchema,
} from "@kazusa/client";
import { MINUTE } from "../../time/sim";
import { applyClockAction } from "./clock";
import { queryJournal } from "./timeline";
import { MOCK_WORLD_START, advanceMockWorld, createMockWorld } from "./world";

describe("mock world", () => {
  it("is deterministic for a seed and sized for scale work", () => {
    const a = createMockWorld({ seed: 3 });
    const b = createMockWorld({ seed: 3 });
    expect(a.characters.map((c) => c.id)).toEqual(b.characters.map((c) => c.id));
    expect(a.journal.length).toBe(b.journal.length);
    expect(a.characters.length).toBeGreaterThanOrEqual(150);
  });
  it("produces wire-valid characters and journal events in seq order", () => {
    const world = createMockWorld();
    for (const character of world.characters.slice(0, 20))
      expect(CharacterSummarySchema.safeParse(character).success).toBe(true);
    for (const event of world.journal.slice(-50))
      expect(JournalEventSchema.safeParse(event).success).toBe(true);
    const seqs = world.journal.map((e) => e.seq);
    expect(seqs).toEqual([...seqs].sort((x, y) => x - y));
  });
  it("only invents status and history around live characters", () => {
    const world = createMockWorld({
      characters: [{ id: "alice", name: "Alice", kind: "agent", aliases: [] }],
    });
    expect(world.characters).toHaveLength(1);
    expect(world.characters[0].affiliation).toBeUndefined();
    expect(world.statuses.get("alice")?.task).toBeDefined();
  });
  it("advances ended tasks into journal + status stream events", () => {
    const world = createMockWorld({ seed: 5, count: 30 });
    const before = world.journal.length;
    const events = advanceMockWorld(world, MOCK_WORLD_START + 600 * MINUTE);
    expect(world.journal.length).toBeGreaterThan(before);
    expect(events.some((e) => e.type === "journal")).toBe(true);
    expect(events.some((e) => e.type === "status")).toBe(true);
    const desires = events.filter((e) => e.type === "desires");
    expect(desires.length).toBeGreaterThan(0);
    for (const event of desires)
      expect(StreamEventSchema.safeParse(event).success).toBe(true);
  });
  it("places everyone on the map and moves them on task starts", () => {
    const world = createMockWorld({ seed: 5, count: 30 });
    const ids = new Set(world.places.map((place) => place.id));
    for (const record of world.locations.values())
      expect(ids.has(record.placeId)).toBe(true);
    const events = advanceMockWorld(world, MOCK_WORLD_START + 600 * MINUTE, 30);
    const moves = events.filter((e) => e.type === "location");
    expect(moves.length).toBeGreaterThan(0);
    for (const event of moves) {
      expect(StreamEventSchema.safeParse(event).success).toBe(true);
      const trip = event.type === "location" ? event.record.trip : undefined;
      if (!trip) continue;
      expect(ids.has(trip.to)).toBe(true);
      expect(trip.legs[0].placeId).toBe(event.record.placeId);
      expect(trip.legs.at(-1)).toEqual({ placeId: trip.to, at: trip.arriveAt });
    }
    for (const event of world.journal.slice(-40))
      expect(JournalEventSchema.safeParse(event).success).toBe(true);
  });
});

describe("mock timeline query", () => {
  const world = createMockWorld({ seed: 9, count: 40 });
  it("pages newest-first with a seq cursor and no overlap", () => {
    const first = queryJournal(world.journal, { limit: 25 });
    const second = queryJournal(world.journal, { limit: 25, before: first.nextCursor });
    expect(first.hasMore).toBe(true);
    expect(first.events[0].seq).toBe(world.journal.at(-1)!.seq);
    expect(Math.max(...second.events.map((e) => e.seq))).toBeLessThan(
      Math.min(...first.events.map((e) => e.seq)),
    );
  });
  it("filters on the server side and catches up ascending with after", () => {
    const actor = world.characters[0].id;
    const page = queryJournal(world.journal, { actors: [actor], kinds: ["task.started"] });
    expect(page.events.every((e) => e.actors.includes(actor) && e.kind === "task.started")).toBe(true);
    const tail = queryJournal(world.journal, { after: world.journal.length - 5 });
    expect(tail.events.map((e) => e.seq)).toEqual(
      world.journal.slice(-5).map((e) => e.seq),
    );
  });
});

describe("mock clock", () => {
  it("re-anchors before changing speed and advances forward", () => {
    const clock = { simTime: 0, speed: 60, updatedAt: 0 };
    expect(applyClockAction(clock, { action: "set_speed", speed: 0 }, 1_000)).toEqual({
      simTime: 60_000,
      speed: 0,
      updatedAt: 1_000,
    });
    expect(
      applyClockAction({ ...clock, speed: 0 }, { action: "advance", minutes: 15 }, 5_000).simTime,
    ).toBe(15 * MINUTE);
  });
});
