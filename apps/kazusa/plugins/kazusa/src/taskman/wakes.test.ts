import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWakeSchedule } from "./wakes.ts";

const T0 = Date.parse("2026-10-27T16:00:00.000Z");
const MIN = 60_000;

/** A clock at `speed`, from wall time T0 and sim time T0. */
function clockAt(state: { speed: number; sim: number; wall: number }) {
  return {
    time: () => state.sim + (Date.now() - state.wall) * state.speed,
    now: () => ({ simTime: 0, speed: state.speed, formatted: "" }),
  };
}

describe("createWakeSchedule", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });
  afterEach(() => vi.useRealTimers());

  it("wakes each character when their end comes, soonest first", () => {
    const state = { speed: 1, sim: T0, wall: T0 };
    const woken: string[] = [];
    const schedule = createWakeSchedule({
      clock: clockAt(state),
      wake: (id) => woken.push(id),
    });
    schedule.set("bob", T0 + 30 * MIN);
    schedule.set("alice", T0 + 10 * MIN);
    vi.advanceTimersByTime(10 * MIN - 1);
    expect(woken).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(woken).toEqual(["alice"]);
    vi.advanceTimersByTime(20 * MIN);
    expect(woken).toEqual(["alice", "bob"]);
    expect(schedule.next()).toBeUndefined();
    schedule.close();
  });

  it("waits while paused, follows the speed, and wakes an end already passed at once", () => {
    const state = { speed: 0, sim: T0, wall: T0 };
    const woken: string[] = [];
    const schedule = createWakeSchedule({
      clock: clockAt(state),
      wake: (id) => woken.push(id),
    });
    schedule.set("alice", T0 + 60 * MIN);
    vi.advanceTimersByTime(120 * MIN);
    expect(woken).toEqual([]);
    // Play at 60x: an hour of sim time is a minute.
    Object.assign(state, { speed: 60, sim: T0, wall: Date.now() });
    schedule.rearm();
    vi.advanceTimersByTime(MIN);
    expect(woken).toEqual(["alice"]);
    // A lease that ended before it was scheduled.
    schedule.set("bob", state.sim);
    vi.advanceTimersByTime(0);
    expect(woken).toEqual(["alice", "bob"]);
    schedule.close();
  });

  it("drops a wake, moves one, and keeps going when a wake throws", () => {
    const state = { speed: 1, sim: T0, wall: T0 };
    const woken: string[] = [];
    const schedule = createWakeSchedule({
      clock: clockAt(state),
      wake: (id) => {
        if (id === "bad") throw new Error("boom");
        woken.push(id);
      },
    });
    schedule.set("alice", T0 + 5 * MIN);
    schedule.set("alice", T0 + 15 * MIN);
    schedule.set("gone", T0 + 5 * MIN);
    schedule.set("gone", undefined);
    schedule.set("bad", T0 + 5 * MIN);
    schedule.set("carol", T0 + 5 * MIN);
    vi.advanceTimersByTime(5 * MIN);
    expect(woken).toEqual(["carol"]);
    vi.advanceTimersByTime(10 * MIN);
    expect(woken).toEqual(["carol", "alice"]);
    schedule.close();
  });

  it("never waits longer than its longest wait before looking again", () => {
    const state = { speed: 1, sim: T0, wall: T0 };
    const woken: string[] = [];
    const schedule = createWakeSchedule({
      clock: clockAt(state),
      wake: (id) => woken.push(id),
      maxWaitMs: MIN,
    });
    schedule.set("alice", T0 + 10 * MIN);
    // The clock jumps ahead without a change event: noticed within a minute.
    state.sim += 10 * MIN;
    vi.advanceTimersByTime(MIN);
    expect(woken).toEqual(["alice"]);
    schedule.close();
  });
});
