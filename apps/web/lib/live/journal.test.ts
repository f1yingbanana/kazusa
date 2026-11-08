import { describe, expect, it } from "vitest";
import type { JournalEvent } from "@kazusa/client";
import { mergeTail, mergeNewestFirst } from "./journal";

const event = (seq: number): JournalEvent => ({
  seq,
  simTime: seq * 1000,
  kind: "clock.changed",
  actors: [],
  payload: { speed: 1 },
});

describe("journal tail", () => {
  it("ignores duplicates and keeps ascending order within the limit", () => {
    let tail: readonly JournalEvent[] = [];
    for (const seq of [1, 3, 2, 3]) tail = mergeTail(tail, [event(seq)], 2);
    expect(tail.map((e) => e.seq)).toEqual([2, 3]);
  });
  it("keeps the same snapshot when a reconnect replays known events", () => {
    const tail = [event(4), event(9000)];
    expect(mergeTail(tail, [event(4), event(9000)])).toBe(tail);
  });
  it("merges live tail and history pages newest-first without duplicates", () => {
    const merged = mergeNewestFirst(
      [event(9), event(10)],
      [event(10), event(8), event(7)],
    );
    expect(merged.map((e) => e.seq)).toEqual([10, 9, 8, 7]);
  });
});
