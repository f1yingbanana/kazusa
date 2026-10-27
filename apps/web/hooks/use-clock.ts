"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { ClockActionPayload } from "@kazusa/client";
import { clockStore } from "@/lib/live/state";
import { dispatchLive } from "@/lib/registry/live";
import { applyClockAction } from "@/lib/source/mock/clock";
import { useSources } from "@/lib/source/provider";
import { MINUTE, bucket, simTimeAt } from "@/lib/time/sim";

export function useClockAnchor() {
  return useSyncExternalStore(clockStore.subscribe, clockStore.get, () => null);
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
  currentSimNow = anchor ? simTimeAt(anchor.clock, Date.now(), anchor.offset) : 0;
  for (const listener of tickListeners) listener();
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
  const { resolved, world } = useSources();
  const apply = useCallback(
    (action: ClockActionPayload) => {
      if (resolved.clock !== "mock") return;
      const anchor = clockStore.get();
      if (!anchor) return;
      const next = applyClockAction(anchor.clock, action, Date.now());
      dispatchLive({ type: "clock", clock: next });
      if (world) {
        const event = {
          seq: world.nextSeq++,
          simTime: next.simTime,
          kind: "clock.changed" as const,
          actors: [],
          payload:
            action.action === "set_speed"
              ? { speed: action.speed }
              : { advancedMinutes: action.minutes },
        };
        world.journal.push(event);
        dispatchLive({ type: "journal", event });
      }
    },
    [resolved.clock, world],
  );
  return { apply, enabled: resolved.clock === "mock" };
}
