import { sayingOf } from "@kazusa/client";
import type { ClockAnchor } from "../live/clock-state";
import { simTimeAt } from "../time/sim";
import type { SceneLine } from "./state";

/**
 * How much of a line's saying its reveal takes: the line is typed out faster
 * than it is said, and stands whole for the rest of its time, a pause before it
 * lands and the next begins. Only the screen is faster; the line is still said,
 * heard and cut at the server's pace.
 */
export const REVEAL_SHARE = 0.7;

/** The sim time a line is revealed at: the clock's now. A paused clock stands. */
export function revealTime(anchor: ClockAnchor, wallNow: number): number {
  return simTimeAt(anchor.clock, wallNow, anchor.offset);
}

/**
 * How far through its reveal a line being said is at `simNow`, 0 to 1: 1 from
 * `REVEAL_SHARE` of the way through its saying.
 */
export function revealFraction(
  line: Pick<SceneLine, "said">,
  simNow: number,
): number {
  const said = line.said;
  if (!said) return 1;
  const span = (said.until - said.from) * REVEAL_SHARE;
  if (!(span > 0)) return 1;
  return Math.min(1, Math.max(0, (simNow - said.from) / span));
}

/**
 * What of a line shows at `simNow`: a line still being said, letter by letter
 * (`sayingOf`) at the server's pace sped up by `REVEAL_SHARE`; otherwise, or
 * shown whole, all of it. A line that is cut commits only what had been said,
 * in whole words, so what was typed ahead of the saying goes.
 */
export function revealed(
  line: Pick<SceneLine, "text" | "said" | "whole" | "messageId">,
  simNow: number,
): string {
  if (line.messageId !== undefined || line.whole || !line.said)
    return line.text;
  return sayingOf(line.text, revealFraction(line, simNow));
}
