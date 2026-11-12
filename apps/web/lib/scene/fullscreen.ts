/**
 * Full screen for the Scene view: the browser's (the Fullscreen API on the
 * element that holds the scene) where it exists and is allowed, else the app's
 * own (that element laid over the whole window). A view state: never stored,
 * never in the URL.
 */
export type FullscreenMode = "off" | "browser" | "window";

/** What the API needs from the document, so tests can stand one in. */
export interface FullscreenDocument {
  readonly fullscreenEnabled?: boolean;
  readonly fullscreenElement?: Element | null;
}

/** An element that may or may not have the API (an iPhone's don't). */
export interface FullscreenTarget {
  readonly requestFullscreen?: (options?: FullscreenOptions) => Promise<void>;
}

/**
 * Whether to ask the browser at all: the element has the API and the page may
 * use it (an iframe without `allow="fullscreen"` may not). When it can't, or it
 * refuses, the app's own full window is used instead.
 */
export function canAskBrowser(
  doc: FullscreenDocument,
  element: FullscreenTarget,
): boolean {
  return (
    typeof element.requestFullscreen === "function" &&
    doc.fullscreenEnabled !== false
  );
}

/**
 * The mode after the browser's full-screen element changed: ours is now full
 * screen, or the browser left it (Escape, the system's gesture, another element
 * taking over), which ends the browser mode but not the app's own.
 */
export function modeAfterChange(
  mode: FullscreenMode,
  ours: boolean,
): FullscreenMode {
  if (ours) return "browser";
  return mode === "browser" ? "off" : mode;
}
