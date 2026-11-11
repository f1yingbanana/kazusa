import { describe, expect, it } from "vitest";
import {
  BUST_EYES_Y,
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
  standFigure,
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

describe("standing a figure", () => {
  it("stands the picture's bottom edge and middle on the floor and the column without a placement", () => {
    expect(standFigure(undefined, 768, "full")).toEqual({
      zoom: figureScale(768, "full"),
      centrePercent: 50,
      rowPercent: 100,
      atPercent: FLOOR_Y * 100,
      x: 0,
      y: 0,
    });
  });

  it("puts the centre on the column, and scales the offset with the picture", () => {
    const scene = figureScale(1_536, "full");
    const stood = standFigure(
      { centre: 0.6, scale: 0.75, offset: [40, -20] },
      1_536,
      "full",
    );
    expect(stood.centrePercent).toBe(60);
    expect(stood.zoom).toBeCloseTo(scene * 0.75);
    expect(stood.x).toBeCloseTo(40 * scene * 0.75);
    expect(stood.y).toBeCloseTo(-20 * scene * 0.75);
  });

  it("stands a figure on its feet when something reaches lower than them", () => {
    const stood = standFigure({ floor: 0.95, eyes: 0.2 }, 768, "full");
    expect(stood.rowPercent).toBeCloseTo(95);
    expect(stood.atPercent).toBeCloseTo(FLOOR_Y * 100);
  });

  it("frames the one-slot scene by the eyes, whoever is shown", () => {
    const short = standFigure({ eyes: 0.25, scale: 0.8 }, 683, "bust");
    const tall = standFigure({ eyes: 0.15, scale: 1.17 }, 683, "bust");
    expect([short.rowPercent, tall.rowPercent]).toEqual([25, 15]);
    expect(short.atPercent).toBe(BUST_EYES_Y * 100);
    expect(tall.atPercent).toBe(BUST_EYES_Y * 100);
    // Without eyes, the floor line, as before.
    expect(standFigure({ floor: 0.9 }, 683, "bust")).toMatchObject({
      rowPercent: 90,
      atPercent: BUST_FLOOR_Y * 100,
    });
  });

  it("keeps even the tallest characters' heads in the wide scene", () => {
    // A 180 cm character's eyes are about 1,460 px up at scale 1; their head
    // ends about 8% above that.
    expect((1_460 * 1.08 * FIGURE_HEIGHT) / REFERENCE_PX).toBeLessThan(FLOOR_Y);
  });
});
