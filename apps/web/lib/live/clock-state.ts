import { create } from "zustand";
import type { ClockState } from "@kazusa/client";
import { simTimeAt } from "../time/sim";

/** Clock anchor plus `serverNow - Date.now()` measured when it arrived. */
export interface ClockAnchor {
  readonly clock: ClockState;
  readonly offset: number;
}

interface ClockProjection {
  readonly clock: ClockAnchor | null;
  readonly simNow: number;
}

/** Isolate periodic time sampling from entity subscriptions. */
export const useClockStore = create<ClockProjection>()(() => ({
  clock: null,
  simNow: 0,
}));

function sample(anchor: ClockAnchor | null): number {
  return anchor ? simTimeAt(anchor.clock, Date.now(), anchor.offset) : 0;
}

export function setClock(clock: ClockAnchor | null): void {
  useClockStore.setState({ clock, simNow: sample(clock) });
}

export function sampleClock(): void {
  useClockStore.setState((state) => {
    const simNow = sample(state.clock);
    return simNow === state.simNow ? state : { simNow };
  });
}
