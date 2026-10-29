import { describe, expect, it, vi } from "vitest";
import { startIdleSupervisor, type SupervisorCell } from "./supervisor.ts";
import type { ActiveTask, TaskStore } from "./types.ts";
import type { Clock } from "../clock/clock.ts";
import type { Perception } from "../perception/perception.ts";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";

function createMockClock(simTime = 1_000_000, speed = 1): Clock {
  return {
    init: vi.fn().mockResolvedValue(undefined),
    time: () => simTime,
    now: () => ({ simTime, speed, updatedAt: Date.now() }),
    setSpeed: vi.fn(),
    advance: vi.fn(),
    onClockChange: vi.fn().mockReturnValue(() => {}),
  } as unknown as Clock;
}

function createMockTaskStore(
  initial: Record<string, ActiveTask> = {},
): TaskStore {
  const tasks = new Map<string, ActiveTask>(Object.entries(initial));
  return {
    lookup: async (key: string) => tasks.get(key),
    register: async (key: string, value: ActiveTask) => {
      tasks.set(key, value);
    },
    entries: async () =>
      [...tasks.entries()].map(([key, value]) => ({
        key,
        value,
        createdAt: 0,
      })),
  };
}

describe("startIdleSupervisor", () => {
  it("does not wake agents if clock is paused (speed <= 0)", async () => {
    vi.useFakeTimers();
    try {
      const clock = createMockClock(1_000_000, 0);
      const store = createMockTaskStore();
      const idleWake = vi.fn().mockResolvedValue(undefined);
      const perception = {
        getBrainState: vi.fn().mockResolvedValue({ brain: "idle", queued: 0 }),
        idleWake,
      } as unknown as Perception;

      const api = {
        config: { agents: { list: [{ id: "alice" }] } },
        logger: { warn: vi.fn() },
      } as unknown as OpenClawPluginApi;
      Object.assign(api, {
        runtime: { ...api.runtime, config: { current: () => api.config } },
      });

      const dispose = startIdleSupervisor(api, {
        clock,
        store,
        perception,
        intervalMs: 10_000,
      });

      // Advance past startup delay
      await vi.advanceTimersByTimeAsync(2500);
      expect(idleWake).not.toHaveBeenCalled();

      dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("wakes an agent with no task and an idle brain", async () => {
    vi.useFakeTimers();
    try {
      const clock = createMockClock(1_000_000, 1);
      const store = createMockTaskStore();
      const idleWake = vi.fn().mockResolvedValue(undefined);
      const perception = {
        getBrainState: vi.fn().mockResolvedValue({ brain: "idle", queued: 0 }),
        idleWake,
      } as unknown as Perception;

      const api = {
        config: { agents: { list: [{ id: "alice" }] } },
        logger: { warn: vi.fn() },
      } as unknown as OpenClawPluginApi;
      Object.assign(api, {
        runtime: { ...api.runtime, config: { current: () => api.config } },
      });

      const dispose = startIdleSupervisor(api, {
        clock,
        store,
        perception,
        intervalMs: 10_000,
      });

      await vi.advanceTimersByTimeAsync(2500);
      expect(idleWake).toHaveBeenCalledWith("alice");

      dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("never checks in on an offstage character", async () => {
    vi.useFakeTimers();
    try {
      const idleWake = vi.fn().mockResolvedValue(undefined);
      const perception = {
        getBrainState: vi.fn().mockResolvedValue({ brain: "idle", queued: 0 }),
        idleWake,
      } as unknown as Perception;
      const api = {
        config: { agents: { list: [{ id: "alice" }, { id: "bob" }] } },
        logger: { warn: vi.fn() },
      } as unknown as OpenClawPluginApi;
      Object.assign(api, {
        runtime: { ...api.runtime, config: { current: () => api.config } },
      });

      const dispose = startIdleSupervisor(api, {
        clock: createMockClock(1_000_000, 1),
        store: createMockTaskStore(),
        perception,
        intervalMs: 10_000,
        stage: {
          onstage: async (ids) => ids.filter((id) => id !== "alice"),
        },
      });

      await vi.advanceTimersByTimeAsync(2500);
      expect(idleWake.mock.calls).toEqual([["bob"]]);

      dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("skips agents that already have an active unexpired task", async () => {
    vi.useFakeTimers();
    try {
      const clock = createMockClock(1_000_000, 1);
      const store = createMockTaskStore({
        alice: {
          id: "task-1",
          type: "working",
          description: "Reading",
          duration: 10,
          startedAt: new Date(900_000).toISOString(),
          endAt: new Date(1_500_000).toISOString(),
        },
      });
      const idleWake = vi.fn().mockResolvedValue(undefined);
      const perception = {
        getBrainState: vi.fn().mockResolvedValue({ brain: "idle", queued: 0 }),
        idleWake,
      } as unknown as Perception;

      const api = {
        config: { agents: { list: [{ id: "alice" }] } },
        logger: { warn: vi.fn() },
      } as unknown as OpenClawPluginApi;
      Object.assign(api, {
        runtime: { ...api.runtime, config: { current: () => api.config } },
      });

      const dispose = startIdleSupervisor(api, {
        clock,
        store,
        perception,
        intervalMs: 10_000,
      });

      await vi.advanceTimersByTimeAsync(2500);
      expect(idleWake).not.toHaveBeenCalled();

      dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("skips agents when brain is thinking or has queued stimuli", async () => {
    vi.useFakeTimers();
    try {
      const clock = createMockClock(1_000_000, 1);
      const store = createMockTaskStore();
      const idleWake = vi.fn().mockResolvedValue(undefined);

      const perception = {
        getBrainState: vi.fn((agentId: string) => {
          if (agentId === "busy-thinker")
            return Promise.resolve({ brain: "thinking", queued: 0 });
          if (agentId === "busy-queue")
            return Promise.resolve({ brain: "idle", queued: 2 });
          return Promise.resolve({ brain: "idle", queued: 0 });
        }),
        idleWake,
      } as unknown as Perception;

      const api = {
        config: {
          agents: {
            list: [
              { id: "busy-thinker" },
              { id: "busy-queue" },
              { id: "free-agent" },
            ],
          },
        },
        logger: { warn: vi.fn() },
      } as unknown as OpenClawPluginApi;
      Object.assign(api, {
        runtime: { ...api.runtime, config: { current: () => api.config } },
      });

      const dispose = startIdleSupervisor(api, {
        clock,
        store,
        perception,
        intervalMs: 10_000,
        maxAgentsPerTick: 5,
      });

      await vi.advanceTimersByTimeAsync(2500);
      expect(idleWake).toHaveBeenCalledTimes(1);
      expect(idleWake).toHaveBeenCalledWith("free-agent");

      dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("limits woken agents to maxAgentsPerTick", async () => {
    vi.useFakeTimers();
    try {
      const clock = createMockClock(1_000_000, 1);
      const store = createMockTaskStore();
      const idleWake = vi.fn().mockResolvedValue(undefined);
      const perception = {
        getBrainState: vi.fn().mockResolvedValue({ brain: "idle", queued: 0 }),
        idleWake,
      } as unknown as Perception;

      const api = {
        config: {
          agents: {
            list: [{ id: "a1" }, { id: "a2" }, { id: "a3" }, { id: "a4" }],
          },
        },
        logger: { warn: vi.fn() },
      } as unknown as OpenClawPluginApi;
      Object.assign(api, {
        runtime: { ...api.runtime, config: { current: () => api.config } },
      });

      const dispose = startIdleSupervisor(api, {
        clock,
        store,
        perception,
        intervalMs: 10_000,
        maxAgentsPerTick: 2,
      });

      await vi.advanceTimersByTimeAsync(2500);
      expect(idleWake).toHaveBeenCalledTimes(2);

      dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("cleans up timers on dispose", async () => {
    vi.useFakeTimers();
    try {
      const clock = createMockClock(1_000_000, 1);
      const store = createMockTaskStore();
      const idleWake = vi.fn().mockResolvedValue(undefined);
      const perception = {
        getBrainState: vi.fn().mockResolvedValue({ brain: "idle", queued: 0 }),
        idleWake,
      } as unknown as Perception;

      const api = {
        config: { agents: { list: [{ id: "alice" }] } },
        logger: { warn: vi.fn() },
      } as unknown as OpenClawPluginApi;
      Object.assign(api, {
        runtime: { ...api.runtime, config: { current: () => api.config } },
      });

      const dispose = startIdleSupervisor(api, {
        clock,
        store,
        perception,
        intervalMs: 10_000,
      });

      dispose();

      // Advancing time should not fire tick
      await vi.advanceTimersByTimeAsync(50_000);
      expect(idleWake).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("passes configured idleText to idleWake", async () => {
    vi.useFakeTimers();
    try {
      const clock = createMockClock(1_000_000, 1);
      const store = createMockTaskStore();
      const idleWake = vi.fn().mockResolvedValue(undefined);
      const perception = {
        getBrainState: vi.fn().mockResolvedValue({ brain: "idle", queued: 0 }),
        idleWake,
      } as unknown as Perception;

      const api = {
        config: { agents: { list: [{ id: "alice" }] } },
        logger: { warn: vi.fn() },
      } as unknown as OpenClawPluginApi;
      Object.assign(api, {
        runtime: { ...api.runtime, config: { current: () => api.config } },
      });

      const dispose = startIdleSupervisor(api, {
        clock,
        store,
        perception,
        intervalMs: 10_000,
        idleText: "Time to plan your day.",
      });

      await vi.advanceTimersByTimeAsync(2500);
      expect(idleWake).toHaveBeenCalledWith("alice", "Time to plan your day.");

      dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("wakes once per interval however many registrations started one", async () => {
    // Live: each plugin registration ran its own supervisor, so an idle
    // character got one check-in per registration.
    vi.useFakeTimers();
    try {
      const idleWake = vi.fn().mockResolvedValue(undefined);
      const perception = {
        getBrainState: vi.fn().mockResolvedValue({ brain: "idle", queued: 0 }),
        idleWake,
      } as unknown as Perception;
      const api = {
        config: { agents: { list: [{ id: "alice" }] } },
        logger: { warn: vi.fn() },
      } as unknown as OpenClawPluginApi;
      Object.assign(api, {
        runtime: { ...api.runtime, config: { current: () => api.config } },
      });
      const cell: SupervisorCell = { running: false, lastTickAt: 0 };
      const stops = [1, 2, 3].map(() =>
        startIdleSupervisor(api, {
          clock: createMockClock(1_000_000, 1),
          store: createMockTaskStore(),
          perception,
          intervalMs: 10_000,
          cell,
        }),
      );
      await vi.advanceTimersByTimeAsync(2500);
      expect(idleWake).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(idleWake).toHaveBeenCalledTimes(2);
      for (const stop of stops) stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
