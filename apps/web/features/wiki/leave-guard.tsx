"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { AlertDialog, AlertPanel } from "@/ui/dialog";

/** What can take someone elsewhere: a link, a button, a row of a list. */
const LEAVES =
  'a[href], button, [role="treeitem"], [role="tab"], [role="link"], [role="option"]';

/**
 * Popups and dialogs: those an editor opens itself (a level's list, a picker)
 * are drawn outside it, and pressing in them never leaves.
 */
const LAYERS =
  '[role="listbox"], [role="dialog"], [role="alertdialog"], [role="menu"], [data-slot$="-content"], [popover]';

/**
 * Holds what would take someone away from unsaved changes: a press outside
 * `scope` on a link, a button or a row asks first, and goes on if they agree.
 * Reloading or closing the tab asks the browser's own way.
 */
export function useLeaveGuard(dirty: boolean): {
  scope: (element: HTMLElement | null) => void;
  dialog: ReactNode;
} {
  const area = useRef<HTMLElement | null>(null);
  const held = useRef<HTMLElement | null>(null);
  const letGo = useRef(false);
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    if (!dirty) return;
    const onUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    const stop = (event: Event) => {
      if (letGo.current) return;
      const target = event.target as HTMLElement | null;
      const leave = target?.closest<HTMLElement>(LEAVES);
      if (
        !leave ||
        area.current?.contains(leave) ||
        leave.closest(LAYERS) ||
        (event instanceof KeyboardEvent &&
          event.key !== "Enter" &&
          event.key !== " ")
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      held.current = leave;
      setAsking(true);
    };
    window.addEventListener("beforeunload", onUnload);
    document.addEventListener("click", stop, true);
    document.addEventListener("keydown", stop, true);
    return () => {
      window.removeEventListener("beforeunload", onUnload);
      document.removeEventListener("click", stop, true);
      document.removeEventListener("keydown", stop, true);
    };
  }, [dirty]);

  return {
    scope: (element) => {
      area.current = element;
    },
    dialog: (
      <AlertDialog open={asking} onOpenChange={setAsking}>
        <AlertPanel
          danger
          title="Discard your changes?"
          description="They won't be saved."
          onConfirm={() => {
            const leave = held.current;
            held.current = null;
            letGo.current = true;
            // After the dialog has closed and given focus back.
            requestAnimationFrame(() => {
              leave?.click();
              letGo.current = false;
            });
          }}
        />
      </AlertDialog>
    ),
  };
}
