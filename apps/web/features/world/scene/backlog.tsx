"use client";

import { useEffect, type ReactNode } from "react";
import { Drawer, DrawerPanel } from "@/ui/drawer";

/** Keyboard Lock, where the browser has it (Chromium, in full screen). */
interface KeyboardLock {
  lock?: (keys: string[]) => Promise<void>;
  unlock?: () => void;
}

/**
 * The transcript over the scene, as a visual novel's backlog: a sheet from the
 * end edge, opened at the latest line. In the browser's full screen, Escape is
 * held for the page while it's open, so it closes the backlog and not the full
 * screen.
 */
export function Backlog({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** The talk's transcript. */
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const keyboard = (navigator as Navigator & { keyboard?: KeyboardLock })
      .keyboard;
    const locked = document.fullscreenElement !== null && keyboard?.lock;
    if (locked) void keyboard.lock?.(["Escape"]).catch(() => {});
    return () => {
      if (locked) keyboard.unlock?.();
    };
  }, [open]);

  return (
    <Drawer
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      side="right"
    >
      <DrawerPanel title="Transcript" heading size="lg">
        {open ? children : null}
      </DrawerPanel>
    </Drawer>
  );
}
