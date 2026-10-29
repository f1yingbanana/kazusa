"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { readSimNow } from "@/hooks/use-clock";
import { statusStore } from "@/lib/live/state";
import { dispatchLive } from "@/lib/registry/live";
import { setMockStage } from "@/lib/source/mock/world";
import { useSources } from "@/lib/source/provider";
import { setStage } from "@/lib/source/stage/http";
import { useKazusaConfig } from "@/lib/state/config-store";

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
 * Who is offstage. Changes only when someone goes off or comes back, so a
 * brain flip for one of 300 characters re-renders nothing here.
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
 * world can't do it (no stage domain, or statuses from a different source).
 */
export function useStage() {
  const { resolved, world } = useSources();
  const config = useKazusaConfig();
  const live = resolved.stage === "live" && resolved.status === "live";
  const mocked =
    resolved.stage === "mock" && resolved.status === "mock" && world !== null;

  const apply = useCallback(
    async (ids: readonly string[], onstage: boolean): Promise<boolean> => {
      if (ids.length === 0) return true;
      try {
        if (live) {
          const { statuses } = await setStage(
            config.baseUrl,
            ids,
            onstage,
            config.token,
          );
          // SSE brings the same statuses; don't wait for it.
          for (const [id, status] of Object.entries(statuses))
            statusStore.set(id, status);
        } else if (mocked && world) {
          for (const event of setMockStage(world, ids, onstage, readSimNow()))
            dispatchLive(event);
        }
        return true;
      } catch (error) {
        toast.error(
          onstage ? "Couldn't bring them onstage" : "Couldn't send them offstage",
          { description: error instanceof Error ? error.message : undefined },
        );
        return false;
      }
    },
    [live, mocked, world, config.baseUrl, config.token],
  );

  return { apply: live || mocked ? apply : undefined, mocked };
}
