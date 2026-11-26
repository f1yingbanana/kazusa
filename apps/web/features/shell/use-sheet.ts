"use client";

import { useEffect, useState } from "react";
import { serializeEntityRef, type EntityRef } from "@/lib/state/entity-ref";
import {
  clearInspectorRequest,
  settleQuietSelection,
  useUiStore,
} from "@/lib/state/ui-store";

/**
 * Whether the details drawer is open where it isn't docked: it opens on a new
 * selection unless that was made quietly (opening a conversation points the
 * panel at it without covering it, a tab inside the sheet keeps it open), opens
 * when asked (Details), and closes when the section changes, keeping the
 * selection.
 */
export function useDetailsSheet(
  selection: EntityRef | null,
  view: string,
): [boolean, (open: boolean) => void] {
  const quietKey = useUiStore((state) => state.quietKey);
  const requested = useUiStore((state) => state.inspectorRequested);
  const selKey = selection ? serializeEntityRef(selection) : null;
  const [open, setOpen] = useState(Boolean(selKey) && selKey !== quietKey);
  const [seen, setSeen] = useState({ selKey, view });
  if (seen.selKey !== selKey || seen.view !== view) {
    setSeen({ selKey, view });
    // A quiet pick (a tab inside the sheet, a conversation opened) leaves the
    // sheet as it is; a loud one opens it; none, or another section, closes it.
    if (!selKey || seen.view !== view) setOpen(false);
    else if (selKey !== quietKey) setOpen(true);
  }
  useEffect(() => settleQuietSelection(selKey), [selKey]);
  useEffect(() => {
    if (!requested) return;
    setOpen(true);
    clearInspectorRequest();
  }, [requested]);
  return [open && Boolean(selKey), setOpen];
}
