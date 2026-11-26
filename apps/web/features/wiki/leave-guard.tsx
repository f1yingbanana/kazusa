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

const isModifiedLeave = (event: Event, leave: HTMLElement): boolean => {
  if (!(leave instanceof HTMLAnchorElement)) return false;
  if (leave.target && leave.target !== "_self") return true;
  if (event instanceof MouseEvent)
    return (
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      event.button !== 0
    );
  if (event instanceof KeyboardEvent)
    return event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
  return false;
};

type LeaveConfirmHandler = (run: () => void) => void;
const activeLeaveHandlers = new Set<LeaveConfirmHandler>();

/**
 * Runs `action` immediately unless a mounted editor has unsaved changes, in
 * which case its discard dialog asks first.
 */
export function confirmLeave(action: () => void): void {
  const handler = [...activeLeaveHandlers].at(-1);
  if (handler) handler(action);
  else action();
}

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
  const heldAction = useRef<(() => void) | null>(null);
  const letGo = useRef(false);
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    if (!dirty) return;
    const handleConfirm: LeaveConfirmHandler = (action) => {
      held.current = null;
      heldAction.current = action;
      setAsking(true);
    };
    activeLeaveHandlers.add(handleConfirm);
    const onUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    const stop = (event: Event) => {
      if (letGo.current) return;
      const target = event.target as HTMLElement | null;
      const leave = target?.closest<HTMLElement>(LEAVES);
      if (
        !leave ||
        isModifiedLeave(event, leave) ||
        area.current?.contains(leave) ||
        leave.closest(LAYERS) ||
        (event instanceof KeyboardEvent &&
          event.key !== "Enter" &&
          event.key !== " ")
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      heldAction.current = null;
      held.current = leave;
      setAsking(true);
    };
    window.addEventListener("beforeunload", onUnload);
    document.addEventListener("click", stop, true);
    document.addEventListener("keydown", stop, true);
    return () => {
      activeLeaveHandlers.delete(handleConfirm);
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
      <AlertDialog
        open={asking}
        onOpenChange={(open) => {
          setAsking(open);
          if (!open) {
            held.current = null;
            heldAction.current = null;
          }
        }}
      >
        <AlertPanel
          danger
          title="Discard your changes?"
          description="They won't be saved."
          onConfirm={() => {
            const leave = held.current;
            const action = heldAction.current;
            held.current = null;
            heldAction.current = null;
            letGo.current = true;
            // After the dialog has closed and given focus back.
            requestAnimationFrame(() => {
              if (action) action();
              else leave?.click();
              letGo.current = false;
            });
          }}
        />
      </AlertDialog>
    ),
  };
}
