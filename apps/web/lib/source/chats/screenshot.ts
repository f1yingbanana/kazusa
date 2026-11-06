/*
 * A screenshot covers one unbroken run of messages, like a crop of the
 * transcript. Indices are into the selectable messages, oldest first; both
 * ends are inclusive.
 */

export interface ShotRange {
  readonly start: number;
  readonly end: number;
}

/** A message's vertical extent, in the transcript's own coordinates. */
export interface ShotBounds {
  readonly top: number;
  readonly bottom: number;
}

/**
 * The first and last message on screen between `top` and `bottom` (middles
 * inside), which is where "Select up to here" reaches; `undefined` when none.
 */
export function visibleEnds(
  bounds: readonly ShotBounds[],
  top: number,
  bottom: number,
): ShotRange | undefined {
  const middle = (b: ShotBounds) => (b.top + b.bottom) / 2;
  const start = bounds.findIndex((b) => middle(b) >= top);
  if (start === -1 || middle(bounds[start]) > bottom) return undefined;
  let end = start;
  while (end + 1 < bounds.length && middle(bounds[end + 1]) <= bottom) end++;
  return { start, end };
}

/** What a screenshot holds: its range, and the messages inside left out. */
export interface Shot {
  readonly range: ShotRange;
  readonly excluded: ReadonlySet<string>;
}

/**
 * A click on the message at `index` (into `ids`):
 *
 * - Outside the range, the range reaches it, and every message passed over on the
 *   way is left out: you picked that one, not the ones between;
 * - On the first or last message, the range gives it up, and any left-out
 *   messages that would then be the edge go with it, so an edge is always in;
 * - Inside, the message is left out, or put back.
 *
 * A range of one stays: there is nothing to shrink to.
 */
export function pickMessage(
  ids: readonly string[],
  { range, excluded }: Shot,
  index: number,
): Shot {
  const { start, end } = range;
  const out = new Set(excluded);
  if (index < start || index > end) {
    const [from, to] = index < start ? [index + 1, start] : [end + 1, index];
    for (let between = from; between < to; between++) out.add(ids[between]);
    out.delete(ids[index]);
    return {
      range: index < start ? { start: index, end } : { start, end: index },
      excluded: out,
    };
  }
  if (start === end) return { range, excluded };
  if (index === start || index === end) {
    const step = index === start ? 1 : -1;
    let edge = index + step;
    while (edge !== (index === start ? end : start) && out.has(ids[edge])) {
      out.delete(ids[edge]);
      edge += step;
    }
    out.delete(ids[index]);
    return {
      range: index === start ? { start: edge, end } : { start, end: edge },
      excluded: out,
    };
  }
  if (!out.delete(ids[index])) out.add(ids[index]);
  return { range, excluded: out };
}

/**
 * The messages that go in the picture: the range, less any left out by a tap
 * inside it.
 */
export function includedIn<T extends { readonly id: string }>(
  messages: readonly T[],
  range: ShotRange,
  excluded: ReadonlySet<string>,
): T[] {
  return messages
    .slice(range.start, range.end + 1)
    .filter((message) => !excluded.has(message.id));
}

/**
 * Where a dragged edge lands at `y`: the top edge takes in every message whose
 * middle is below it, the bottom edge every message whose middle is above it,
 * and neither crosses the other.
 */
export function dragEdge(
  range: ShotRange,
  edge: "start" | "end",
  y: number,
  bounds: readonly ShotBounds[],
): ShotRange {
  const middle = (b: ShotBounds) => (b.top + b.bottom) / 2;
  if (edge === "start") {
    const found = bounds.findIndex((b) => middle(b) >= y);
    const start = found === -1 ? range.end : Math.min(found, range.end);
    return { start, end: range.end };
  }
  let found = -1;
  bounds.forEach((b, index) => {
    if (middle(b) <= y) found = index;
  });
  return { start: range.start, end: Math.max(found, range.start) };
}

/** Moves one edge by `step` messages, within the list and not past the other. */
export function nudgeEdge(
  range: ShotRange,
  edge: "start" | "end",
  step: number,
  count: number,
): ShotRange {
  if (edge === "start") {
    const start = Math.min(Math.max(range.start + step, 0), range.end);
    return { start, end: range.end };
  }
  const end = Math.max(Math.min(range.end + step, count - 1), range.start);
  return { start: range.start, end };
}

/** The largest canvas every browser draws (Safari caps the area). */
const MAX_CANVAS_AREA = 16_000_000;
const MAX_SCALE = 3;

/**
 * Pixels per CSS pixel for an image of `width` × `height`: sharp on a phone,
 * smaller for a long selection, `undefined` once even 1× is too big to draw.
 */
export function exportScale(width: number, height: number): number | undefined {
  const fit = Math.sqrt(MAX_CANVAS_AREA / (width * height));
  if (fit < 1) return undefined;
  return Math.min(MAX_SCALE, Math.floor(fit * 4) / 4);
}
