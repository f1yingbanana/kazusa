"use client";

import { DEFAULT_VIEW, STAGE_VIEWS } from "@/lib/registry/views";
import { useAccess } from "./use-access";
import { useParam } from "./use-url-state";

export function useActiveView() {
  const requested = useParam("view");
  const { hasPermission } = useAccess();
  const match = STAGE_VIEWS.find(
    (view) =>
      view.id === requested &&
      (!view.requiresPermission || hasPermission(view.requiresPermission)),
  );
  return match ?? STAGE_VIEWS.find((view) => view.id === DEFAULT_VIEW)!;
}
