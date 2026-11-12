"use client";

import { useEffect, useEffectEvent, useRef, type ReactNode } from "react";
import { XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Over the scene while the backlog is open: the page's colour, flat. */
const SHADE = "color-mix(in oklch, var(--background) 55%, transparent)";

/** Keyboard Lock, where the browser has it (Chromium, in full screen). */
interface KeyboardLock {
  lock?: (keys: string[]) => Promise<void>;
  unlock?: () => void;
}

/**
 * The transcript over the scene, as a visual novel's backlog: inside the stage
 * (anything portalled to the page's body is hidden in the browser's full
 * screen), a right-hand panel of readable width over a flat shade, the whole
 * scene on a phone. Opened at the latest message (the list's own scrolling).
 * Closes by its button, a click on the shade, or Escape, which then does
 * nothing else: not leaving full screen (in the browser's own full screen,
 * Escape is held for the page while it is open, where it can be), not reaching
 * the scene behind.
 */
export function Backlog({
  onClose,
  children,
}: {
  onClose: () => void;
  /** The transcript: the chat's own message list. */
  children: ReactNode;
}) {
  const close = useRef<HTMLButtonElement>(null);
  const closing = useEffectEvent(onClose);
  // Once, while open: focus in and back out, Escape, Keyboard Lock.
  useEffect(() => {
    const before =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    close.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      event.stopPropagation();
      closing();
    };
    // Before anything else hears it, full screen included.
    window.addEventListener("keydown", onKey, true);
    const keyboard = (navigator as Navigator & { keyboard?: KeyboardLock })
      .keyboard;
    const locked = document.fullscreenElement !== null && keyboard?.lock;
    if (locked) void keyboard.lock?.(["Escape"]).catch(() => {});
    return () => {
      window.removeEventListener("keydown", onKey, true);
      if (locked) keyboard.unlock?.();
      if (before?.isConnected) before.focus();
    };
  }, []);

  return (
    <div data-backlog className="absolute inset-0 z-[60] flex justify-end">
      <div
        aria-hidden
        className="absolute inset-0 animate-in duration-200 fade-in"
        style={{ backgroundColor: SHADE }}
        onClick={onClose}
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Backlog"
        className="relative flex h-full w-full animate-in flex-col bg-background shadow-lg duration-200 fade-in slide-in-from-right-4 sm:w-[min(32rem,92%)] sm:border-l"
      >
        <header className="flex h-12 shrink-0 items-center gap-2 border-b pr-2 pl-4">
          <h2 className="flex-1 text-sm font-semibold">Backlog</h2>
          <Button
            ref={close}
            variant="ghost"
            size="icon-sm"
            onClick={onClose}
            title="Close (Esc)"
          >
            <XIcon />
            <span className="sr-only">Close backlog</span>
          </Button>
        </header>
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      </section>
    </div>
  );
}
