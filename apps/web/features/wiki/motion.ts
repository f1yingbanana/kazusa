import { flushSync } from "react-dom";

/**
 * Applies a change inside a view transition, so what has a
 * `view-transition-name` on both sides (a page's title, its body) glides from
 * one to the other: reading into editing and back. Without the API, or when
 * motion is reduced, the change just happens.
 */
export function withTransition(apply: () => void): void {
  if (
    typeof document === "undefined" ||
    !document.startViewTransition ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    apply();
    return;
  }
  // A hidden page, or a second change mid-way, aborts it; the change still lands.
  document.startViewTransition(() => flushSync(apply)).ready.catch(() => {});
}

/** The names a page's title and body glide by, between reading and editing. */
export const TITLE_TRANSITION = { viewTransitionName: "wiki-title" } as const;
export const BODY_TRANSITION = { viewTransitionName: "wiki-body" } as const;
