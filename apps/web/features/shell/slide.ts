import { flushSync } from "react-dom";

/**
 * Moves between a section's list and its stage as one sheet sliding over
 * another: `forward` (deeper) brings the new one in from the right and pushes
 * the old one left, `back` the other way. Only the element named `pane` moves;
 * the bars around it stay. Without view transitions, or with reduced motion, it
 * just switches.
 */
export function slide(direction: "forward" | "back", apply: () => void): void {
  if (
    typeof document === "undefined" ||
    !document.startViewTransition ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    apply();
    return;
  }
  const root = document.documentElement;
  root.dataset.slide = direction;
  const transition = document.startViewTransition(() => flushSync(apply));
  void transition.finished.finally(() => {
    if (root.dataset.slide === direction) delete root.dataset.slide;
  });
}
