"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { ClockActionPayload } from "@kazusa/client";
import { clockStore } from "@/lib/live/state";
import { dispatchLive } from "@/lib/registry/live";
import { executeClockAction } from "@/lib/source/clock/http";
import { useSources } from "@/lib/source/provider";
import { useAccess } from "@/hooks/use-access";
import { MINUTE, bucket, simTimeAt } from "@/lib/time/sim";

export function useClockAnchor() {
  return useSyncExternalStore(
    (listener) => clockStore.subscribe(listener),
    () => clockStore.get(),
    () => null,
  );
}

/*
 * One shared ticker for every `useSimNow` subscriber (D6). It samples once per
 * real second; each subscriber reads a bucketed value, so rows only re-render
 * when their resolution boundary is crossed.
 */
let currentSimNow = 0;
const tickListeners = new Set<() => void>();
let timer: number | undefined;

function sample() {
  const anchor = clockStore.get();
  currentSimNow = anchor
    ? simTimeAt(anchor.clock, Date.now(), anchor.offset)
    : 0;
  for (const listener of tickListeners) listener();
}

/**
 * Sim time right now, for stamping an event (not for rendering: use
 * `useSimNow`).
 */
export function readSimNow(): number {
  const anchor = clockStore.get();
  return anchor
    ? simTimeAt(anchor.clock, Date.now(), anchor.offset)
    : Date.now();
}

function subscribeTicker(listener: () => void) {
  tickListeners.add(listener);
  const unsubscribeClock = clockStore.subscribe(sample);
  if (timer === undefined) {
    sample();
    timer = window.setInterval(sample, 1_000);
  }
  return () => {
    tickListeners.delete(listener);
    unsubscribeClock();
    if (tickListeners.size === 0 && timer !== undefined) {
      window.clearInterval(timer);
      timer = undefined;
    }
  };
}

export function useSimNow(resolution = MINUTE) {
  return useSyncExternalStore(
    subscribeTicker,
    () => bucket(currentSimNow, resolution),
    () => 0,
  );
}

export function useClockActions() {
  const { resolved } = useSources();
  const { canManage } = useAccess();

  const apply = useCallback(
    async (action: ClockActionPayload) => {
      if (!canManage || resolved.clock !== "live") return;
      try {
        const result = await executeClockAction(action);
        dispatchLive({ type: "clock", clock: result.clock });
      } catch (error) {
        console.error("Failed to execute clock action:", error);
      }
    },
    [canManage, resolved.clock],
  );

  return { apply, enabled: canManage && resolved.clock === "live" };
}
