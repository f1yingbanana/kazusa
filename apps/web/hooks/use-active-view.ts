"use client";

import { DEFAULT_VIEW, STAGE_VIEWS } from "@/lib/registry/views";
import { useParam } from "./use-url-state";

export function useActiveView() {
  const requested = useParam("view");
  return (
    STAGE_VIEWS.find((view) => view.id === requested) ??
    STAGE_VIEWS.find((view) => view.id === DEFAULT_VIEW)!
  );
}
