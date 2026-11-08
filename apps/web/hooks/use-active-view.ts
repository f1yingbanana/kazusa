"use client";

import { useQueryState, parseAsString } from "nuqs";
import { DEFAULT_VIEW, STAGE_VIEWS } from "@/lib/registry/views";
import { useAccess } from "./use-access";

export function useActiveView() {
  const [requested] = useQueryState("view", parseAsString);
  const { hasPermission } = useAccess();
  const match = STAGE_VIEWS.find(
    (view) =>
      view.id === requested &&
      (!view.requiresPermission || hasPermission(view.requiresPermission)),
  );
  return match ?? STAGE_VIEWS.find((view) => view.id === DEFAULT_VIEW)!;
}
