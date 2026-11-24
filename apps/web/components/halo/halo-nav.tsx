"use client";

import { parseAsString, useQueryState } from "nuqs";
import { useActiveView } from "@/hooks/use-active-view";
import { useAccess } from "@/hooks/use-access";
import { STAGE_VIEWS } from "@/lib/registry/views";
import { satisfies } from "@/lib/source/capabilities";
import { useSources } from "@/lib/source/provider";

const SECTIONS = [...STAGE_VIEWS].sort((a, b) => a.order - b.order);

export function useHaloSections() {
  const { resolved } = useSources();
  const { hasPermission } = useAccess();
  return SECTIONS.filter(
    (view) =>
      satisfies(resolved, view.requires) &&
      (!view.requiresPermission || hasPermission(view.requiresPermission)),
  );
}

/** A rail on wide screens; on phones the same buttons become a tab bar under the thumb. */
export function HaloNav() {
  const visible = useHaloSections();
  const active = useActiveView();
  const [, setView] = useQueryState("view", parseAsString);

  return (
    <nav aria-label="Sections" className="halo-rail">
      {visible.map((view) => {
        const Badge = view.badge;
        return (
          <button
            key={view.id}
            type="button"
            className="halo-rail-item"
            data-end={view.placement === "end" ? "" : undefined}
            aria-current={view.id === active.id ? "page" : undefined}
            onClick={() => void setView(view.id)}
          >
            <span className="halo-rail-icon">
              <view.icon aria-hidden className="size-5" />
              {Badge ? (
                <span className="halo-rail-badge">
                  <Badge />
                </span>
              ) : null}
            </span>
            <span className="halo-rail-label">{view.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
