import { describe, expect, it, vi } from "vitest";
import {
  playControl,
  stageControl,
  type PlayEffects,
  type StageEffects,
} from "./register.ts";
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
  it("keeps a chosen cast onstage when others start off", async () => {
    const stage = createStage(memoryStore(), {
      defaultOnstage: false,
      cast: ["airi"],
    });
    expect(await stage.isOnstage("airi")).toBe(true);
    expect(await stage.isOnstage("natsu")).toBe(false);
    expect(await stage.presentAt("airi", 0)).toBe(true);
    await stage.set("airi", false, 10);
    expect(await stage.isOnstage("airi")).toBe(false);
  });

  it("uses the configured default until a character is switched", async () => {
    const stage = createStage(memoryStore(), {
      defaultOnstage: false,
      cast: [],
    });
    expect(await stage.isOnstage("airi")).toBe(false);
    await stage.set("airi", true, T0);
    expect(await stage.onstage(["natsu", "airi"])).toEqual(["airi"]);
  });

  it("keeps a played character onstage but out of their model's hands", async () => {
    const stage = createStage(memoryStore(), {
      defaultOnstage: true,
      cast: [],
    });
    await stage.setPlayer("airi", "user:sensei", T0);
    expect(await stage.isOnstage("airi")).toBe(true);
    expect(await stage.isSimulated("airi")).toBe(false);
    expect(await stage.simulated(["airi", "natsu"])).toEqual(["natsu"]);
    expect(await stage.playing("user:sensei")).toBe("airi");
    await expect(stage.set("airi", false, T0)).rejects.toThrow(/played/);
    await expect(stage.setPlayer("airi", "user:other", T0)).rejects.toThrow(
      /already/,
    );
    await expect(stage.setPlayer("natsu", "user:sensei", T0)).rejects.toThrow(
      /someone else/,
    );
    await stage.setPlayer("airi", undefined, T0 + HOUR);
    expect(await stage.isSimulated("airi")).toBe(true);
    expect(await stage.playing("user:sensei")).toBeUndefined();
  });

  it("finds who plays whom from the records, once", async () => {
    const store = memoryStore();
    await store.register("airi", {
      onstage: true,
      since: T0,
      playedBy: "user:sensei",
      playedSince: T0,
    });
    const stage = createStage(store, { defaultOnstage: true, cast: [] });
    expect(await stage.playing("user:sensei")).toBe("airi");
  });

  it("knows who was present at a moment around the last change", async () => {
    const stage = createStage(memoryStore(), {
      defaultOnstage: true,
      cast: [],
    });
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
    const stage = createStage(memoryStore(), {
      defaultOnstage: true,
      cast: [],
    });
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
      forgetSightings: async (id) => {
        calls.push(`forget ${id}`);
      },
      enter: async (id, at, together) => {
        calls.push(`enter ${id} ${at} [${together.join()}]`);
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
      "forget airi",
    ]);
  });

  it("comes back with desires resumed, a wake, and what waited", async () => {
    const h = setup();
    await h.set("airi", false);
    h.calls.length = 0;
    h.advance(5 * HOUR);
    await h.set("airi", true, ["airi", "natsu"]);
    expect(h.calls).toEqual([
      `desires airi ${T0}->${T0 + 5 * HOUR}`,
      `enter airi ${T0 + 5 * HOUR} [airi,natsu]`,
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

describe("playControl", () => {
  function setup(defaultOnstage = true) {
    const stage = createStage(memoryStore(), { defaultOnstage, cast: [] });
    let now = T0;
    const calls: string[] = [];
    const effects: PlayEffects = {
      stage,
      clock: { init: async () => {}, time: () => now },
      bringOn: async (id, person) => {
        await stage.set(id, true, now, person);
        calls.push(`on ${id}`);
      },
      stop: (id) => {
        calls.push(`stop ${id}`);
      },
      endActivity: async (id, at) => {
        calls.push(`end ${id} ${at}`);
      },
      reschedule: async (id) => {
        calls.push(`reschedule ${id} ${String(await stage.isSimulated(id))}`);
      },
      resumeDesires: async (id, from, to) => {
        calls.push(`desires ${id} ${from}->${to}`);
      },
      drain: async (id) => {
        calls.push(`drain ${id}`);
      },
      handBack: async (id, since) => {
        calls.push(`hand back ${id} ${since}`);
      },
      changed: (person, id) => {
        calls.push(`changed ${person} ${id ?? "-"}`);
      },
    };
    return {
      play: playControl(effects),
      stage,
      calls,
      advance: (ms: number) => {
        now += ms;
      },
    };
  }

  it("takes a character over: stops them, ends their activity, no wake", async () => {
    const h = setup();
    await h.play("user:sensei", "airi");
    expect(h.calls).toEqual([
      "stop airi",
      `end airi ${T0}`,
      "reschedule airi false",
      "drain airi",
      "changed user:sensei airi",
    ]);
  });

  it("hands the one left back before taking the next", async () => {
    const h = setup();
    await h.play("user:sensei", "airi");
    h.calls.length = 0;
    h.advance(HOUR);
    await h.play("user:sensei", "natsu");
    expect(h.calls).toEqual([
      `desires airi ${T0}->${T0 + HOUR}`,
      "reschedule airi true",
      `hand back airi ${T0}`,
      "stop natsu",
      `end natsu ${T0 + HOUR}`,
      "reschedule natsu false",
      "drain natsu",
      "changed user:sensei natsu",
    ]);
  });

  it("watches: hands back and plays nobody", async () => {
    const h = setup();
    await h.play("user:sensei", "airi");
    h.calls.length = 0;
    await h.play("user:sensei", undefined);
    expect(h.calls.at(-1)).toBe("changed user:sensei -");
    expect(await h.stage.playing("user:sensei")).toBeUndefined();
  });

  it("brings an offstage character on already played", async () => {
    const h = setup(false);
    await h.play("user:sensei", "airi");
    expect(h.calls[0]).toBe("on airi");
    expect(await h.stage.isSimulated("airi")).toBe(false);
  });

  it("finishes a switch whose effect fails, and says so", async () => {
    const stage = createStage(memoryStore(), {
      defaultOnstage: true,
      cast: [],
    });
    const warned: string[] = [];
    const calls: string[] = [];
    const play = playControl({
      stage,
      clock: { init: async () => {}, time: () => T0 },
      bringOn: async () => {},
      stop: () => {},
      endActivity: async () => {
        throw new Error("database still starting");
      },
      reschedule: async (id) => {
        calls.push(`reschedule ${id}`);
      },
      resumeDesires: async () => {},
      drain: async (id) => {
        calls.push(`drain ${id}`);
      },
      handBack: async () => {},
      warn: (message) => warned.push(message),
    });
    await play("user:sensei", "airi");
    expect(await stage.playing("user:sensei")).toBe("airi");
    expect(calls).toEqual(["reschedule airi", "drain airi"]);
    expect(warned).toEqual([
      "Playing airi: ending their activity failed: Error: database still starting",
    ]);
  });

  it("never puts two people in one character", async () => {
    const h = setup();
    await h.play("user:sensei", "airi");
    await expect(h.play("user:other", "airi")).rejects.toThrow(/already/);
  });
});
