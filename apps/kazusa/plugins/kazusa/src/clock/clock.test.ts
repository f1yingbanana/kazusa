import { describe, expect, it } from "vitest";
import { Clock } from "./clock.ts";
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
});
