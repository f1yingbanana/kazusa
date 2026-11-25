"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import {
  canAskBrowser,
  modeAfterChange,
  type FullscreenMode,
} from "@/lib/scene/fullscreen";

export interface SceneFullscreen {
  readonly mode: FullscreenMode;
  /** The browser's full screen for the stage, else the app's full window. */
  readonly enter: () => void;
  readonly exit: () => void;
}

/** Marks the button that leaves full screen, so focus can be put on it. */
export const EXIT_ATTRIBUTE = "data-fullscreen-exit";

/**
 * Full screen for `stage` (the element holding the scene and, in the player's
 * own huddle, the composer): the Fullscreen API where it exists and agrees,
 * else the stage laid over the whole window (an iPhone). Kept in step with the
 * browser: leaving its full screen by Escape or the system's gesture leaves the
 * mode. Ends when `allowed` turns false (the transcript, an ended huddle) and
 * when the view goes. The stage is never remounted, so the composer keeps its
 * draft and focus; focus moves to the exit button on entering (when it was
 * outside the stage) and back where it was on leaving.
 */
export function useSceneFullscreen(
  stage: RefObject<HTMLElement | null>,
  allowed: boolean,
): SceneFullscreen {
  const [mode, setMode] = useState<FullscreenMode>("off");
  if (!allowed && mode !== "off") setMode("off");
  // Where focus was before entering (the header's button), to give it back.
  const before = useRef<HTMLElement | null>(null);

  const enter = useCallback(() => {
    const element = stage.current;
    if (!element) return;
    before.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    if (!canAskBrowser(document, element)) {
      setMode("window");
      return;
    }
    element.requestFullscreen({ navigationUI: "hide" }).then(
      () =>
        setMode((current) =>
          modeAfterChange(current, document.fullscreenElement === element),
        ),
      // Refused (no user gesture, a policy, a browser that only pretends):
      // the app's own full window still does what was asked.
      () => setMode("window"),
    );
  }, [stage]);

  const exit = useCallback(() => setMode("off"), []);

  // The browser's full screen follows the mode, and the mode follows it.
  useEffect(() => {
    const onChange = () => {
      const element = stage.current;
      setMode((current) =>
        modeAfterChange(
          current,
          element !== null && document.fullscreenElement === element,
        ),
      );
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, [stage]);

  useEffect(() => {
    const element = stage.current;
    if (mode === "off" && element && document.fullscreenElement === element)
      void document.exitFullscreen().catch(() => {});
  }, [stage, mode]);

  // Escape leaves. A browser in its own full screen usually takes the key
  // itself (and the change above follows); the app's full window needs this.
  useEffect(() => {
    if (mode === "off") return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) setMode("off");
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mode]);

  // Focus: onto the exit button when it was left outside, back on leaving.
  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const active = document.activeElement;
    if (mode !== "off") {
      if (!element.contains(active))
        element.querySelector<HTMLElement>(`[${EXIT_ATTRIBUTE}]`)?.focus();
      return;
    }
    const target = before.current;
    before.current = null;
    // Kept where it is inside the stage (the composer); given back when it
    // was on the exit button, now gone, or nowhere.
    if (
      !target?.isConnected ||
      (active !== null && active !== document.body && element.contains(active))
    )
      return;
    // Leaving the browser's full screen takes a moment, and focus put back
    // before it is done is lost: wait for it.
    if (document.fullscreenElement !== element) {
      target.focus();
      return;
    }
    const restore = () => target.focus();
    document.addEventListener("fullscreenchange", restore, { once: true });
    return () => document.removeEventListener("fullscreenchange", restore);
  }, [stage, mode]);

  // Leaving the chat leaves the browser's full screen too.
  useEffect(() => {
    const element = stage.current;
    return () => {
      if (element && document.fullscreenElement === element)
        void document.exitFullscreen().catch(() => {});
    };
  }, [stage]);

  return { mode, enter, exit };
}
