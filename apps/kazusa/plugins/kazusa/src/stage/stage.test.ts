import { describe, expect, it, vi } from "vitest";
import { stageControl, type StageEffects } from "./register.ts";
import { createStage, type StageRecord, type StageStore } from "./stage.ts";

const T0 = Date.parse("2026-10-24T12:00:00Z");
const HOUR = 3_600_000;

function memoryStore(): StageStore {
  const records = new Map<string, StageRecord>();
  return {
    lookup: async (key) => records.get(key),
    register: async (key, value) => {
      records.set(key, value);
    },
    entries: async () =>
      [...records].map(([key, value]) => ({ key, value, createdAt: T0 })),
  };
}

describe("stage", () => {
  it("uses the configured default until a character is switched", async () => {
    const stage = createStage(memoryStore(), { defaultOnstage: false });
    expect(await stage.isOnstage("airi")).toBe(false);
    expect(await stage.isOnstage("user:sensei")).toBe(true);
    await stage.set("airi", true, T0);
    expect(await stage.onstage(["natsu", "airi", "user:sensei"])).toEqual([
      "airi",
      "user:sensei",
    ]);
    await expect(stage.set("user:sensei", false, T0)).rejects.toThrow();
  });

  it("knows who was present at a moment around the last change", async () => {
    const stage = createStage(memoryStore(), { defaultOnstage: true });
    await stage.set("airi", false, T0);
    expect(await stage.presentAt("airi", T0 - 1)).toBe(true);
    expect(await stage.presentAt("airi", T0)).toBe(false);
    await stage.set("airi", true, T0 + HOUR);
    expect(await stage.presentAt("airi", T0 + HOUR / 2)).toBe(false);
    expect(await stage.presentAt("airi", T0 + HOUR)).toBe(true);
  });
});

describe("stageControl", () => {
  function setup() {
    const stage = createStage(memoryStore(), { defaultOnstage: true });
    let now = T0;
    const calls: string[] = [];
    const effects: StageEffects = {
      stage,
      clock: { init: async () => {}, time: () => now },
      interrupt: (id) => {
        calls.push(`interrupt ${id}`);
      },
      exit: async (id, at) => {
        calls.push(`exit ${id} ${at}`);
      },
      enter: async (id, at) => {
        calls.push(`enter ${id} ${at}`);
      },
      reschedule: async (id) => {
        calls.push(`reschedule ${id} ${String(await stage.isOnstage(id))}`);
      },
      resumeDesires: vi.fn(async (id, from, to) => {
        calls.push(`desires ${id} ${from}->${to}`);
      }),
      drain: async (id) => {
        calls.push(`drain ${id}`);
      },
    };
    return {
      set: stageControl(effects),
      calls,
      advance: (ms: number) => {
        now += ms;
      },
    };
  }

  it("goes offstage: stops talking, cancels the wake, leaves the place", async () => {
    const h = setup();
    await h.set("airi", false);
    expect(h.calls).toEqual([
      "interrupt airi",
      "reschedule airi false",
      `exit airi ${T0}`,
    ]);
  });

  it("comes back with desires resumed, a wake, and what waited", async () => {
    const h = setup();
    await h.set("airi", false);
    h.calls.length = 0;
    h.advance(5 * HOUR);
    await h.set("airi", true);
    expect(h.calls).toEqual([
      `desires airi ${T0}->${T0 + 5 * HOUR}`,
      `enter airi ${T0 + 5 * HOUR}`,
      "reschedule airi true",
      "drain airi",
    ]);
  });

  it("does nothing when the character is already there", async () => {
    const h = setup();
    await h.set("airi", true);
    expect(h.calls).toEqual([]);
  });
});
