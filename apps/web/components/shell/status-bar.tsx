"use client";

import { cn } from "@/lib/utils";
import { useAccess } from "@/hooks/use-access";
import { STATUS_ITEMS } from "@/lib/registry/status";
import { satisfies } from "@/lib/source/capabilities";
import { useSources } from "@/lib/source/provider";
import type { StatusItem } from "@/lib/registry/types";

/**
 * Items may render nothing (a failure count that is cleared, say), so each sits
 * in a wrapper that collapses when empty and the divider is drawn by CSS only
 * between wrappers that have content (the arbitrary variant on the slot).
 */
function Slot({ items }: { items: readonly StatusItem[] }) {
  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-3",
        "[&>:not(:empty)~:not(:empty)::before]:mr-3 [&>:not(:empty)~:not(:empty)::before]:block [&>:not(:empty)~:not(:empty)::before]:h-3 [&>:not(:empty)~:not(:empty)::before]:w-px [&>:not(:empty)~:not(:empty)::before]:bg-border [&>:not(:empty)~:not(:empty)::before]:content-['']",
      )}
    >
      {[...items]
        .sort((a, b) => a.order - b.order)
        .map((item) => (
          <div key={item.id} className="flex items-center empty:hidden">
            <item.component />
          </div>
        ))}
    </div>
  );
}

/**
 * Small, global, glanceable signals only. Never controls that change the
 * simulation.
 */
export function StatusBar() {
  const { resolved } = useSources();
  const { hasPermission, isLocal } = useAccess();
  const items = STATUS_ITEMS.filter(
    (item) =>
      satisfies(resolved, item.requires) &&
      (!item.requiresPermission || hasPermission(item.requiresPermission)) &&
      (!item.requiresLocal || isLocal),
  );
  return (
    <footer className="hidden h-7 shrink-0 items-center justify-between gap-4 border-t bg-sidebar px-3 font-mono text-[11px] text-muted-foreground md:flex">
      <Slot items={items.filter((item) => item.side === "start")} />
      <Slot items={items.filter((item) => item.side === "end")} />
    </footer>
  );
}
