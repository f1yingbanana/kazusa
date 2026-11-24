"use client";

import { parseAsString, useQueryState } from "nuqs";
import { useActiveView } from "@/hooks/use-active-view";
import { useAccess } from "@/hooks/use-access";
import { STAGE_VIEWS } from "@/lib/registry/views";
import { satisfies } from "@/lib/source/capabilities";
import { useSources } from "@/lib/source/provider";

const SECTIONS = [...STAGE_VIEWS].sort((a, b) => a.order - b.order);

export function HaloNav() {
  const { resolved } = useSources();
  const { hasPermission } = useAccess();
  const active = useActiveView();
  const [, setView] = useQueryState("view", parseAsString);
  const visible = SECTIONS.filter(
    (view) =>
      satisfies(resolved, view.requires) &&
      (!view.requiresPermission || hasPermission(view.requiresPermission)),
  );

  return (
    <nav aria-label="Sections" className="halo-nav">
      {visible.map((view) => {
        const Badge = view.badge;
        const current = view.id === active.id;
        return (
          <button
            key={view.id}
            type="button"
            className="halo-nav-item"
            data-end={view.placement === "end" ? "" : undefined}
            aria-current={current ? "page" : undefined}
            onClick={() => void setView(view.id)}
          >
            <view.icon aria-hidden className="size-4" />
            <span>{view.label}</span>
            {Badge ? <Badge /> : null}
          </button>
        );
      })}
    </nav>
  );
}
