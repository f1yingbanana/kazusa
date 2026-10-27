"use client";

import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  parseEntityRef,
  serializeEntityRef,
  type EntityRef,
} from "@/lib/state/entity-ref";

export type UrlPatch = Readonly<Record<string, string | null | undefined>>;

/** URL is the navigation state: `view`, `sel`, and each view's namespaced params. */
export function useNavigate() {
  const router = useRouter();
  const pathname = usePathname();
  return useCallback(
    (patch: UrlPatch, mode: "push" | "replace" = "push") => {
      const next = new URLSearchParams(window.location.search);
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === undefined || value === "") next.delete(key);
        else next.set(key, value);
      }
      const search = next.toString();
      router[mode](search ? `${pathname}?${search}` : pathname, { scroll: false });
    },
    [router, pathname],
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
