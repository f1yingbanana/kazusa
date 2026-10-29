import { describe, expect, it, vi } from "vitest";
import { Clock, sleepSim, untilRunning, type ClockCell } from "./clock.ts";
import type { ClockPersistedRecord, ClockStore } from "./types.ts";

function createInMemoryStore(): ClockStore {
  const store = new Map<string, ClockPersistedRecord>();
  return {
    async lookup(key: string): Promise<ClockPersistedRecord | undefined> {
      return store.get(key);
    },
    async register(key: string, value: ClockPersistedRecord): Promise<void> {
      store.set(key, value);
    },
  };
}

describe("Clock", () => {
  it("initializes with a default snapshot", async () => {
    const clock = new Clock({
      store: createInMemoryStore(),
      initialTime: "2026-10-21T08:00:00.000Z",
    });

    expect(clock.now().formatted).toMatch(/Wednesday/);
    expect(clock.now().speed).toBe(1);
    await clock.close();
  });

  it("persists time and speed", async () => {
    const store = createInMemoryStore();
    const clock = new Clock({ store, initialTime: "2026-10-21T08:00:00.000Z" });
    await clock.advance(4 * 60);
    await clock.setSpeed(2.5);
    await clock.close();

    const restored = new Clock({ store });
    await restored.init();
    expect(restored.now().formatted).toContain("12:00:00 PM");
    expect(restored.now().speed).toBe(2.5);
    await restored.close();
  });

  it("only advances simulated time forward", async () => {
    const clock = new Clock({ store: createInMemoryStore() });

    await expect(clock.advance(0)).rejects.toThrow(
      "Advance duration must be positive",
    );
    await expect(clock.advance(-1)).rejects.toThrow(
      "Advance duration must be positive",
    );
    await clock.close();
  });

  it("notifies listeners after a clock adjustment", async () => {
    const clock = new Clock({
      store: createInMemoryStore(),
      initialTime: "2026-10-21T12:00:00.000Z",
    });
    const events: Array<{ speed: number; simTime: number }> = [];
    const unsubscribe = clock.onClockChange((snapshot): void => {
      events.push({ speed: snapshot.speed, simTime: snapshot.simTime });
    });

    await clock.setSpeed(2);
    await clock.advance(60);
    unsubscribe();
    await clock.setSpeed(3);

    expect(events).toHaveLength(2);
    expect(events[0]?.speed).toBe(2);
    expect(events[1]?.speed).toBe(2);
    await clock.close();
  });

  it("shares time, speed, and listeners between clocks over one cell", async () => {
    const store = createInMemoryStore();
    const cell: ClockCell = {
      simTime: 0,
      anchorTime: 0,
      speed: 0,
      listeners: new Set(),
    };
    const serving = new Clock({
      store,
      cell,
      initialTime: "2026-10-21T08:00:00.000Z",
    });
    await serving.init();
    const running = new Clock({ store, cell });
    await running.init();
    const speeds: number[] = [];
    running.onClockChange((snapshot): void => {
      speeds.push(snapshot.speed);
    });

    await serving.setSpeed(0);
    const paused = running.time();
    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(running.now().speed).toBe(0);
    expect(running.time()).toBe(paused);
    expect(speeds).toEqual([0]);
    await running.persist();
    expect((await store.lookup("primary"))?.speed).toBe(0);
  });
});

describe("waiting on a paused world", () => {
  const paused = (speed = 0) => {
    const state = { speed };
    return {
      state,
      clock: { now: () => ({ simTime: 0, speed: state.speed, formatted: "" }) },
    };
  };

  it("holds a sim sleep while paused; a release lets go of it", async () => {
    const { clock } = paused();
    const release = new AbortController();
    let done: boolean | undefined;
    void sleepSim(clock, 1_000, new AbortController().signal, {
      release: release.signal,
      pollMs: 5,
    }).then((value) => (done = value));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(done).toBeUndefined();
    release.abort();
    await vi.waitFor(() => expect(done).toBe(false));
  });

  it("waits for the clock to run, or for a release", async () => {
    const { clock, state } = paused();
    let ran = false;
    void untilRunning(clock, undefined, 5).then(() => (ran = true));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(ran).toBe(false);
    state.speed = 1;
    await vi.waitFor(() => expect(ran).toBe(true));
    await untilRunning(paused().clock, AbortSignal.abort());
  });
});
