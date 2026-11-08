"use client";

import { useCallback } from "react";
import { useShallow } from "zustand/react/shallow";
import { toast } from "sonner";
import { updateStatuses, useLiveStore } from "@/lib/live/state";
import { useAccess } from "@/hooks/use-access";
import { useSources } from "@/lib/source/provider";
import { setStage } from "@/lib/source/stage/http";

/** Only an explicit onstage:false is offstage. Ignore unrelated brain updates. */
export function useOffstage(): ReadonlySet<string> {
  return useLiveStore(
    useShallow(
      (state) =>
        new Set(
          [...state.statuses]
            .filter(([, status]) => status.onstage === false)
            .map(([id]) => id),
        ),
    ),
  );
}

/**
 * Sending characters off or bringing them back. `apply` is undefined when the
 * backend doesn't serve both stage and status.
 */
export function useStage() {
  const { resolved } = useSources();
  const { canManage } = useAccess();
  const live =
    canManage && resolved.stage === "live" && resolved.status === "live";

  const apply = useCallback(
    async (ids: readonly string[], onstage: boolean): Promise<boolean> => {
      if (ids.length === 0) return true;
      try {
        const { statuses } = await setStage(ids, onstage);
        // SSE brings the same statuses; don't wait for it.
        updateStatuses(Object.entries(statuses));
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
