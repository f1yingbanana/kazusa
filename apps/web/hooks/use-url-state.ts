"use client";

import { useCallback, useMemo } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import {
  parseEntityRef,
  serializeEntityRef,
  type EntityRef,
} from "@/lib/state/entity-ref";

export type UrlPatch = Readonly<Record<string, string | null | undefined>>;

/**
 * URL is the navigation state: `view`, `sel`, and each view's namespaced
 * params. The app is one page, so a change is the native History API, which
 * Next syncs into `useSearchParams` without a server round trip (a router
 * navigation took about half a second, and showed the old state meanwhile).
 */
export function useNavigate() {
  const pathname = usePathname();
  return useCallback(
    (patch: UrlPatch, mode: "push" | "replace" = "push") => {
      const next = new URLSearchParams(window.location.search);
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === undefined || value === "") next.delete(key);
        else next.set(key, value);
      }
      const search = next.toString();
      const url = search ? `${pathname}?${search}` : pathname;
      // Re-picking what is already open isn't a step Back should undo.
      if (url === `${window.location.pathname}${window.location.search}`) return;
      if (mode === "push") window.history.pushState(null, "", url);
      else window.history.replaceState(null, "", url);
    },
    [pathname],
  );
}

export function useParam(name: string) {
  return useSearchParams().get(name);
}

/** Comma-separated list param, e.g. `tl.actors=alice,bob`. */
export function useListParam(name: string) {
  const raw = useParam(name);
  return useMemo(() => (raw ? raw.split(",").filter(Boolean) : []), [raw]);
}

export function useSelection(): readonly [EntityRef | null, (ref: EntityRef | null) => void] {
  const raw = useParam("sel");
  const navigate = useNavigate();
  const selection = useMemo(() => parseEntityRef(raw), [raw]);
  const select = useCallback(
    (ref: EntityRef | null) => navigate({ sel: ref ? serializeEntityRef(ref) : null }),
    [navigate],
  );
  return [selection, select] as const;
}
