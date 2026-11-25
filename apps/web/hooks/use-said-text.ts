"use client";

import { useEffect, useState } from "react";
import { useClockAnchor } from "@/hooks/use-clock";
import { isBeingSaid } from "@/lib/scene/director";
import { revealFraction, revealTime, revealed } from "@/lib/scene/reveal";
import type { SceneLine } from "@/lib/scene/state";

/**
 * A line's identity on screen: the same while it is being said and once it
 * commits, so the commit replaces its words in place, not the element.
 */
export function lineKey(line: SceneLine, fallback: string | number): string {
  return line.said
    ? `${line.speakerId}@${line.said.from}`
    : (line.messageId ?? `${line.speakerId}:${fallback}`);
}

/**
 * What of `line` shows now: a line being said, what has been heard of it,
 * following the clock frame by frame (still while paused); any other line
 * whole.
 */
export function useRevealed(line: SceneLine): string {
  const anchor = useClockAnchor();
  const live = isBeingSaid(line) && !line.whole && line.said !== undefined;
  const [shown, setShown] = useState(() =>
    live && anchor ? revealed(line, revealTime(anchor, Date.now())) : "",
  );
  useEffect(() => {
    if (!live || !anchor) return;
    let frame = 0;
    const tick = () => {
      const now = revealTime(anchor, Date.now());
      setShown(revealed(line, now));
      if (anchor.clock.speed > 0 && revealFraction(line, now) < 1)
        frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [live, anchor, line]);
  return live && anchor ? shown : line.text;
}
