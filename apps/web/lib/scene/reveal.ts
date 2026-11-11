import { heardOf } from "@kazusa/client";
import type { ClockAnchor } from "../live/clock-state";
import { simTimeAt } from "../time/sim";
import type { SceneLine } from "./state";

/**
 * How far, in real time, the reveal runs behind the clock: what reached the
 * screen a moment late is never more than the server, cutting the line now,
 * will keep.
 */
export const REVEAL_LAG_MS = 150;

/**
 * The sim time a line is revealed at: the clock's projection `REVEAL_LAG_MS`
 * ago. A paused clock stands still, lag and all; a speed change is followed.
 */
export function revealTime(anchor: ClockAnchor, wallNow: number): number {
  return simTimeAt(anchor.clock, wallNow - REVEAL_LAG_MS, anchor.offset);
}

/** How far through its window a line being said is at `simNow`, 0 to 1. */
export function revealFraction(
  line: Pick<SceneLine, "said">,
  simNow: number,
): number {
  const said = line.said;
  if (!said) return 1;
  const span = said.until - said.from;
  if (!(span > 0)) return 1;
  return Math.min(1, Math.max(0, (simNow - said.from) / span));
}

/**
 * What of a line shows at `simNow`: a line still being said, what has been
 * heard of it by then, by the rule the server cuts by (`heardOf`), so it is
 * always a prefix of what will be committed; otherwise, or shown whole, all of
 * it.
 */
export function revealed(
  line: Pick<SceneLine, "text" | "said" | "whole" | "messageId">,
  simNow: number,
): string {
  if (line.messageId !== undefined || line.whole || !line.said)
    return line.text;
  return heardOf(line.text, revealFraction(line, simNow));
}
