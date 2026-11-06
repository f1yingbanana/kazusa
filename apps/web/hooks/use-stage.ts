"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { statusStore } from "@/lib/live/state";
import { useSources } from "@/lib/source/provider";
import { setStage } from "@/lib/source/stage/http";

/** Only an explicit `onstage: false` is offstage; no status means unknown. */
export function isOffstage(id: string): boolean {
  return statusStore.get(id)?.onstage === false;
}

let cachedVersion = -1;
let cachedKey = "";

/** Offstage ids joined, recomputed once per status write. */
function offstageKey(): string {
  const version = statusStore.version();
  if (version !== cachedVersion) {
    cachedVersion = version;
    const ids: string[] = [];
    for (const [id, status] of statusStore.entries()) {
      if (status.onstage === false) ids.push(id);
    }
    cachedKey = ids.sort().join("\n");
  }
  return cachedKey;
}

/**
 * Who is offstage. Changes only when someone goes off or comes back, so a brain
 * flip for one of 300 characters re-renders nothing here.
 */
export function useOffstage(): ReadonlySet<string> {
  const key = useSyncExternalStore(
    (listener) => statusStore.subscribe(listener),
    offstageKey,
    () => "",
  );
  return useMemo(() => new Set(key ? key.split("\n") : []), [key]);
}

/**
 * Sending characters off or bringing them back. `apply` is undefined when the
 * backend doesn't serve both stage and status.
 */
export function useStage() {
  const { resolved } = useSources();
  const live = resolved.stage === "live" && resolved.status === "live";

  const apply = useCallback(
    async (ids: readonly string[], onstage: boolean): Promise<boolean> => {
      if (ids.length === 0) return true;
      try {
        const { statuses } = await setStage(ids, onstage);
        // SSE brings the same statuses; don't wait for it.
        for (const [id, status] of Object.entries(statuses))
          statusStore.set(id, status);
        return true;
      } catch (error) {
        toast.error(
          onstage
            ? "Couldn't bring them onstage"
            : "Couldn't send them offstage",
          { description: error instanceof Error ? error.message : undefined },
        );
        return false;
      }
    },
    [],
  );

  return { apply: live ? apply : undefined };
}
