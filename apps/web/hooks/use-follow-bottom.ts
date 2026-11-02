"use client";

import { useEffect, useRef, type UIEvent } from "react";

/** How close to the bottom still counts as reading the newest thing. */
const FOLLOW_WITHIN_PX = 48;

/**
 * Keeps a scrolling panel on its newest content, whatever made it taller: a new
 * turn, a tool's result, a font loading. Scrolling up stops following until the
 * reader comes back down.
 */
export function useFollowBottom(enabled = true) {
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const following = useRef(true);

  useEffect(() => {
    const outer = scroller.current;
    const inner = content.current;
    if (!enabled || !outer || !inner) return;
    const follow = () => {
      if (following.current) outer.scrollTop = outer.scrollHeight;
    };
    follow();
    const observer = new ResizeObserver(follow);
    observer.observe(inner);
    return () => observer.disconnect();
  }, [enabled]);

  const onScroll = (event: UIEvent<HTMLDivElement>) => {
    const { scrollTop, clientHeight, scrollHeight } = event.currentTarget;
    following.current =
      scrollHeight - scrollTop - clientHeight < FOLLOW_WITHIN_PX;
  };

  return { scroller, content, onScroll };
}
