import type { PortraitPlacement } from "@kazusa/client";

/** Slots in a wide scene: five columns, figures balanced about the middle. */
export const WIDE_SLOTS = 5;
/**
 * Slots in an upright scene (a phone held upright): one figure, from the chest
 * up.
 */
export const NARROW_SLOTS = 1;
export type SlotCount = typeof WIDE_SLOTS | typeof NARROW_SLOTS;
/** Narrowest scene that has five slots: 120px a column. */
export const WIDE_MIN_WIDTH_PX = 600;
/**
 * Where a backdrop is anchored when `object-fit: cover` crops it (never
 * letterboxed, never stretched). The pictures are about 1.42:1; a scene
 * narrower than that (a desktop pane, an upright phone) loses the sides,
 * evenly, since their vanishing points sit in the middle; a wider one (full
 * screen, a phone held sideways) loses height, a little more from the foot than
 * the top, because the foot is under the dialogue box and the figures anyway.
 */
export const BACKDROP_POSITION = "50% 40%";
/**
 * The source pictures share one canvas and one scale: relative size is in their
 * pixels. A picture this many pixels tall is drawn `FIGURE_HEIGHT` of the
 * scene's height (`BUST_HEIGHT` in the one-slot scene); every other at the same
 * pixels-per-pixel, never fitted to a box. Only a `scale` set by hand in a
 * character's `portraits.json` changes one outfit's size (`standFigure`). The
 * reference is a standard picture as the importer writes it: a 1920-high source
 * canvas at its 0.8 scale (`scripts/portraits.mjs`).
 */
export const REFERENCE_PX = 1_536;
/** A reference-tall picture, in scene heights, in the wide scene. */
export const FIGURE_HEIGHT = 1.0;
/** …and in the one-slot scene (an upright phone), drawn from the chest up. */
export const BUST_HEIGHT = 1.8;
/**
 * The floor line every picture's bottom edge stands on, in scene heights from
 * the top: the scene's foot in the wide scene, lower in the one-slot scene so
 * the one figure is cut at the chest.
 */
export const FLOOR_Y = 1.02;
export const BUST_FLOOR_Y = 1.74;

/**
 * Five slots or one: five when the scene is at least as wide as it is tall and
 * at least `WIDE_MIN_WIDTH_PX` wide, else one. Nothing in between.
 */
export function slotCount(size: {
  readonly width: number;
  readonly height: number;
}): SlotCount {
  return size.width >= WIDE_MIN_WIDTH_PX && size.width >= size.height
    ? WIDE_SLOTS
    : NARROW_SLOTS;
}

/** Columns of 1 to 5 figures in the wide scene: even counts skip the middle. */
const BALANCED: readonly (readonly number[])[] = [
  [],
  [2],
  [1, 3],
  [1, 2, 3],
  [0, 1, 3, 4],
  [0, 1, 2, 3, 4],
];

/**
 * The columns `count` figures stand in, left to right, balanced about the
 * middle (columns 0 to `slots - 1`). More figures than slots is the director's
 * mistake: they get no column.
 */
export function figureColumns(count: number, slots: SlotCount): number[] {
  if (slots === NARROW_SLOTS) return count > 0 ? [0] : [];
  return [...(BALANCED[Math.min(Math.max(0, count), WIDE_SLOTS)] ?? [])];
}

/** Where a column's figure stands: its centre, as a % of the scene's width. */
export function columnLeft(column: number, slots: SlotCount): number {
  return ((column + 0.5) / slots) * 100;
}

export type Framing = "full" | "bust";

/**
 * Screen pixels per source pixel, the same for every picture in a scene
 * `sceneHeightPx` tall: a figure is its picture's natural size times this.
 */
export function figureScale(sceneHeightPx: number, framing: Framing): number {
  const height = framing === "bust" ? BUST_HEIGHT : FIGURE_HEIGHT;
  return (sceneHeightPx * height) / REFERENCE_PX;
}

/** A picture's place in a scene: CSS `zoom`, and a move from its column. */
export interface Standing {
  /** Screen pixels per picture pixel: the scene's scale times its own. */
  readonly zoom: number;
  /**
   * How far left of its column's centre the picture starts, in % of its own
   * width: the figure's own centre is then on the column's.
   */
  readonly centrePercent: number;
  /** A further move right and down, in screen pixels. */
  readonly x: number;
  readonly y: number;
}

/**
 * Where a picture goes in a scene `sceneHeightPx` tall. Its bottom edge is on
 * the floor line and the figure's centre (`centre` across the picture; its
 * middle when it has none) on its column's, so a weapon or wing out to one side
 * doesn't push the body off it. Its own `scale` multiplies the scene's, about
 * that point on the floor. `offset` is in its own pixels, so it grows and
 * shrinks with it.
 */
export function standFigure(
  placement: PortraitPlacement | undefined,
  sceneHeightPx: number,
  framing: Framing,
): Standing {
  const zoom = figureScale(sceneHeightPx, framing) * (placement?.scale ?? 1);
  const [right, down] = placement?.offset ?? [0, 0];
  return {
    zoom,
    centrePercent: (placement?.centre ?? 0.5) * 100,
    x: right * zoom,
    y: down * zoom,
  };
}

/** Where pictures stand: their bottom edge, in % of the scene's height. */
export function floorPercent(framing: Framing): number {
  return (framing === "bust" ? BUST_FLOOR_Y : FLOOR_Y) * 100;
}
