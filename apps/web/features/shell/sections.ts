"use client";

import { useAccess } from "@/hooks/use-access";
import { STAGE_VIEWS } from "@/lib/registry/views";
import { satisfies } from "@/lib/source/capabilities";
import { useSources } from "@/lib/source/provider";

const SECTIONS = [...STAGE_VIEWS].sort((a, b) => a.order - b.order);

/** The sections this viewer can open, in rail order. */
export function useSections() {
  const { resolved } = useSources();
  const { hasPermission } = useAccess();
  return SECTIONS.filter(
    (view) =>
      satisfies(resolved, view.requires) &&
      (!view.requiresPermission || hasPermission(view.requiresPermission)),
  );
}
