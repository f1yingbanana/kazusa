"use client";

import { useEffect, useRef } from "react";

const LONG_PRESS_MS = 450;
/** A finger drifting further than this is scrolling, not pressing. */
const PRESS_SLOP_PX = 8;

/**
 * A press and hold on a touch screen, where there is no hover to show a
 * message's actions. Mice and pens use hover, so they are left alone. One press
 * at a time, so one timer serves every row: `bind(id)` gives a row its
 * handlers.
 */
export function useLongPress(onLongPress: (id: string) => void) {
  const timer = useRef<number | undefined>(undefined);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const cancel = () => {
    window.clearTimeout(timer.current);
    origin.current = null;
  };
  useEffect(() => cancel, []);

  return (id: string) => ({
    onPointerDown: (event: React.PointerEvent) => {
      if (event.pointerType !== "touch") return;
      origin.current = { x: event.clientX, y: event.clientY };
      timer.current = window.setTimeout(() => {
        origin.current = null;
        navigator.vibrate?.(10);
        onLongPress(id);
      }, LONG_PRESS_MS);
    },
    onPointerMove: (event: React.PointerEvent) => {
      const start = origin.current;
      if (
        start &&
        Math.hypot(event.clientX - start.x, event.clientY - start.y) >
          PRESS_SLOP_PX
      )
        cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    // Android's own long-press menu would cover ours.
    onContextMenu: (event: React.MouseEvent) => {
      if ((event.nativeEvent as PointerEvent).pointerType === "touch")
        event.preventDefault();
    },
  });
}
