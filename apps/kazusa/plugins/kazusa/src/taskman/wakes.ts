import type { Clock } from "../clock/clock.ts";

/**
 * When each onstage character's activity ends, in simulated time, and one timer
 * for the soonest. A character is woken (`wake`) once the clock reaches their
 * end; a paused clock arms nothing. Kept in memory and rebuilt from the task
 * leases at start (`Taskman`), so changing the clock or a lease costs no
 * database write.
 */
export interface WakeSchedule {
  /** Wake `agentId` at `endAt` (sim ms), or never with `undefined`. */
  set(agentId: string, endAt: number | undefined): void;
  /** After a clock change: the wall-clock wait to the next end changed. */
  rearm(): void;
  /** When the next wake is due, in sim ms; for tests and status. */
  next(): number | undefined;
  close(): void;
}

export interface WakeScheduleDeps {
  readonly clock: Pick<Clock, "time" | "now">;
  readonly wake: (agentId: string) => void;
  /**
   * The longest a timer waits before looking again: a long wait is cut into
   * these, so a clock that drifts or a lost timer costs at most this.
   */
  readonly maxWaitMs?: number;
}

export function createWakeSchedule(deps: WakeScheduleDeps): WakeSchedule {
  const maxWaitMs = deps.maxWaitMs ?? 60_000;
  const due = new Map<string, number>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;

  const soonest = (): number | undefined => {
    let soonestAt: number | undefined;
    for (const at of due.values())
      if (soonestAt === undefined || at < soonestAt) soonestAt = at;
    return soonestAt;
  };

  const fire = (): void => {
    timer = undefined;
    if (closed) return;
    const now = deps.clock.time();
    const woken = [...due].filter(([, at]) => at <= now).map(([id]) => id);
    for (const agentId of woken) {
      due.delete(agentId);
      try {
        deps.wake(agentId);
      } catch {
        // One character's wake must not keep the others waiting.
      }
    }
    arm();
  };

  const arm = (): void => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    if (closed) return;
    const at = soonest();
    const { speed } = deps.clock.now();
    if (at === undefined || speed <= 0) return;
    const wait = Math.max(0, (at - deps.clock.time()) / speed);
    timer = setTimeout(fire, Math.min(Math.ceil(wait), maxWaitMs));
    timer.unref?.();
  };

  return {
    set(agentId, endAt) {
      if (endAt === undefined || !Number.isFinite(endAt)) {
        if (!due.delete(agentId)) return;
      } else {
        if (due.get(agentId) === endAt) return;
        due.set(agentId, endAt);
      }
      arm();
    },
    rearm: arm,
    next: soonest,
    close() {
      closed = true;
      if (timer) clearTimeout(timer);
      timer = undefined;
      due.clear();
    },
  };
}
