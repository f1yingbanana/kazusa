import type { ClockActionPayload, ClockState } from "@kazusa/client";
import { MINUTE, simTimeAt } from "../../time/sim";

/** Mirrors the plugin `Clock`: re-anchor at the current sim time, then apply. */
export function applyClockAction(
  clock: ClockState,
  action: ClockActionPayload,
  wallNow: number,
): ClockState {
  const simTime = simTimeAt(clock, wallNow);
  if (action.action === "set_speed") {
    return { simTime, speed: action.speed, updatedAt: wallNow };
  }
  return {
    simTime: simTime + action.minutes * MINUTE,
    speed: clock.speed,
    updatedAt: wallNow,
  };
}
