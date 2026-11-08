"use client";

import { useQueryState } from "nuqs";
import { entityRefParser } from "@/lib/state/entity-ref";

/** Selection is shared by the shell and all views. */
export function useSelection() {
  return useQueryState("sel", entityRefParser);
}
