import { describe, expect, it } from "vitest";
import {
  dragEdge,
  exportScale,
  includedIn,
  nudgeEdge,
  visibleEnds,
} from "./screenshot";

describe("visibleEnds", () => {
  // Four 40px messages with 10px gaps: middles at 20, 70, 120, 170.
  const bounds = [0, 50, 100, 150].map((top) => ({ top, bottom: top + 40 }));

  it("finds the messages whose middle is on screen", () => {
    expect(visibleEnds(bounds, 30, 130)).toEqual({ start: 1, end: 2 });
    expect(visibleEnds(bounds, -100, 999)).toEqual({ start: 0, end: 3 });
  });

  it("is undefined when no message's middle is on screen", () => {
    expect(visibleEnds(bounds, 75, 115)).toBeUndefined();
    expect(visibleEnds(bounds, 200, 300)).toBeUndefined();
  });
});

describe("includedIn", () => {
  const messages = ["a", "b", "c", "d", "e"].map((id) => ({ id }));

  it("takes the range less what was left out", () => {
    expect(
      includedIn(messages, { start: 1, end: 3 }, new Set(["c", "e"])),
    ).toEqual([{ id: "b" }, { id: "d" }]);
  });
});

describe("dragEdge", () => {
  // Four 40px messages with 10px gaps: middles at 20, 70, 120, 170.
  const bounds = [0, 50, 100, 150].map((top) => ({ top, bottom: top + 40 }));

  it("takes in messages whose middle the top edge passes", () => {
    expect(dragEdge({ start: 2, end: 3 }, "start", 60, bounds)).toEqual({
      start: 1,
      end: 3,
    });
    expect(dragEdge({ start: 2, end: 3 }, "start", -100, bounds)).toEqual({
      start: 0,
      end: 3,
    });
  });

  it("takes in messages whose middle the bottom edge passes", () => {
    expect(dragEdge({ start: 0, end: 0 }, "end", 125, bounds)).toEqual({
      start: 0,
      end: 2,
    });
    expect(dragEdge({ start: 0, end: 0 }, "end", 999, bounds)).toEqual({
      start: 0,
      end: 3,
    });
  });

  it("doesn't cross the other edge", () => {
    expect(dragEdge({ start: 1, end: 2 }, "start", 500, bounds)).toEqual({
      start: 2,
      end: 2,
    });
    expect(dragEdge({ start: 1, end: 2 }, "end", -50, bounds)).toEqual({
      start: 1,
      end: 1,
    });
  });
});

describe("nudgeEdge", () => {
  it("moves an edge by a message within the list", () => {
    expect(nudgeEdge({ start: 2, end: 4 }, "start", -1, 6)).toEqual({
      start: 1,
      end: 4,
    });
    expect(nudgeEdge({ start: 2, end: 5 }, "end", 1, 6)).toEqual({
      start: 2,
      end: 5,
    });
    expect(nudgeEdge({ start: 0, end: 4 }, "start", -1, 6)).toEqual({
      start: 0,
      end: 4,
    });
  });

  it("stops at the other edge", () => {
    expect(nudgeEdge({ start: 3, end: 3 }, "start", 1, 6)).toEqual({
      start: 3,
      end: 3,
    });
    expect(nudgeEdge({ start: 3, end: 3 }, "end", -1, 6)).toEqual({
      start: 3,
      end: 3,
    });
  });
});

describe("exportScale", () => {
  it("is 3× for a phone-sized image", () => {
    expect(exportScale(400, 900)).toBe(3);
  });

  it("drops for a long image to stay drawable", () => {
    const scale = exportScale(400, 8000);
    expect(scale).toBeLessThan(3);
    expect(400 * 8000 * scale! ** 2).toBeLessThanOrEqual(16_000_000);
  });

  it("gives up when even 1× is too big", () => {
    expect(exportScale(400, 50_000)).toBeUndefined();
  });
});
