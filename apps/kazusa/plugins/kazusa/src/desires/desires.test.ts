import { describe, expect, it, vi } from "vitest";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import type { Clock } from "../clock/clock.ts";
import { executeDelayTask, executeStartTask } from "../taskman/taskman.ts";
import type {
  ActiveTask,
  TaskStore,
  ToolExecutionContext,
} from "../taskman/types.ts";
import { DESIRES_CONFIG } from "./config.ts";
import {
  anchorAt,
  afterwardsParameter,
  feelingsLine,
  levelsAt,
  startEffects,
  type DesireRecord,
} from "./desires.ts";
import { registerDesires } from "./register.ts";

const config = DESIRES_CONFIG.parse({});
const T0 = Date.parse("2026-10-27T08:00:00.000Z");
const minutes = (n: number): number => T0 + n * 60_000;

function createInMemoryStore<T>() {
  const values = new Map<string, T>();
  return {
    values,
    async lookup(key: string): Promise<T | undefined> {
      return values.get(key);
    },
    async register(key: string, value: T): Promise<void> {
      values.set(key, value);
    },
    async entries() {
      return [...values.entries()].map(([key, value]) => ({
        key,
        value,
        createdAt: 0,
      }));
    },
  };
}

/** A fresh record at T0 with satiety at `satiety`. */
function recordWithSatiety(satiety: number): DesireRecord {
  const record = anchorAt(config, undefined, T0);
  return { ...record, levels: { ...record.levels, satiety } };
}

describe("desire levels", () => {
  it("starts in the initial state and drains linearly, clamped at 0", () => {
    const record = anchorAt(config, undefined, T0);
    expect(record.levels.satiety).toBe(65);
    // satiety drains 8 points per hour.
    expect(levelsAt(config, record, minutes(300)).satiety).toBe(25);
    expect(levelsAt(config, record, minutes(1200)).satiety).toBe(0);
  });

  it("uses per-character drain overrides", () => {
    const record = {
      ...anchorAt(config, undefined, T0),
      drain: { satiety: 1 },
    };
    expect(levelsAt(config, record, minutes(60)).satiety).toBe(64);
  });

  it("moves toward the target state by the planned end, then drains", () => {
    const record = startEffects(
      config,
      recordWithSatiety(25),
      { id: "meal", until: minutes(30) },
      { satiety: "full" },
    );
    expect(levelsAt(config, record, minutes(15)).satiety).toBe(62.5);
    expect(levelsAt(config, record, minutes(30)).satiety).toBe(100);
    expect(levelsAt(config, record, minutes(90)).satiety).toBe(92);
    // Unlisted desires keep draining: energy drains 4 per hour.
    expect(levelsAt(config, record, minutes(30)).energy).toBe(63);
  });

  it("moves down toward a lower target and holds there", () => {
    const record = startEffects(
      config,
      anchorAt(config, undefined, T0),
      { id: "party", until: minutes(120) },
      { social: "low" },
    );
    expect(levelsAt(config, record, minutes(60)).social).toBe(50);
    expect(levelsAt(config, record, minutes(120)).social).toBe(35);
  });

  it("treats a target in the current state as no change", () => {
    const record = startEffects(
      config,
      { ...anchorAt(config, undefined, T0), levels: { energy: 30 } },
      { id: "late night", until: minutes(60) },
      { energy: "low", satiety: "fine" },
    );
    expect(record.effects).toBeUndefined();
    expect(levelsAt(config, record, minutes(60)).energy).toBe(26);
  });

  it("leaves an interrupted effect where it got to", () => {
    const meal = startEffects(
      config,
      recordWithSatiety(25),
      { id: "meal", until: minutes(30) },
      { satiety: "full" },
    );
    const interrupted = startEffects(
      config,
      anchorAt(config, meal, minutes(15)),
      { id: "chat", until: minutes(75) },
      {},
    );
    expect(interrupted.effects).toBeUndefined();
    expect(levelsAt(config, interrupted, minutes(75)).satiety).toBe(54.5);
  });

  it("restates effects on delay, from the current level", () => {
    const meal = startEffects(
      config,
      recordWithSatiety(25),
      { id: "meal", until: minutes(30) },
      { satiety: "fine" },
    );
    // Reached 65 at the planned end, then drained 4 points by minute 60.
    const delayed = startEffects(
      config,
      anchorAt(config, meal, minutes(60)),
      { id: "meal", until: minutes(90) },
      { satiety: "full" },
    );
    expect(delayed.levels.satiety).toBe(61);
    expect(levelsAt(config, delayed, minutes(75)).satiety).toBe(80.5);
    expect(levelsAt(config, delayed, minutes(90)).satiety).toBe(100);
  });
});

describe("desire rendering", () => {
  it("renders every desire as a state word, in catalog order", () => {
    const levels = { ...anchorAt(config, undefined, T0).levels, satiety: 30 };
    expect(feelingsLine(config, levels)).toBe(
      "energy: fine · satiety: low · social: fine · stimulation: fine · composure: fine · purpose: fine · expression: fine",
    );
  });

  it("names each desire with its description once", () => {
    const parameter = afterwardsParameter(config) as {
      description: string;
      propertyNames: { enum: string[] };
      additionalProperties: { enum: string[] };
    };
    expect(parameter.propertyNames.enum).toEqual(
      config.catalog.map(({ name }) => name),
    );
    expect(parameter.additionalProperties.enum).toHaveLength(12);
    expect(parameter.additionalProperties.enum).toContain("low→full");
    expect(parameter.additionalProperties.enum).not.toContain("low→low");
    for (const { name, description } of config.catalog) {
      expect(parameter.description).toContain(`${name}: ${description}`);
    }
  });
});

describe("desire config", () => {
  it("rejects states that do not partition the scale", () => {
    expect(
      DESIRES_CONFIG.safeParse({
        states: [
          { name: "low", min: 10, level: 20 },
          { name: "high", min: 50, level: 40 },
        ],
        initial: "low",
      }).success,
    ).toBe(false);
  });

  it("rejects an unknown initial state and duplicate desires", () => {
    expect(DESIRES_CONFIG.safeParse({ initial: "ok" }).success).toBe(false);
    expect(
      DESIRES_CONFIG.safeParse({
        catalog: [
          { name: "energy", description: "a", drain: 1 },
          { name: "energy", description: "b", drain: 2 },
        ],
      }).success,
    ).toBe(false);
  });
});

describe("registerDesires", () => {
  function setup() {
    const desireStore = createInMemoryStore<DesireRecord>();
    const methods: Record<
      string,
      (options: {
        params: unknown;
        respond: (ok: boolean, payload: unknown, error: unknown) => void;
      }) => Promise<void>
    > = {};
    let now = T0;
    const api = {
      config: { agents: { entries: { kazusa: {} } } },
      pluginConfig: {},
      runtime: { state: { openKeyedStore: () => desireStore } },
      registerGatewayMethod: vi.fn((name: string, handler) => {
        methods[name] = handler;
      }),
    } as unknown as OpenClawPluginApi;
    const clock = {
      init: vi.fn(async () => {}),
      time: () => now,
    } as unknown as Clock;
    const desires = registerDesires(api, { clock });
    const taskStore: TaskStore = createInMemoryStore<ActiveTask>();
    const context: ToolExecutionContext = {
      agentId: "kazusa",
      store: taskStore,
      clock: { time: () => now },
      minDuration: 10,
      beforeCommit: (transition) =>
        desires.taskExtension.beforeCommit(transition),
      appendTaskLedgerEntry: async () => {},
    };
    const call = async (name: string, params: unknown) => {
      let result: { ok: boolean; payload: unknown; error: unknown } | undefined;
      await methods[name]?.({
        params,
        respond: (ok, payload, error) => {
          result = { ok, payload, error };
        },
      });
      return result;
    };
    return {
      desires,
      desireStore,
      taskStore,
      context,
      call,
      setNow: (at: number) => {
        now = at;
      },
    };
  }

  it("applies start_task effects through the Taskman extension", async () => {
    const { desires, context, setNow } = setup();
    const result = await executeStartTask(
      {
        type: "eating",
        description: "Macarons at the cafe",
        duration: 30,
        afterwards: { satiety: "fine→full" },
      },
      context,
    );
    expect(result.success).toBe(true);
    setNow(minutes(30));
    expect(await desires.feelings("kazusa", minutes(30))).toContain(
      "satiety: full",
    );
  });

  it("lets delay_task restate effects until the new end", async () => {
    const { desireStore, context, setNow } = setup();
    await executeStartTask(
      {
        type: "eating",
        description: "Lunch",
        duration: 30,
        afterwards: { satiety: "fine→full" },
      },
      context,
    );
    setNow(minutes(10));
    await executeDelayTask(
      {
        additionalDuration: 30,
        afterwards: { satiety: "fine→full", social: "fine→full" },
      },
      context,
    );
    const effects = desireStore.values.get("kazusa")?.effects;
    expect(effects?.until).toBe(minutes(60));
    expect(Object.keys(effects?.byDesire ?? {})).toEqual(["satiety", "social"]);
  });

  it("requires effects, accepting none as an empty object", async () => {
    const { context } = setup();
    const missing = await executeStartTask(
      { type: "working", description: "Homework", duration: 30 },
      context,
    );
    expect(missing.success).toBe(false);
    const none = await executeStartTask(
      {
        type: "working",
        description: "Homework",
        duration: 30,
        afterwards: {},
      },
      context,
    );
    expect(none.success).toBe(true);
  });

  it("refuses invalid effects without writing a lease", async () => {
    const { taskStore, context } = setup();
    const result = await executeStartTask(
      {
        type: "eating",
        description: "Lunch",
        duration: 30,
        afterwards: { satiety: "fine→stuffed" },
      },
      context,
    );
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/^Task not started: invalid afterwards/u);
    expect(await taskStore.lookup("kazusa")).toBeUndefined();
  });

  it("configures drain and levels and reports states over RPC", async () => {
    const { call } = setup();
    const configured = await call("desires.configure", {
      agentId: "kazusa",
      drain: { social: 0 },
      levels: { satiety: "low", energy: 90 },
    });
    expect(configured?.ok).toBe(true);
    const got = (await call("desires.get", { agentId: "kazusa" }))?.payload as {
      desires: Record<string, { level: number; state: string }>;
      drain: Record<string, number>;
    };
    expect(got.desires.satiety).toEqual({ level: 35, state: "low" });
    expect(got.desires.energy).toEqual({ level: 90, state: "full" });
    expect(got.drain.social).toBe(0);

    await call("desires.configure", {
      agentId: "kazusa",
      drain: { social: null },
    });
    const reset = (await call("desires.get", { agentId: "kazusa" }))
      ?.payload as { drain: Record<string, number> };
    expect(reset.drain.social).toBe(2);
  });

  it("rejects unknown characters and desires", async () => {
    const { call } = setup();
    expect((await call("desires.get", { agentId: "nobody" }))?.ok).toBe(false);
    expect(
      (
        await call("desires.configure", {
          agentId: "kazusa",
          levels: { mana: 10 },
        })
      )?.ok,
    ).toBe(false);
  });
});
