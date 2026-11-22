import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import type { Clock } from "../clock/clock.ts";
vi.mock("../ledger.ts", () => ({ appendLedgerEntry: vi.fn(async () => {}) }));
import { appendLedgerEntry } from "../ledger.ts";
import { withJournalSeq, type KazusaRealtimeBroadcaster } from "../realtime.ts";
import { resetStateCaches } from "../state.ts";
import { registerTaskman, resetTaskWakes } from "./register.ts";
import type { ActiveTask } from "./types.ts";

const T0 = Date.parse("2026-10-27T16:00:00.000Z");

describe("taskman journal events", () => {
  it("broadcasts the ledger row's sim time, so a reread keeps the same seq", async () => {
    const tasks = new Map<string, ActiveTask>();
    const tools = new Map<
      string,
      { execute: (id: string, params: unknown) => Promise<unknown> }
    >();
    const api = {
      config: { agents: { entries: { alice: {} } } },
      pluginConfig: {},
      logger: { warn: vi.fn(), info: vi.fn() },
      lifecycle: {},
      on: () => {},
      registerTool: (
        factory: (ctx: { agentId: string }) => {
          name: string;
          execute: (id: string, params: unknown) => Promise<unknown>;
        },
      ) => {
        const tool = factory({ agentId: "alice" });
        tools.set(tool.name, tool);
      },
      runtime: {
        agent: { resolveAgentWorkspaceDir: () => undefined },
        state: {
          openKeyedStore: () => ({
            lookup: async (key: string) => tasks.get(key),
            register: async (key: string, value: ActiveTask) => {
              tasks.set(key, value);
            },
          }),
        },
      },
    } as unknown as OpenClawPluginApi;
    Object.assign(api, {
      runtime: { ...api.runtime, config: { current: () => api.config } },
    });
    // A running clock: every read is later than the one before.
    let now = T0;
    const clock = {
      init: async () => {},
      time: () => (now += 250),
      now: () => ({ simTime: now, speed: 1 }),
      onClockChange: () => () => {},
    } as unknown as Clock;
    const broadcast = vi.fn();
    registerTaskman(api, {
      clock,
      broadcaster: { broadcast } as unknown as KazusaRealtimeBroadcaster,
    });

    await tools.get("start_task")?.execute("call-1", {
      type: "studying",
      description: "Reading",
      duration: 60,
    });
    await tools.get("delay_task")?.execute("call-2", {
      minutesLeft: 65,
    });

    const reread = vi.mocked(appendLedgerEntry).mock.calls.map(([, entry]) => {
      const { kind, payload } = entry.metadata as {
        kind: string;
        payload: Record<string, unknown>;
      };
      return withJournalSeq({
        simTime: entry.timestamp,
        kind,
        actors: [entry.agentId],
        payload,
      });
    });
    expect(reread.map((row) => row.kind)).toEqual([
      "task.started",
      "task.delayed",
    ]);
    expect(broadcast.mock.calls.map(([{ event }]) => event.seq)).toEqual(
      reread.map((row) => row.seq),
    );
  });
});

describe("taskman wakes", () => {
  const task: ActiveTask = {
    id: "task-1",
    type: "studying",
    description: "Reading",
    duration: 60,
    startedAt: new Date(T0).toISOString(),
    endAt: new Date(T0 + 3_600_000).toISOString(),
  };
  const setup = () => {
    const tasks = new Map<string, ActiveTask>([["alice", task]]);
    const handlers = new Map<
      string,
      (event: unknown, ctx: unknown) => unknown
    >();
    const api = {
      config: { agents: { entries: { alice: {}, bob: {} } } },
      pluginConfig: {},
      logger: { warn: vi.fn(), info: vi.fn() },
      lifecycle: {},
      on: (name: string, handler: (event: unknown, ctx: unknown) => unknown) =>
        handlers.set(name, handler),
      registerTool: () => {},
      runtime: {
        agent: { resolveAgentWorkspaceDir: () => undefined },
        state: {
          openKeyedStore: () => ({
            lookup: async (key: string) => tasks.get(key),
            register: async (key: string, value: ActiveTask) => {
              tasks.set(key, value);
            },
            entries: async () =>
              [...tasks].map(([key, value]) => ({ key, value, createdAt: 0 })),
          }),
        },
      },
    } as unknown as OpenClawPluginApi;
    Object.assign(api, {
      runtime: { ...api.runtime, config: { current: () => api.config } },
    });
    const state = { speed: 1, sim: T0, wall: T0 };
    const listeners: (() => unknown)[] = [];
    const clock = {
      init: async () => {},
      time: () => state.sim + (Date.now() - state.wall) * state.speed,
      now: () => ({ simTime: T0, speed: state.speed }),
      onClockChange: (listener: () => unknown) => {
        listeners.push(listener);
        return () => {};
      },
    } as unknown as Clock;
    const offstage = new Set<string>();
    const stage = { gate: undefined as Promise<void> | undefined };
    const taskman = registerTaskman(api, {
      clock,
      stage: {
        isSimulated: async (id) => {
          await stage.gate;
          return !offstage.has(id);
        },
        simulated: async (ids) => ids.filter((id) => !offstage.has(id)),
      },
    });
    const woken: string[] = [];
    taskman.wakeWith((id) => woken.push(id));
    return {
      handlers,
      taskman,
      woken,
      offstage,
      state,
      listeners,
      tasks,
      stage,
    };
  };

  beforeEach(() => {
    resetTaskWakes();
    resetStateCaches();
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });
  afterEach(() => {
    resetTaskWakes();
    vi.useRealTimers();
  });

  it("wakes an onstage character when their activity ends, never an offstage one", async () => {
    const { handlers, taskman, woken, offstage } = setup();
    offstage.add("alice");
    await handlers.get("gateway_start")?.({}, {});
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(woken).toEqual([]);

    // Back onstage after the end: woken at once.
    offstage.delete("alice");
    await taskman.reschedule("alice");
    await vi.advanceTimersByTimeAsync(0);
    expect(woken).toEqual(["alice"]);
  });

  it("holds wakes while paused and keeps them when play resumes", async () => {
    const { handlers, woken, state, listeners } = setup();
    await handlers.get("gateway_start")?.({}, {});
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    Object.assign(state, { speed: 0, sim: T0 + 30 * 60_000, wall: Date.now() });
    listeners.forEach((listener) => listener());
    await vi.advanceTimersByTimeAsync(3 * 3_600_000);
    expect(woken).toEqual([]);
    Object.assign(state, { speed: 1, wall: Date.now() });
    listeners.forEach((listener) => listener());
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(woken).toEqual(["alice"]);
  });

  it("never lets an older read replace a newer end", async () => {
    const { handlers, taskman, woken, stage } = setup();
    let open!: () => void;
    stage.gate = new Promise((resolve) => (open = resolve));
    // The start-up pass reads the old lease, then waits on the stage...
    const starting = handlers.get("gateway_start")?.({}, {});
    await vi.advanceTimersByTimeAsync(0);
    // ...while a task tool replaces it with one ending two hours later.
    await taskman.store.register("alice", {
      ...task,
      endAt: new Date(T0 + 3 * 3_600_000).toISOString(),
    });
    // Its own stage check answers at once, so it sets the new end first.
    stage.gate = undefined;
    await taskman.reschedule("alice");
    open();
    await starting;
    await vi.advanceTimersByTimeAsync(2 * 3_600_000);
    expect(woken).toEqual([]);
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(woken).toEqual(["alice"]);
  });

  it("wakes through the newest handler until it stops, and removes a world's old wake cron jobs", async () => {
    const { handlers, taskman, woken } = setup();
    const stopSecond = taskman.wakeWith(() => woken.push("second"));
    await handlers.get("gateway_start")?.({}, {});
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(woken).toEqual(["second"]);
    stopSecond();
    await handlers.get("gateway_start")?.({}, {});
    await vi.advanceTimersByTimeAsync(0);
    expect(woken).toEqual(["second", "alice"]);

    const jobs = [
      { id: "1", declarationKey: "alice", name: "Wake alice" },
      { id: "2", declarationKey: "dreaming", name: "Dreaming" },
      { id: "3", declarationKey: "bob", name: "Something bob set up" },
    ];
    const cron = {
      list: async () => jobs,
      remove: vi.fn(async (id: string) => {
        jobs.splice(
          jobs.findIndex((job) => job.id === id),
          1,
        );
      }),
    };
    await handlers.get("cron_reconciled")?.(
      { enabled: true },
      { abortSignal: new AbortController().signal, getCron: () => cron },
    );
    expect(jobs.map(({ id }) => id)).toEqual(["2", "3"]);
  });
});
