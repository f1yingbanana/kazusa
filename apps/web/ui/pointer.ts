"use client";

import { useSyncExternalStore } from "react";

const COARSE_POINTER = "(pointer: coarse)";

const subscribeTouch = (listener: () => void) => {
  const media = window.matchMedia(COARSE_POINTER);
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
};

/** True when the primary input is touch/coarse pointer rather than a mouse. */
export function useCoarsePointer(): boolean {
  return useSyncExternalStore(
    subscribeTouch,
    () => window.matchMedia(COARSE_POINTER).matches,
    () => false,
  );
}
