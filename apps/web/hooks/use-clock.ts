"use client";

import { useCallback } from "react";
import type { ClockActionPayload } from "@kazusa/client";
import {
  setClock,
  useClockStore,
  type ClockAnchor,
} from "@/lib/live/clock-state";
import { executeClockAction } from "@/lib/source/clock/http";
import { useSources } from "@/lib/source/provider";
import { useAccess } from "@/hooks/use-access";
import { MINUTE, bucket, simTimeAt } from "@/lib/time/sim";

export function useClockAnchor(): ClockAnchor | null {
  return useClockStore((state) => state.clock);
}

/** Exact simulation time for event stamps; rendering uses bucketed selectors. */
export function readSimNow(): number {
  const anchor = useClockStore.getState().clock;
  return anchor
    ? simTimeAt(anchor.clock, Date.now(), anchor.offset)
    : Date.now();
}

export function useSimNow(resolution = MINUTE): number {
  return useClockStore((state) => bucket(state.simNow, resolution));
}

export function useClockActions() {
  const { resolved } = useSources();
  const { canManage } = useAccess();

  const apply = useCallback(
    async (action: ClockActionPayload) => {
      if (!canManage || resolved.clock !== "live") return;
      try {
        const result = await executeClockAction(action);
        setClock({
          clock: result.clock,
          offset: useClockStore.getState().clock?.offset ?? 0,
        });
      } catch (error) {
        console.error("Failed to execute clock action:", error);
      }
    },
    [canManage, resolved.clock],
  );

  return { apply, enabled: canManage && resolved.clock === "live" };
}
