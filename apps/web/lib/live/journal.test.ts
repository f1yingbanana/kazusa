import { describe, expect, it } from "vitest";
import type { JournalEvent } from "@kazusa/client";
import { appendToTail, mergeNewestFirst } from "./journal";

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
    for (const seq of [1, 3, 2, 3]) tail = appendToTail(tail, event(seq), undefined, 2).tail;
    expect(tail.map((e) => e.seq)).toEqual([2, 3]);
  });
  it("reports a gap when seq skips ahead of the last seen seq", () => {
    expect(appendToTail([], event(5), 4).gapAfter).toBeUndefined();
    expect(appendToTail([], event(9), 4).gapAfter).toBe(4);
  });
  it("merges live tail and history pages newest-first without duplicates", () => {
    const merged = mergeNewestFirst([event(9), event(10)], [event(10), event(8), event(7)]);
    expect(merged.map((e) => e.seq)).toEqual([10, 9, 8, 7]);
  });
});
