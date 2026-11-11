import { describe, expect, it } from "vitest";
import {
  BUST_FLOOR_Y,
  BUST_HEIGHT,
  FIGURE_HEIGHT,
  FLOOR_Y,
  NARROW_SLOTS,
  REFERENCE_PX,
  WIDE_SLOTS,
  columnLeft,
  figureColumns,
  figureScale,
  floorPercent,
  slotCount,
} from "./layout";

describe("slots", () => {
  it.each([
    // Desktop chat pane, phone held sideways, a short wide window.
    [776, 650, WIDE_SLOTS],
    [788, 145, WIDE_SLOTS],
    [600, 600, WIDE_SLOTS],
    // Phone held upright, a portrait tablet, a narrow window, too narrow.
    [390, 560, NARROW_SLOTS],
    [768, 900, NARROW_SLOTS],
    [700, 701, NARROW_SLOTS],
    [599, 300, NARROW_SLOTS],
    [0, 0, NARROW_SLOTS],
  ])("a scene %ipx by %ipx has %i", (width, height, slots) => {
    expect(slotCount({ width, height })).toBe(slots);
  });

  it.each([
    [0, []],
    [1, [2]],
    [2, [1, 3]],
    [3, [1, 2, 3]],
    [4, [0, 1, 3, 4]],
    [5, [0, 1, 2, 3, 4]],
  ])("%i figures stand balanced in columns %j of five", (count, columns) => {
    expect(figureColumns(count, WIDE_SLOTS)).toEqual(columns);
  });

  it("stands one figure in the one slot, and never more than the slots", () => {
    expect(figureColumns(0, NARROW_SLOTS)).toEqual([]);
    expect(figureColumns(1, NARROW_SLOTS)).toEqual([0]);
    expect(figureColumns(2, NARROW_SLOTS)).toEqual([0]);
    expect(figureColumns(7, WIDE_SLOTS)).toEqual([0, 1, 2, 3, 4]);
  });

  it.each([
    [0, WIDE_SLOTS, 10],
    [2, WIDE_SLOTS, 50],
    [4, WIDE_SLOTS, 90],
    [0, NARROW_SLOTS, 50],
  ] as const)("column %i of %i stands at %d%%", (column, slots, left) => {
    expect(columnLeft(column, slots)).toBeCloseTo(left);
  });
});

describe("one scale for every figure", () => {
  it("draws a reference-tall picture a set share of the scene, and any other at the same pixels per pixel", () => {
    expect(figureScale(768, "full") * REFERENCE_PX).toBeCloseTo(
      768 * FIGURE_HEIGHT,
    );
    expect(figureScale(683, "bust") * REFERENCE_PX).toBeCloseTo(
      683 * BUST_HEIGHT,
    );
    // Twice as tall a scene, twice the scale; the picture's size is its own.
    expect(figureScale(1_536, "full")).toBeCloseTo(
      2 * figureScale(768, "full"),
    );
    // Bust framing is larger, on a lower floor.
    expect(figureScale(683, "bust")).toBeGreaterThan(figureScale(683, "full"));
    expect(floorPercent("full")).toBeCloseTo(FLOOR_Y * 100);
    expect(floorPercent("bust")).toBeCloseTo(BUST_FLOOR_Y * 100);
    expect(FLOOR_Y).toBeGreaterThanOrEqual(1);
  });
});
