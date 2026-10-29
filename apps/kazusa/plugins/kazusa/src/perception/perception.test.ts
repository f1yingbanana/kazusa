import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { AsyncLocalStorage } from "node:async_hooks";
import { z } from "zod";
import { stimulusKey } from "../stimulus.ts";
import type { DecisionContextRequest } from "../context-engine/decision-context.ts";
import {
  assembleDecisionBatch,
  textTokens,
} from "../context-engine/decision-context.ts";
import type { DecisionBatch } from "openclaw/plugin-sdk/decisions";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActiveTask } from "../taskman/types.ts";
import {
  PERCEPTION_CONFIG,
  latencyMs,
  type PerceptionConfig,
  type PerceptionDecisionRecord,
  type Stimulus,
} from "./types.ts";
import {
  Perception,
  type PerceptionDeps,
  type PerceptionDelivery,
  type PerceptionState,
} from "./perception.ts";

const NOW = Date.parse("2026-10-24T12:00:00Z");

function stimulus(
  id: string,
  agentId = "alice",
  text = `Message ${id}`,
): Stimulus {
  return {
    id,
    sessionKey: `agent:${agentId}:chat:direct:bob`,
    sender: "bob",
    text,
    timestamp: NOW,
  };
}

type SetupOptions = Partial<PerceptionConfig> & {
  assembleDecisionContext?: PerceptionDeps["assembleDecisionContext"];
  confirm?: PerceptionDeps["confirm"];
  onstage?: PerceptionDeps["onstage"];
  systemAgentId?: string;
};

function setup(options: SetupOptions = {}) {
  // One "perception" namespace: character states and decision entries.
  const states = new Map<string, PerceptionState>();
  const decisions = new Map<string, PerceptionDecisionRecord>();
  const namespaceEntries = () =>
    [...states, ...decisions].map(([key, value]) => ({
      key,
      createdAt: NOW,
      value: structuredClone(value),
    }));
  const tasks = new Map<string, ActiveTask>();
  let simTime = NOW;
  let speed = 1;
  const deliveries: PerceptionDelivery[] = [];

  const deliver = vi.fn<NonNullable<PerceptionDeps["deliver"]>>(
    async (d, lifecycle) => {
      deliveries.push(structuredClone(d));
      await lifecycle.onAdopted();
    },
  );

  const evaluateDecision = vi.fn();
  const assertCurrent = vi.fn();

  const stateStore = {
    lookup: async (key: string) => structuredClone(states.get(key)),
    register: async (key: string, value: PerceptionState) => {
      z.json().parse(value);
      states.set(key, structuredClone(value));
    },
    entries: async () =>
      namespaceEntries().map((entry) => ({
        ...entry,
        value: entry.value as PerceptionState,
      })),
  };
  const decisionStore = {
    lookup: async (key: string) => structuredClone(decisions.get(key)),
    register: async (key: string, value: PerceptionDecisionRecord) => {
      z.json().parse(value);
      decisions.set(key, structuredClone(value));
    },
    entries: async () =>
      namespaceEntries().map((entry) => ({
        ...entry,
        value: entry.value as PerceptionDecisionRecord,
      })),
  };

  const { confirm, onstage, systemAgentId, ...configOptions } = options;
  const config = PERCEPTION_CONFIG.parse({
    coalesceWindowMs: 0, // synchronous draining for most tests
    ...configOptions,
  });

  const assembleDecisionContext: NonNullable<
    PerceptionDeps["assembleDecisionContext"]
  > =
    options.assembleDecisionContext ??
    vi.fn(async (id: string, params: DecisionContextRequest) => ({
      state: {
        character: { id },
        currentActivity: params.activeTask
          ? {
              type: params.activeTask.type,
              description: params.activeTask.description,
            }
          : null,
        brainStatus: params.brainStatus,
        recentChannelContext: [],
        pendingQueue: params.pendingQueue.map((item) => ({
          id: item.id,
          sender: item.sender,
          channel: item.sessionKey,
          time: String(item.timestamp),
          text: item.text,
        })),
        incomingBundle: params.incomingBundle.map((item) => ({
          id: item.id,
          sender: item.sender,
          channel: item.sessionKey,
          time: String(item.timestamp),
          text: item.text,
        })),
      },
      questions: {
        [params.brainStatus === "busy_thinking"
          ? "attention_allocation"
          : "wake_decision"]: {
          type: "choice" as const,
          instructions: "Judge attention",
          criteria: {},
        },
      },
    }));

  const deps = {
    stateStore,
    decisionStore,
    clock: {
      time: () => simTime,
      now: () => ({ simTime, speed, formatted: "" }),
    },
    tasks: { lookup: async (id: string) => tasks.get(id) },
    config,
    assertCurrent,
    deliver,
    evaluateDecision,
    assembleDecisionContext,
    ...(confirm ? { confirm } : {}),
    ...(onstage ? { onstage } : {}),
    ...(systemAgentId
      ? {
          api: {
            runtime: {
              config: {
                current: () => ({
                  agents: {
                    defaults: { systemAgent: { agentId: systemAgentId } },
                  },
                }),
              },
            },
            logger: { info: vi.fn(), warn: vi.fn() },
          } as unknown as OpenClawPluginApi,
        }
      : {}),
  };

  const router = new Perception(deps);

  const snapshot = (id = "alice"): PerceptionState => {
    const state = states.get(id);
    if (!state) throw new Error(`No state for ${id}`);
    return structuredClone(state);
  };

  return {
    router,
    states,
    decisions,
    tasks,
    deliveries,
    deliver,
    evaluateDecision,
    snapshot,
    restart: (extra: Partial<PerceptionDeps> = {}) =>
      new Perception({ ...deps, ...extra }),
    setTime: (value: number) => {
      simTime = value;
    },
    setSpeed: (value: number) => {
      speed = value;
    },
  };
}

function setupWake(options: SetupOptions = {}) {
  const h = setup(options);
  h.evaluateDecision.mockResolvedValue({
    status: "ok",
    result: {
      answers: { wake_decision: { type: "choice", choice: "WAKE" } },
    },
  });
  return h;
}

describe("Attention regression cases", () => {
  it("admits newly accepted evidence before an idle backlog fills the batch", async () => {
    const h = setupWake({ maxBatchSize: 1 });
    h.states.set("alice", {
      pending: [
        { ...stimulus("approved"), action: "QUEUE_NEXT" },
        stimulus("new"),
      ],
    });
    await h.router.recover();
    expect(h.deliveries[0].ids).toEqual(["new"]);
    expect(h.snapshot().pending.map((item) => item.id)).toEqual(["approved"]);
    await h.router.ended("alice", "external", false);
    expect(h.deliveries[1].ids).toEqual(["approved"]);
    expect(h.evaluateDecision).toHaveBeenCalledTimes(1);
  });

  it("keeps the complete Jev batch within the budget and grounds the rubric in character evidence", async () => {
    const h = setup({
      assembleDecisionContext: async (agentId, request) =>
        assembleDecisionBatch({
          ...request,
          agentId,
          simTime: NOW,
          sessionsContext: {},
          characterFiles: {
            identity: "Identity ".repeat(4000),
            soul: "Values ".repeat(4000),
            memory: "Promises ".repeat(4000),
          },
          wiki: ["Beliefs ".repeat(4000)],
          rubric: {
            instructions:
              "Judge attention strictly from this character's identity, values, memories, and evidence.",
            questions: {
              wake_decision: {
                description: "Idle wake decision",
                criteria: { WAKE: "Wake", IGNORE: "Ignore" },
              },
              attention_allocation: {
                description: "Busy attention allocation",
                criteria: {
                  STEER: "Steer",
                  QUEUE_NEXT: "Queue",
                  IGNORE: "Ignore",
                },
              },
              response_latency: {
                criteria: [
                  { minutes: 0, description: "Now" },
                  { minutes: 60, description: "Later" },
                ],
              },
            },
          },
        }),
    });
    h.states.set("alice", {
      brainRun: "busy",
      brainContext: "Working on a reply to Bob",
      pending: Array.from({ length: 16 }, (_, i) =>
        stimulus(String(i), "alice", "A".repeat(32_000)),
      ),
    });
    h.evaluateDecision.mockResolvedValue({
      status: "ok",
      result: {
        answers: {
          attention_allocation: { type: "choice", choice: "IGNORE" },
        },
      },
    });
    await h.router.drain("alice");
    for (const [batch] of h.evaluateDecision.mock.calls) {
      expect(textTokens(JSON.stringify(batch))).toBeLessThanOrEqual(8000);
      expect(batch.state.currentAttention).toContain("reply to Bob");
      expect(batch.questions.attention_allocation.instructions).toContain(
        "character's identity",
      );
    }
    expect(h.snapshot().pending).toEqual([]);
  });

  it("never reclassifies or removes approved items in a mixed idle batch", async () => {
    const h = setup();
    h.states.set("alice", {
      pending: [
        { ...stimulus("approved"), action: "QUEUE_NEXT" },
        stimulus("new"),
      ],
    });
    h.evaluateDecision.mockResolvedValue({
      status: "ok",
      result: {
        answers: { wake_decision: { type: "choice", choice: "IGNORE" } },
      },
    });
    await h.router.recover();
    expect(h.evaluateDecision).toHaveBeenCalledTimes(1);
    expect(
      h.evaluateDecision.mock.calls[0][0].state.incomingBundle.map(
        (item: Stimulus) => item.id,
      ),
    ).toEqual(["new"]);
    expect(h.deliveries[0].ids).toEqual(["approved"]);
    expect(h.snapshot().pending).toEqual([]);
  });

  it("classifies and steers an emergency while a routine handoff is deferred", async () => {
    const h = setupWake();
    h.deliver.mockImplementationOnce(async (_delivery, lifecycle) => {
      lifecycle.onDeferred?.();
    });
    await h.router.receive("alice", stimulus("routine"));
    const routineLifecycle = h.deliver.mock.calls[0][1];
    await h.router.started("alice", "busy");
    await h.router.receive("alice", stimulus("emergency"));
    expect(h.evaluateDecision).toHaveBeenCalledTimes(2);
    expect(h.deliveries[0]).toMatchObject({
      mode: "steer",
      ids: ["emergency"],
    });
    expect(h.snapshot().pending.map((item) => item.id)).toEqual(["routine"]);
    expect(h.snapshot().deliveries).toHaveLength(1);
    await h.router.ended("alice", "busy", false);
    await routineLifecycle.onAdopted();
    expect(h.snapshot().pending).toEqual([]);
  });

  it("continues through ignored recovery batches without requiring another event", async () => {
    const h = setup({ maxBatchSize: 1 });
    h.states.set("alice", {
      pending: [stimulus("1"), stimulus("2"), stimulus("3")],
    });
    h.evaluateDecision.mockResolvedValue({
      status: "ok",
      result: {
        answers: { wake_decision: { type: "choice", choice: "IGNORE" } },
      },
    });
    await h.router.recover();
    expect(h.evaluateDecision).toHaveBeenCalledTimes(3);
    expect(h.snapshot().pending).toEqual([]);
    expect(h.deliveries).toEqual([]);
  });

  it("invalidates a queued deadline on delay and admits the revised deadline later", async () => {
    const h = setup();
    const task = {
      id: "task-1",
      type: "studying" as const,
      description: "Physics",
      duration: 60,
      startedAt: new Date(NOW - 3_600_000).toISOString(),
      endAt: new Date(NOW).toISOString(),
    };
    h.tasks.set("alice", task);
    h.evaluateDecision.mockResolvedValue({
      status: "ok",
      result: {
        answers: {
          attention_allocation: { type: "choice", choice: "QUEUE_NEXT" },
        },
      },
    });
    await h.router.started("alice", "busy");
    await h.router.deadline("alice");
    h.tasks.set("alice", {
      ...task,
      endAt: new Date(NOW + 60_000).toISOString(),
    });
    await h.router.ended("alice", "busy", false);
    expect(h.snapshot().pending).toEqual([]);
    expect(h.deliveries).toHaveLength(0);
    h.setTime(NOW + 60_000);
    await h.router.deadline("alice");
    expect(h.deliveries[0].ids).toEqual([
      `task-deadline:task-1:${new Date(NOW + 60_000).toISOString()}`,
    ]);
  });

  it("does not deduplicate a revised deadline after the prior deadline was adopted", async () => {
    const h = setupWake();
    const task = {
      id: "task-1",
      type: "studying" as const,
      description: "Physics",
      duration: 60,
      startedAt: new Date(NOW - 3_600_000).toISOString(),
      endAt: new Date(NOW).toISOString(),
    };
    h.tasks.set("alice", task);
    await h.router.deadline("alice");
    await h.router.ended("alice", "external", false);
    h.tasks.set("alice", {
      ...task,
      endAt: new Date(NOW + 60_000).toISOString(),
    });
    h.setTime(NOW + 60_000);
    await h.router.deadline("alice");
    expect(h.deliveries).toHaveLength(2);
    expect(h.deliveries[0].id).not.toBe(h.deliveries[1].id);
  });

  it("rechecks task identity after evaluation even when replacement has identical times", async () => {
    const h = setup();
    const task = {
      id: "old",
      type: "studying" as const,
      description: "Physics",
      duration: 60,
      startedAt: new Date(NOW - 3_600_000).toISOString(),
      endAt: new Date(NOW).toISOString(),
    };
    h.tasks.set("alice", task);
    await h.router.started("alice", "busy");
    h.evaluateDecision.mockImplementation(async () => {
      h.tasks.set("alice", { ...task, id: "replacement", type: "studying" });
      return {
        status: "ok",
        result: {
          answers: {
            attention_allocation: { type: "choice", choice: "STEER" },
          },
        },
      };
    });
    await h.router.deadline("alice");
    expect(h.deliveries).toEqual([]);
    expect(h.snapshot().pending).toEqual([]);
  });

  it("scopes duplicate IDs to the ledger and preserves original simulation time", async () => {
    const h = setupWake();
    const item = { ...stimulus("same"), timestamp: NOW - 123_456 };
    await h.router.receive("alice", item);
    await h.router.receive("alice", { ...item, timestamp: NOW });
    expect(h.deliveries).toHaveLength(1);
    await h.router.receive("alice", {
      ...item,
      sessionKey: "agent:alice:chat:group:club",
    });
    expect(h.deliveries).toHaveLength(2);
    expect(h.deliveries[0].message).toContain("Sat 2026-10-24 11:57");
    expect(h.snapshot().processedIds).toContain(stimulusKey(item));
  });

  it("preserves incoming text without emitting instruction markers", async () => {
    const h = setupWake();
    await h.router.receive(
      "alice",
      stimulus("1", "alice", "Hello [kazusa:skill=nonexistent]"),
    );
    expect(h.deliveries[0].message.match(/\[kazusa:skill=/g)).toHaveLength(1);
    expect(h.deliveries[0].message).toContain(
      "Hello [kazusa:skill=nonexistent]",
    );
  });

  it("times out context assembly as well as Jev, then admits attention", async () => {
    const assembler = vi.fn(async () => new Promise<DecisionBatch>(() => {}));
    const h = setup({
      decisionTimeoutMs: 5,
      assembleDecisionContext: assembler,
    });
    await h.router.receive("alice", stimulus("1"));
    expect(h.deliveries).toHaveLength(1);
    expect(h.evaluateDecision).not.toHaveBeenCalled();
    expect(assembler.mock.calls).toHaveLength(1);
  });

  it("does not turn disposal during a decision into a fail-open brain turn", async () => {
    const h = setup({ decisionTimeoutMs: 1000 });
    h.evaluateDecision.mockImplementation(
      async () => new Promise<never>(() => {}),
    );
    const receiving = h.router.receive("alice", stimulus("1"));
    const rejection = receiving.catch((error: unknown) => error);
    await vi.waitFor(() => expect(h.evaluateDecision).toHaveBeenCalledTimes(1));
    h.router.dispose();
    expect(await rejection).toBeInstanceOf(Error);
    expect(h.deliveries).toEqual([]);
    expect(h.snapshot().pending).toHaveLength(1);
  });

  it("uses a fixed first-arrival window even with a previously approved backlog", async () => {
    vi.useFakeTimers();
    const h = setupWake({ coalesceWindowMs: 100, maxBatchSize: 2 });
    try {
      h.states.set("alice", {
        brainRun: "busy",
        pending: [
          { ...stimulus("old1"), action: "QUEUE_NEXT" },
          { ...stimulus("old2"), action: "QUEUE_NEXT" },
        ],
      });
      await h.router.receive("alice", stimulus("new1"));
      expect(h.evaluateDecision).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(99);
      expect(h.evaluateDecision).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(h.evaluateDecision).toHaveBeenCalledTimes(1);
      expect(h.deliveries[0].ids).toEqual(["new1"]);
    } finally {
      h.router.dispose();
      vi.useRealTimers();
    }
  });

  it("does not extend the first-arrival window when a second message arrives", async () => {
    vi.useFakeTimers();
    const h = setupWake({ coalesceWindowMs: 100 });
    try {
      await h.router.receive("alice", stimulus("one"));
      await vi.advanceTimersByTimeAsync(80);
      await h.router.receive("alice", stimulus("two"));
      await vi.advanceTimersByTimeAsync(20);
      expect(h.deliveries[0].ids).toEqual(["one", "two"]);
    } finally {
      h.router.dispose();
      vi.useRealTimers();
    }
  });

  it("limits delivery text size even when the count limit has not been reached", async () => {
    const h = setupWake({ maxBatchSize: 16, maxBatchChars: 32_000 });
    h.states.set("alice", {
      pending: [
        stimulus("a", "alice", "a".repeat(32_000)),
        stimulus("b", "alice", "b".repeat(32_000)),
      ],
    });
    await h.router.drain("alice");
    await vi.waitFor(() => expect(h.deliveries).toHaveLength(2));
    expect(h.deliveries.map((item) => item.ids)).toEqual([["a"], ["b"]]);
  });
});

describe("Brain handoff custody", () => {
  it("retains input during dispatch and allows lifecycle events without deadlocking", async () => {
    const h = setupWake();
    const release = Promise.withResolvers<void>();
    h.deliver.mockImplementationOnce(async (_delivery, lifecycle) => {
      await h.router.started("alice", "real-run");
      expect(h.snapshot().pending.map(({ id }) => id)).toEqual(["a"]);
      await release.promise;
      await lifecycle.onAdopted();
    });
    const receiving = h.router.receive("alice", stimulus("a"));
    await vi.waitFor(() => expect(h.snapshot().brainRun).toBe("real-run"));
    await h.router.drain("alice");
    expect(h.deliver).toHaveBeenCalledTimes(1);
    release.resolve();
    await receiving;
    expect(h.snapshot().pending).toEqual([]);
    expect(h.snapshot().deliveries?.[0]).toBeUndefined();
    expect(h.snapshot().brainRun).toBe("real-run");
  });

  it("does not acknowledge a deferred steer until host adoption, even if the old turn ends", async () => {
    const h = setupWake();
    await h.router.started("alice", "old-run");
    h.evaluateDecision.mockResolvedValue({
      status: "ok",
      result: {
        answers: {
          attention_allocation: { type: "choice", choice: "STEER" },
        },
      },
    });
    h.deliver.mockImplementationOnce(async (_delivery, lifecycle) => {
      lifecycle.onDeferred?.();
    });
    await h.router.receive("alice", stimulus("a"));
    const [, lifecycle] = h.deliver.mock.calls[0];
    expect(h.snapshot().pending).toHaveLength(1);
    expect(h.snapshot().deliveries?.[0]?.mode).toBe("steer");
    await h.router.ended("alice", "old-run", false);
    await h.router.receive("alice", stimulus("b"));
    expect(h.deliver).toHaveBeenCalledTimes(2);
    expect(h.snapshot().pending.map(({ id }) => id)).toEqual(["a"]);
    await lifecycle.onAdopted();
    expect(h.snapshot().pending).toEqual([]);
    expect(h.snapshot().deliveries?.[0]).toBeUndefined();
  });

  it("keeps inputs on explicit abandonment and retries with the same source ID", async () => {
    const h = setupWake();
    h.deliver.mockImplementationOnce(async (_delivery, lifecycle) => {
      lifecycle.onAbandoned?.();
      lifecycle.onSettled?.();
    });
    await expect(h.router.receive("alice", stimulus("a"))).rejects.toThrow(
      "rejected",
    );
    const id = h.deliver.mock.calls[0][0].id;
    expect(h.snapshot()).toMatchObject({
      stopped: true,
      pending: [stimulus("a")],
    });
    expect(h.snapshot().deliveries?.[0]).toBeUndefined();
    // A fresh intake (including a retry) explicitly resumes a proven-rejected handoff.
    await h.router.receive("alice", stimulus("a"));
    expect(h.deliver.mock.calls[1]?.[0].id).toBe(id);
  });

  it("retains and pauses uncertain handoffs rather than replaying after a restart", async () => {
    const h = setupWake();
    h.deliver.mockRejectedValueOnce(
      new Error("Connection failed after possible acceptance"),
    );
    await expect(h.router.receive("alice", stimulus("a"))).rejects.toThrow(
      "possible acceptance",
    );
    const retained = h.snapshot().deliveries?.[0];
    expect(retained?.ids).toEqual(["a"]);
    expect(h.snapshot().pending).toHaveLength(1);
    await h.restart().recover();
    await h.router.receive("alice", stimulus("b"));
    expect(h.deliver).toHaveBeenCalledTimes(1);
    expect(h.snapshot().pending).toHaveLength(2);
    expect(h.snapshot().deliveries?.[0]).toEqual(retained);
    expect(h.snapshot().stopped).toBe(true);
  });

  // Live: a restart left characters quarantined until hand-edited.
  const leftover = async (adopted: boolean) => {
    const h = setupWake();
    h.deliver.mockRejectedValueOnce(
      new Error("Connection failed after possible acceptance"),
    );
    await expect(h.router.receive("alice", stimulus("a"))).rejects.toThrow(
      "possible acceptance",
    );
    const check = vi.fn(async () => adopted);
    await h.restart({ adopted: check }).recover();
    expect(check).toHaveBeenCalledWith(expect.objectContaining({ ids: ["a"] }));
    expect(h.snapshot().stopped).toBe(false);
    return h;
  };

  it("on restart, counts a handoff the brain transcript has as done", async () => {
    const h = await leftover(true);
    // Its turn ran: never replayed.
    expect(h.deliver).toHaveBeenCalledTimes(1);
    expect(h.snapshot().pending).toEqual([]);
    expect(h.snapshot().processedIds).toContain(stimulusKey(stimulus("a")));
  });

  it("on restart, hands over again what the brain never got", async () => {
    const h = await leftover(false);
    await vi.waitFor(() => expect(h.deliver).toHaveBeenCalledTimes(2));
    expect(h.deliver.mock.calls[1][0].ids).toEqual(["a"]);
  });

  it("does not interpret a successful return without adoption as acceptance", async () => {
    const h = setupWake();
    h.deliver.mockResolvedValueOnce();
    await expect(h.router.receive("alice", stimulus("a"))).rejects.toThrow(
      "without adoption",
    );
    expect(h.snapshot().pending).toHaveLength(1);
    expect(h.snapshot().deliveries?.[0]).toBeDefined();
  });

  it("settles ambiguous consumed inputs without acknowledging or retrying them", async () => {
    const h = setupWake();
    h.deliver.mockImplementationOnce(async (_delivery, lifecycle) => {
      lifecycle.onDeferred?.();
      // Native indeterminate steering consumes its candidate without onAdopted/onAbandoned.
      lifecycle.onSettled?.();
    });
    await h.router.receive("alice", stimulus("a"));
    await vi.waitFor(() => expect(h.snapshot().stopped).toBe(true));
    expect(h.snapshot().pending).toHaveLength(1);
    expect(h.snapshot().deliveries?.[0]).toBeDefined();
  });

  it("never replays an adopted input if the ensuing generation fails", async () => {
    const h = setupWake();
    h.deliver.mockImplementationOnce(async (_delivery, lifecycle) => {
      await lifecycle.onAdopted();
      throw new Error("Model failed after adoption");
    });
    await h.router.receive("alice", stimulus("a"));
    await h.router.ended("alice", "external", true);
    await h.restart().recover();
    expect(h.snapshot().pending).toEqual([]);
    expect(h.deliver).toHaveBeenCalledTimes(1);
  });

  it("retains a new deadline that arrives while the preceding handoff is pending", async () => {
    const h = setupWake();
    const taskStart1 = new Date(NOW - 600_000).toISOString();
    h.tasks.set("alice", {
      id: "task-1",
      type: "having fun",
      description: "Waiting",
      duration: 10,
      startedAt: taskStart1,
      endAt: new Date(NOW).toISOString(),
    });
    h.deliver.mockImplementationOnce(async (_delivery, lifecycle) => {
      lifecycle.onDeferred?.();
    });
    await h.router.deadline("alice");
    expect(h.snapshot().deliveries?.[0]?.ids).toContain(
      `task-deadline:task-1:${new Date(NOW).toISOString()}`,
    );
    const taskStart2 = new Date(NOW).toISOString();
    h.tasks.set("alice", {
      id: "task-2",
      type: "eating",
      description: "Cooking",
      duration: 10,
      startedAt: taskStart2,
      endAt: new Date(NOW).toISOString(),
    });
    h.evaluateDecision.mockResolvedValue({
      status: "ok",
      result: {
        answers: {
          attention_allocation: { type: "choice", choice: "QUEUE_NEXT" },
        },
      },
    });
    await h.router.deadline("alice");
    await h.deliver.mock.calls[0][1].onAdopted();
    expect(
      h
        .snapshot()
        .pending.some(
          (item) =>
            item.id === `task-deadline:task-2:${new Date(NOW).toISOString()}`,
        ),
    ).toBe(true);
    expect(h.deliver).toHaveBeenCalledTimes(1);
  });

  it("routine task deadlines wait behind a busy brain when evaluated as QUEUE_NEXT", async () => {
    const h = setup();
    h.evaluateDecision.mockResolvedValue({
      status: "ok",
      result: {
        answers: {
          attention_allocation: { type: "choice", choice: "QUEUE_NEXT" },
        },
      },
    });
    const taskStart = new Date(NOW - 600_000).toISOString();
    h.tasks.set("alice", {
      id: "task-1",
      type: "having fun",
      description: "Waiting",
      duration: 10,
      startedAt: taskStart,
      endAt: new Date(NOW).toISOString(),
    });
    await h.router.started("alice", "busy");
    await h.router.deadline("alice");
    expect(h.deliver).not.toHaveBeenCalled();
    expect(h.evaluateDecision).toHaveBeenCalledTimes(1);
    await h.router.ended("alice", "busy", false);
    expect(h.deliver.mock.calls[0][0]).toMatchObject({
      mode: "followup",
      ids: [`task-deadline:task-1:${new Date(NOW).toISOString()}`],
    });
  });

  it("urgent task deadlines steer a busy brain immediately", async () => {
    const h = setup();
    h.evaluateDecision.mockResolvedValue({
      status: "ok",
      result: {
        answers: {
          attention_allocation: { type: "choice", choice: "STEER" },
        },
      },
    });
    const taskStart = new Date(NOW - 300_000).toISOString();
    h.tasks.set("alice", {
      id: "task-1",
      type: "working",
      description: "Cutting the red wire",
      duration: 5,
      startedAt: taskStart,
      endAt: new Date(NOW).toISOString(),
    });
    await h.router.started("alice", "busy");
    await h.router.deadline("alice");
    expect(h.deliver).toHaveBeenCalledTimes(1);
    expect(h.deliver.mock.calls[0][0]).toMatchObject({
      mode: "steer",
      ids: [`task-deadline:task-1:${new Date(NOW).toISOString()}`],
    });
  });

  it("clamps task deadline to QUEUE_NEXT when Jev evaluates IGNORE", async () => {
    const h = setup();
    h.evaluateDecision.mockResolvedValue({
      status: "ok",
      result: {
        answers: {
          attention_allocation: { type: "choice", choice: "IGNORE" },
        },
      },
    });
    const taskStart = new Date(NOW - 600_000).toISOString();
    h.tasks.set("alice", {
      id: "task-1",
      type: "eating",
      description: "Cooking pasta",
      duration: 10,
      startedAt: taskStart,
      endAt: new Date(NOW).toISOString(),
    });
    await h.router.started("alice", "busy");
    // Both chat and deadline arrive
    await h.router.receive("alice", stimulus("chat-1"));
    await h.router.deadline("alice");
    expect(h.deliver).not.toHaveBeenCalled();
    // Chat was dropped, but task deadline was clamped to QUEUE_NEXT
    const pending = h.snapshot().pending;
    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe(
      `task-deadline:task-1:${new Date(NOW).toISOString()}`,
    );
    expect(pending[0].action).toBe("QUEUE_NEXT");
    // When brain ends, the clamped deadline wakes the character
    await h.router.ended("alice", "busy", false);
    expect(h.deliver).toHaveBeenCalledTimes(1);
    expect(h.deliver.mock.calls[0][0]).toMatchObject({
      mode: "followup",
      ids: [`task-deadline:task-1:${new Date(NOW).toISOString()}`],
    });
  });

  it("fails open and delivers to brain when the decision model is unavailable", async () => {
    const h = setupWake();
    h.evaluateDecision.mockResolvedValueOnce({
      status: "unavailable",
      reason: "not-configured",
    });
    await h.router.receive("alice", stimulus("a"));
    expect(h.deliver).toHaveBeenCalledTimes(1);
    expect(h.snapshot().pending).toHaveLength(0);
  });
});

describe("Perception Universal Gate with Jev Decision Model", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // 1. Idle Brain & Sleep Filtering
  // =========================================================================
  describe("Idle Brain", () => {
    it("wakes idle brain when Jev chooses WAKE", async () => {
      const h = setup();
      h.evaluateDecision.mockResolvedValueOnce({
        status: "ok",
        result: {
          answers: {
            wake_decision: {
              type: "choice",
              choice: "WAKE",
              probabilities: { WAKE: 0.8, IGNORE: 0.2 },
            },
          },
        },
      });

      await h.router.receive("alice", stimulus("a"));

      expect(h.deliver).toHaveBeenCalledTimes(1);
      expect(h.deliveries[0]).toMatchObject({
        agentId: "alice",
        mode: "followup",
        ids: ["a"],
      });
      expect(h.snapshot().pending).toHaveLength(0);
    });

    it("filters routine chatter while character is sleeping without waking LLM", async () => {
      const h = setup();
      h.tasks.set("alice", {
        id: "task-1",
        type: "sleeping",
        description: "Deep sleep in dorm room",
        startedAt: new Date(NOW - 3600_000).toISOString(),
        endAt: new Date(NOW + 7 * 3600_000).toISOString(),
        duration: 60,
      });

      // The categorical decision is IGNORE; probabilities are not policy thresholds.
      h.evaluateDecision.mockResolvedValueOnce({
        status: "ok",
        result: {
          answers: {
            wake_decision: {
              type: "choice",
              choice: "IGNORE",
              probabilities: { WAKE: 0.35, IGNORE: 0.65 },
            },
          },
        },
      });

      await h.router.receive("alice", stimulus("a"));

      // Zero wake deliveries!
      expect(h.deliver).not.toHaveBeenCalled();
      // Dropped from attention pending queue (ledger preserved)
      expect(h.snapshot().pending).toHaveLength(0);
    });

    it("wakes sleeping character when Jev chooses WAKE for an emergency", async () => {
      const h = setup();
      h.tasks.set("alice", {
        id: "task-1",
        type: "sleeping",
        description: "Deep sleep in dorm room",
        startedAt: new Date(NOW - 3600_000).toISOString(),
        endAt: new Date(NOW + 7 * 3600_000).toISOString(),
        duration: 60,
      });

      // The character-grounded decision admits this emergency.
      h.evaluateDecision.mockResolvedValueOnce({
        status: "ok",
        result: {
          answers: {
            wake_decision: {
              type: "choice",
              choice: "WAKE",
              probabilities: { WAKE: 0.95, IGNORE: 0.05 },
            },
          },
        },
      });

      await h.router.receive(
        "alice",
        stimulus("alarm", "alice", "FIRE ALARM!"),
      );

      expect(h.deliver).toHaveBeenCalledTimes(1);
      expect(h.deliveries[0].ids).toEqual(["alarm"]);
    });
  });

  // =========================================================================
  // 2. Busy Brain categorical decisions
  // =========================================================================
  describe("Busy Brain categorical choices", () => {
    it("honors STEER during a low-focus task", async () => {
      const h = setup();
      await h.router.started("alice", "run-1");

      h.tasks.set("alice", {
        id: "task-1",
        type: "having fun",
        description: "Lounging on the sofa",
        startedAt: new Date(NOW).toISOString(),
        endAt: new Date(NOW + 1800_000).toISOString(),
        duration: 10,
      });

      // Honor the returned category without inventing a focus threshold.
      h.evaluateDecision.mockResolvedValueOnce({
        status: "ok",
        result: {
          answers: {
            attention_allocation: {
              type: "choice",
              choice: "STEER",
              probabilities: { STEER: 0.55, QUEUE_NEXT: 0.35, IGNORE: 0.1 },
            },
          },
        },
      });

      await h.router.receive("alice", stimulus("a"));

      expect(h.deliver).toHaveBeenCalledTimes(1);
      expect(h.deliveries[0]).toMatchObject({
        agentId: "alice",
        mode: "steer",
        ids: ["a"],
      });
      expect(h.snapshot().pending).toHaveLength(0);
      // Live: a busy STEER was recorded as a fallback ("unusable answer").
      expect([...h.decisions.values()]).toEqual([
        expect.objectContaining({ action: "STEER", source: "model" }),
      ]);
    });

    it("honors QUEUE_NEXT independently of the rounded probability argmax", async () => {
      const h = setup();
      await h.router.started("alice", "run-1");

      h.tasks.set("alice", {
        id: "task-1",
        type: "working",
        description: "Active combat training",
        startedAt: new Date(NOW).toISOString(),
        endAt: new Date(NOW + 1800_000).toISOString(),
        duration: 10,
      });

      // Honor QUEUE_NEXT even if rounded probabilities rank STEER first.
      h.evaluateDecision.mockResolvedValueOnce({
        status: "ok",
        result: {
          answers: {
            attention_allocation: {
              type: "choice",
              choice: "QUEUE_NEXT",
              probabilities: { STEER: 0.55, QUEUE_NEXT: 0.4, IGNORE: 0.05 },
            },
          },
        },
      });

      await h.router.receive("alice", stimulus("a"));

      // Not steered!
      expect(h.deliver).not.toHaveBeenCalled();
      // Retained in queue as QUEUE_NEXT
      expect(h.snapshot().pending).toHaveLength(1);
      expect(h.snapshot().pending[0].action).toBe("QUEUE_NEXT");
    });

    it("honors STEER during a high-focus task", async () => {
      const h = setup();
      await h.router.started("alice", "run-1");

      h.tasks.set("alice", {
        id: "task-1",
        type: "studying",
        description: "Intense exam cramming",
        startedAt: new Date(NOW).toISOString(),
        endAt: new Date(NOW + 3600_000).toISOString(),
        duration: 10,
      });

      h.evaluateDecision.mockResolvedValueOnce({
        status: "ok",
        result: {
          answers: {
            attention_allocation: {
              type: "choice",
              choice: "STEER",
              probabilities: { STEER: 0.95, QUEUE_NEXT: 0.05, IGNORE: 0.0 },
            },
          },
        },
      });

      await h.router.receive(
        "alice",
        stimulus("crit", "alice", "Critical alert"),
      );

      expect(h.deliver).toHaveBeenCalledTimes(1);
      expect(h.deliveries[0].mode).toBe("steer");
      expect(h.deliveries[0].ids).toEqual(["crit"]);
    });

    it("steers multiple stimuli when attention allocation chooses STEER", async () => {
      const h = setup();
      await h.router.started("alice", "run-1");

      h.evaluateDecision.mockResolvedValue({
        status: "ok",
        result: {
          answers: {
            attention_allocation: {
              type: "choice",
              choice: "STEER",
              probabilities: { STEER: 0.95, QUEUE_NEXT: 0.05, IGNORE: 0.0 },
            },
          },
        },
      });

      await h.router.receive("alice", stimulus("a"));
      expect(h.deliver).toHaveBeenCalledTimes(1);
      expect(h.deliveries[0].ids).toEqual(["a"]);

      // Second arrival while still in run-1: also steered because Jev chose STEER
      await h.router.receive("alice", stimulus("b"));
      expect(h.deliver).toHaveBeenCalledTimes(2);
      expect(h.deliveries[1].ids).toEqual(["b"]);
    });
  });

  // =========================================================================
  // 3. Consolidated Queue Draining (Single-Turn Batch Presentation)
  // =========================================================================
  describe("Consolidated Queue Draining", () => {
    it("drains all queued stimuli in a single consolidated wake turn when brain ends", async () => {
      const h = setup();
      await h.router.started("alice", "run-1");

      h.evaluateDecision.mockResolvedValue({
        status: "ok",
        result: {
          answers: {
            attention_allocation: {
              type: "choice",
              choice: "QUEUE_NEXT",
              probabilities: { STEER: 0.1, QUEUE_NEXT: 0.9, IGNORE: 0.0 },
            },
          },
        },
      });

      // While busy, 3 stimuli arrive from Bob and Clara
      await h.router.receive("alice", stimulus("msg-1", "alice", "Bob: Hey"));
      await h.router.receive(
        "alice",
        stimulus("msg-2", "alice", "Bob: Are you free?"),
      );
      await h.router.receive(
        "alice",
        stimulus("msg-3", "alice", "Clara: Alice!"),
      );

      expect(h.deliver).not.toHaveBeenCalled();
      expect(h.snapshot().pending).toHaveLength(3);

      // Now active brain run finishes!
      // Idle wake evaluation for the accumulated bundle
      h.evaluateDecision.mockResolvedValueOnce({
        status: "ok",
        result: {
          answers: {
            wake_decision: {
              type: "choice",
              choice: "WAKE",
              probabilities: { WAKE: 0.9, IGNORE: 0.1 },
            },
          },
        },
      });

      await h.router.ended("alice", "run-1", false);

      // EXACTLY ONE unified wake turn dispatched for all 3 messages!
      expect(h.deliver).toHaveBeenCalledTimes(1);
      expect(h.deliveries[0]).toMatchObject({
        agentId: "alice",
        mode: "followup",
        ids: ["msg-1", "msg-2", "msg-3"],
      });
      // All 3 drained simultaneously from pending queue
      expect(h.snapshot().pending).toHaveLength(0);
    });
  });

  // =========================================================================
  // 4. Task Deadlines & Consolidation
  // =========================================================================
  describe("Task Deadlines", () => {
    it("delivers expired task deadline and pending stimuli together in one consolidated turn", async () => {
      const h = setupWake({ coalesceWindowMs: 50 });
      const taskStart = new Date(NOW - 1800_000).toISOString();
      h.tasks.set("alice", {
        id: "task-1",
        type: "eating",
        description: "Making lunch",
        startedAt: taskStart,
        endAt: new Date(NOW - 60_000).toISOString(), // expired 1 min ago
        duration: 10,
      });

      // A chat stimulus and a task deadline arrive within the coalesce window
      await h.router.receive("alice", stimulus("chat-1"));
      await h.router.deadline("alice");

      await new Promise((resolve) => setTimeout(resolve, 60));

      expect(h.deliver).toHaveBeenCalledTimes(1);
      expect(h.deliveries[0]).toMatchObject({
        agentId: "alice",
        mode: "followup",
        ids: [
          "chat-1",
          `task-deadline:task-1:${new Date(NOW - 60_000).toISOString()}`,
        ],
      });
      expect(h.deliveries[0].message).toContain("Incoming chats");
      // Leading sim-time envelope suppresses OpenClaw's wall-clock stamp.
      expect(h.deliveries[0].message).toMatch(
        /^\[\w{3} \d{4}-\d{2}-\d{2} \d{2}:\d{2}\] Incoming chats:/,
      );
      expect(h.deliveries[0].message).toContain(
        "Activity check-in: your eating activity was planned to end at",
      );
      expect(h.snapshot().pending).toHaveLength(0);
    });

    it("drops deadline check if task was delayed into future", async () => {
      const h = setup();
      h.tasks.set("alice", {
        id: "task-1",
        type: "eating",
        description: "Making lunch",
        startedAt: new Date(NOW).toISOString(),
        endAt: new Date(NOW + 1800_000).toISOString(), // future!
        duration: 10,
      });

      await h.router.deadline("alice");

      expect(h.deliver).not.toHaveBeenCalled();
      expect(h.states.get("alice")?.pending ?? []).toHaveLength(0);
    });

    it("discards stale deadline when task was replaced via start_task", async () => {
      const h = setup();
      h.evaluateDecision.mockResolvedValue({
        status: "ok",
        result: {
          answers: {
            attention_allocation: { type: "choice", choice: "QUEUE_NEXT" },
          },
        },
      });
      const oldStart = new Date(NOW - 600_000).toISOString();
      h.tasks.set("alice", {
        id: "task-1",
        type: "having fun",
        description: "Reading a book",
        startedAt: oldStart,
        endAt: new Date(NOW).toISOString(),
        duration: 10,
      });

      await h.router.started("alice", "busy");
      await h.router.deadline("alice"); // deadline queued for task "reading"
      expect(h.snapshot().pending).toHaveLength(1);

      // Alice replaced task with "sleeping" before brain ended
      h.tasks.set("alice", {
        id: "task-1",
        type: "sleeping",
        description: "Asleep in bed",
        startedAt: new Date(NOW + 60_000).toISOString(),
        endAt: new Date(NOW + 3600_000).toISOString(),
        duration: 60,
      });

      await h.router.ended("alice", "busy", false);

      // Stale deadline for replaced task was pruned, no delivery made!
      expect(h.deliver).not.toHaveBeenCalled();
      expect(h.snapshot().pending).toHaveLength(0);
    });
  });

  // =========================================================================
  // 5. Recovery & Resilience
  // =========================================================================
  describe("Recovery", () => {
    it("recovers pending state after restart and drains pending stimuli via fail-open", async () => {
      const h = setup();
      h.states.set("alice", {
        pending: [stimulus("a")],
        brainRun: "old-run",
      });

      const recovered = h.restart();
      await recovered.recover();

      expect(h.deliver).toHaveBeenCalledTimes(1);
      expect(h.snapshot("alice").pending).toHaveLength(0);
    });
  });

  // =========================================================================
  // 6. Multi-Stimulus Coalescing & Emergent Salience
  // =========================================================================
  describe("Multi-Stimulus Coalescing & Emergent Salience", () => {
    it("coalesces burst arrivals within coalesceWindowMs and evaluates them as a bundle", async () => {
      const h = setup({ coalesceWindowMs: 50 });
      await h.router.started("alice", "run-1");

      h.evaluateDecision.mockResolvedValueOnce({
        status: "ok",
        result: {
          answers: {
            attention_allocation: {
              type: "choice",
              choice: "STEER",
              probabilities: { STEER: 0.95, QUEUE_NEXT: 0.05, IGNORE: 0.0 },
            },
          },
        },
      });

      // Rapid burst of 2 messages
      await h.router.receive(
        "alice",
        stimulus("burst-1", "alice", "Do you smell smoke?"),
      );
      await h.router.receive(
        "alice",
        stimulus("burst-2", "alice", "The toaster is on fire!"),
      );

      // Wait for debounce timer
      await new Promise((r) => setTimeout(r, 70));

      expect(h.evaluateDecision).toHaveBeenCalledTimes(1);
      const call = h.evaluateDecision.mock.calls[0][0];
      // Incoming bundle contains BOTH messages evaluated together
      expect(call.state.incomingBundle).toHaveLength(2);
      expect(call.state.incomingBundle[0].id).toBe("burst-1");
      expect(call.state.incomingBundle[1].id).toBe("burst-2");

      // Both messages steered together into the active brain run
      expect(h.deliver).toHaveBeenCalledTimes(1);
      expect(h.deliveries[0]).toMatchObject({
        mode: "steer",
        ids: ["burst-1", "burst-2"],
      });
      expect(h.snapshot().pending).toHaveLength(0);
    });

    it("uses queued evidence for salience but delivers queued items after the interruption", async () => {
      const h = setup();
      await h.router.started("alice", "run-1");

      h.tasks.set("alice", {
        id: "task-1",
        type: "studying",
        description: "Intense studying",
        startedAt: new Date(NOW).toISOString(),
        endAt: new Date(NOW + 3600_000).toISOString(),
        duration: 30,
      });

      // Arrival 1: low urgency -> QUEUE_NEXT
      h.evaluateDecision.mockResolvedValueOnce({
        status: "ok",
        result: {
          answers: {
            attention_allocation: {
              type: "choice",
              choice: "QUEUE_NEXT",
              probabilities: { STEER: 0.3, QUEUE_NEXT: 0.6, IGNORE: 0.1 },
            },
          },
        },
      });

      await h.router.receive(
        "alice",
        stimulus("clue-1", "alice", "Do you smell something strange?"),
      );
      expect(h.deliver).not.toHaveBeenCalled();
      expect(h.snapshot().pending).toHaveLength(1);
      expect(h.snapshot().pending[0].action).toBe("QUEUE_NEXT");

      // Arrival 2: emergency punchline arrives! Evaluates pendingQueue [clue-1] + incomingBundle [clue-2] -> STEER
      h.evaluateDecision.mockResolvedValueOnce({
        status: "ok",
        result: {
          answers: {
            attention_allocation: {
              type: "choice",
              choice: "STEER",
              probabilities: { STEER: 0.98, QUEUE_NEXT: 0.02, IGNORE: 0.0 },
            },
          },
        },
      });

      await h.router.receive(
        "alice",
        stimulus("clue-2", "alice", "The laboratory is on fire!"),
      );

      expect(h.evaluateDecision).toHaveBeenCalledTimes(2);
      const call = h.evaluateDecision.mock.calls[1][0];
      expect(call.state.pendingQueue).toHaveLength(1);
      expect(call.state.pendingQueue[0].id).toBe("clue-1");
      expect(call.state.incomingBundle).toHaveLength(1);
      expect(call.state.incomingBundle[0].id).toBe("clue-2");

      // The new urgent item interrupts; approved background waits.
      expect(h.deliver).toHaveBeenCalledTimes(1);
      expect(h.deliveries[0]).toMatchObject({
        mode: "steer",
        ids: ["clue-2"],
      });
      expect(h.snapshot().pending.map((item) => item.id)).toEqual(["clue-1"]);
      await h.router.ended("alice", "run-1", false);
      expect(h.deliveries[1]).toMatchObject({
        mode: "followup",
        ids: ["clue-1"],
      });
    });

    it("selective ignore retains previously queued stimuli when routine chatter arrives", async () => {
      const h = setup();
      await h.router.started("alice", "run-1");

      h.tasks.set("alice", {
        id: "task-1",
        type: "studying",
        description: "Intense studying",
        startedAt: new Date(NOW).toISOString(),
        endAt: new Date(NOW + 3600_000).toISOString(),
        duration: 30,
      });

      // Arrival 1: relevant message -> QUEUE_NEXT
      h.evaluateDecision.mockResolvedValueOnce({
        status: "ok",
        result: {
          answers: {
            attention_allocation: {
              type: "choice",
              choice: "QUEUE_NEXT",
              probabilities: { STEER: 0.3, QUEUE_NEXT: 0.6, IGNORE: 0.1 },
            },
          },
        },
      });

      await h.router.receive(
        "alice",
        stimulus(
          "important-1",
          "alice",
          "Can you send me the lecture notes later?",
        ),
      );
      expect(h.snapshot().pending).toHaveLength(1);

      // Arrival 2: ambient noise / spam -> IGNORE
      h.evaluateDecision.mockResolvedValueOnce({
        status: "ok",
        result: {
          answers: {
            attention_allocation: {
              type: "choice",
              choice: "IGNORE",
              probabilities: { STEER: 0.05, QUEUE_NEXT: 0.15, IGNORE: 0.8 },
            },
          },
        },
      });

      await h.router.receive("alice", stimulus("spam-1", "alice", "lol"));

      // important-1 remains preserved in pending queue, spam-1 is dropped!
      expect(h.snapshot().pending).toHaveLength(1);
      expect(h.snapshot().pending[0].id).toBe("important-1");
    });

    it("automatically delivers queued stimuli on turn completion without a redundant Jev evaluation", async () => {
      const h = setup();
      await h.router.started("alice", "run-1");

      h.tasks.set("alice", {
        id: "task-1",
        type: "studying",
        description: "Intense studying",
        startedAt: new Date(NOW).toISOString(),
        endAt: new Date(NOW + 3600_000).toISOString(),
        duration: 30,
      });

      // Arrival while busy: deferred to QUEUE_NEXT
      h.evaluateDecision.mockResolvedValueOnce({
        status: "ok",
        result: {
          answers: {
            attention_allocation: {
              type: "choice",
              choice: "QUEUE_NEXT",
              probabilities: { STEER: 0.3, QUEUE_NEXT: 0.6, IGNORE: 0.1 },
            },
          },
        },
      });

      await h.router.receive(
        "alice",
        stimulus("msg-queued", "alice", "Notes request"),
      );
      expect(h.deliver).not.toHaveBeenCalled();
      expect(h.evaluateDecision).toHaveBeenCalledTimes(1);

      // Now active turn concludes
      await h.router.ended("alice", "run-1", false);

      // Delivers immediately without calling evaluateDecision again!
      expect(h.evaluateDecision).toHaveBeenCalledTimes(1);
      expect(h.deliver).toHaveBeenCalledTimes(1);
      expect(h.deliveries[0]).toMatchObject({
        mode: "followup",
        ids: ["msg-queued"],
      });
      expect(h.snapshot().pending).toHaveLength(0);
    });

    it("delegates to assembleDecisionContext for decision state prefill", async () => {
      const h = setup();
      const assembleDecisionContext = vi.fn(async (agentId, params) => ({
        state: {
          character: { id: agentId },
          currentActivity: {
            type: "resting",
            description: "Lounging",
            startedAt: null,
            endAt: null,
          },
          brainStatus: params.brainStatus,
          recentChannelContext: ["[bob 11:55] Hello", "[alice 11:56] Hi Bob"],
          pendingQueue: [],
          incomingBundle: params.incomingBundle,
        },
        questions: {
          wake_decision: {
            type: "choice" as const,
            instructions: "Judge attention",
            criteria: {},
          },
        },
      }));
      const customDeps = {
        stateStore: {
          lookup: async (key: string) => structuredClone(h.states.get(key)),
          register: async (key: string, value: PerceptionState) => {
            h.states.set(key, structuredClone(value));
          },
          entries: async () => [],
        },
        decisionStore: {
          lookup: async () => undefined,
          register: async () => {},
          entries: async () => [],
        },
        clock: {
          time: () => NOW,
          now: () => ({ simTime: NOW, speed: 1, formatted: "" }),
        },
        tasks: { lookup: async () => undefined },
        config: PERCEPTION_CONFIG.parse({ coalesceWindowMs: 0 }),
        assertCurrent: vi.fn(),
        deliver: h.deliver,
        evaluateDecision: h.evaluateDecision,
        assembleDecisionContext,
      };
      const customRouter = new Perception(customDeps);

      h.evaluateDecision.mockResolvedValueOnce({
        status: "ok",
        result: {
          answers: {
            wake_decision: {
              type: "choice",
              choice: "WAKE",
              probabilities: { WAKE: 0.9, IGNORE: 0.1 },
            },
          },
        },
      });

      await customRouter.receive("alice", stimulus("context-msg"));

      expect(assembleDecisionContext).toHaveBeenCalledTimes(1);
      const call = h.evaluateDecision.mock.calls[0][0];
      expect(call.state.recentChannelContext).toEqual([
        "[bob 11:55] Hello",
        "[alice 11:56] Hi Bob",
      ]);
    });

    it("fails open to wake when decision model returns unavailable for idle brain", async () => {
      const h = setup();
      h.evaluateDecision.mockResolvedValueOnce({
        status: "unavailable",
        reason: "not-configured",
      });

      await h.router.receive("alice", stimulus("idle-msg"));

      expect(h.deliver).toHaveBeenCalledTimes(1);
      expect(h.deliveries[0]).toMatchObject({
        agentId: "alice",
        mode: "followup",
        ids: ["idle-msg"],
      });
      expect(h.snapshot().pending).toHaveLength(0);
    });

    it("fails open to steer when decision model returns unavailable for busy brain", async () => {
      const h = setup();
      await h.router.started("alice", "run-busy");
      h.evaluateDecision.mockResolvedValueOnce({
        status: "unavailable",
        reason: "service-error",
      });

      await h.router.receive("alice", stimulus("busy-msg"));

      expect(h.deliver).toHaveBeenCalledTimes(1);
      expect(h.deliveries[0]).toMatchObject({
        agentId: "alice",
        mode: "steer",
        ids: ["busy-msg"],
      });
      expect(h.snapshot().pending).toHaveLength(0);
    });

    it("flushes immediately without waiting for debounce timer when pending items reach maxBatchSize", async () => {
      const h = setup({ coalesceWindowMs: 5000, maxBatchSize: 3 });
      // Send 3 stimuli; batch size is 3
      await h.router.receive("alice", stimulus("msg-1"));
      await h.router.receive("alice", stimulus("msg-2"));
      // 3rd stimulus reaches maxBatchSize=3 -> triggers immediate drain without waiting 5s
      await h.router.receive("alice", stimulus("msg-3"));

      expect(h.deliver).toHaveBeenCalledTimes(1);
      expect(h.deliveries[0].ids).toEqual(["msg-1", "msg-2", "msg-3"]);
      expect(h.snapshot().pending).toHaveLength(0);
    });

    it("evaluates new items without looping when pending queue contains more items than maxBatchSize", async () => {
      const h = setup({ maxBatchSize: 2 });
      await h.router.started("alice", "run-1");

      // Seed 2 already evaluated QUEUE_NEXT items
      h.states.set("alice", {
        pending: [
          { ...stimulus("old-1"), action: "QUEUE_NEXT" },
          { ...stimulus("old-2"), action: "QUEUE_NEXT" },
        ],
        brainRun: "run-1",
      });

      h.evaluateDecision.mockResolvedValueOnce({
        status: "ok",
        result: {
          answers: {
            attention_allocation: {
              type: "choice",
              choice: "QUEUE_NEXT",
            },
          },
        },
      });

      // Send 3rd item
      await h.router.receive("alice", stimulus("new-3"));

      // Jev was asked about new-3
      expect(h.evaluateDecision).toHaveBeenCalledTimes(1);
      const call = h.evaluateDecision.mock.calls[0][0];
      expect(call.state.incomingBundle).toHaveLength(1);
      expect(call.state.incomingBundle[0].id).toBe("new-3");

      // All 3 items are now evaluated as QUEUE_NEXT
      const state = h.snapshot("alice");
      expect(state.pending).toHaveLength(3);
      expect(state.pending.every((item) => item.action === "QUEUE_NEXT")).toBe(
        true,
      );
    });

    it("formats delivery message as human and LLM-readable markdown envelope without raw JSON", async () => {
      const h = setup();
      await h.router.receive(
        "alice",
        stimulus("chat-msg", "alice", "Can you help me?"),
      );

      expect(h.deliveries[0].message).not.toContain(
        "[kazusa:skill=task-interrupt]",
      );
      expect(h.deliveries[0].message).toContain("Incoming chats:");
      expect(h.deliveries[0].message).toContain(
        "- [`bob` Sat 2026-10-24 12:00] (chat:direct:bob): Can you help me?",
      );
      // No raw JSON stringification
      expect(h.deliveries[0].message).not.toContain("[kazusa\\u003a");
      expect(h.deliveries[0].message).not.toContain('{"id":');
      expect(h.deliveries[0].sessionKeys).toEqual([
        "agent:alice:chat:direct:bob",
      ]);
    });

    it("notifies onAdopted listeners with delivery session keys upon host adoption", async () => {
      const h = setup();
      const adopted: string[] = [];
      h.router.onAdopted((delivery) => {
        adopted.push(...(delivery.sessionKeys ?? []));
      });
      await h.router.receive(
        "alice",
        stimulus("chat-msg-2", "alice", "Testing auto typing"),
      );
      expect(h.deliver).toHaveBeenCalledTimes(1);
      expect(adopted).toEqual(["agent:alice:chat:direct:bob"]);
    });
  });
});

describe("Human reply timing and task boundaries", () => {
  const HOUR = 3_600_000;
  const study = (id = "study", endAt = NOW + HOUR): ActiveTask => ({
    id,
    type: "studying",
    description: "Revising for the exam",
    duration: 60,
    startedAt: new Date(NOW).toISOString(),
    endAt: new Date(endAt).toISOString(),
  });
  const requests: DecisionContextRequest[] = [];
  /** Mirror the real batch: idle bundles carry the latency score question. */
  const assembleDecisionContext = vi.fn(
    async (
      _agentId: string,
      request: DecisionContextRequest,
    ): Promise<DecisionBatch> => {
      requests.push(request);
      return {
        state: {},
        questions:
          request.brainStatus === "idle"
            ? {
                wake_decision: { type: "choice", criteria: {} },
                response_latency: {
                  type: "score",
                  criteria: [
                    { minutes: 0, description: "Now" },
                    { minutes: 60, description: "An hour" },
                  ],
                },
              }
            : { attention_allocation: { type: "choice", criteria: {} } },
      };
    },
  );
  const answer = (choice: string, score = 0) => ({
    status: "ok",
    result: {
      answers: {
        wake_decision: { type: "choice", choice },
        attention_allocation: { type: "choice", choice },
        response_latency: { type: "score", score, probabilities: [] },
      },
    },
  });

  beforeEach(() => {
    requests.length = 0;
    vi.spyOn(Math, "random").mockReturnValue(0.5); // No jitter.
  });
  afterEach(() => vi.restoreAllMocks());

  it("maps latency scores onto log-spaced anchors with jitter", () => {
    expect(latencyMs(0, [0, 1, 5, 20, 60], () => 0.5)).toBe(0);
    expect(latencyMs(2, [0, 1, 5, 20, 60], () => 0.5)).toBe(5 * 60_000);
    expect(latencyMs(9, [0, 60], () => 0.5)).toBe(HOUR);
    const half = latencyMs(0.5, [0, 60], () => 0.5) / 60_000;
    expect(half).toBeGreaterThan(5);
    expect(half).toBeLessThan(10);
    expect(latencyMs(1, [0, 60], () => 0)).toBe(0.8 * HOUR);
    expect(latencyMs(1, [0, 60], () => 1)).toBe(1.2 * HOUR);
    expect(latencyMs(1, [], () => 0.5)).toBe(0);
  });

  it("defers a message until the activity ends and delivers it with the check-in", async () => {
    const h = setup({ assembleDecisionContext });
    h.tasks.set("alice", study());
    h.evaluateDecision.mockResolvedValue(answer("DEFER"));
    await h.router.receive("alice", stimulus("text"));
    expect(h.deliver).not.toHaveBeenCalled();
    expect(h.snapshot().pending[0]).toMatchObject({
      action: "QUEUE_NEXT",
      until: { taskId: "study" },
    });

    await h.router.drain("alice");
    expect(h.deliver).not.toHaveBeenCalled();

    h.setTime(NOW + HOUR);
    await h.router.deadline("alice");
    expect(h.deliveries).toHaveLength(1);
    expect(h.deliveries[0].ids).toEqual([
      `task-deadline:study:${new Date(NOW + HOUR).toISOString()}`,
      "text",
    ]);
    expect(h.deliveries[0].message).toContain("Incoming chats:");
    expect(h.deliveries[0].message).toContain("Activity check-in");
  });

  it("keeps waiting when the activity is extended and releases on replacement", async () => {
    const h = setup({ assembleDecisionContext });
    h.tasks.set("alice", study());
    h.evaluateDecision.mockResolvedValue(answer("DEFER"));
    await h.router.receive("alice", stimulus("text"));
    h.setTime(NOW + HOUR);
    h.tasks.set("alice", study("study", NOW + 2 * HOUR)); // delay_task
    await h.router.drain("alice");
    expect(h.deliver).not.toHaveBeenCalled();
    h.tasks.set("alice", study("snack", NOW + 2 * HOUR)); // start_task
    await h.router.drain("alice");
    expect(h.deliveries[0].ids).toEqual(["text"]);
  });

  it("delays an idle wake by the scored latency, then wakes on its own", async () => {
    const h = setup({ assembleDecisionContext, readinessPollMs: 10 });
    h.evaluateDecision.mockResolvedValue(answer("WAKE", 1));
    await h.router.receive("alice", stimulus("text"));
    expect(h.deliver).not.toHaveBeenCalled();
    expect(h.snapshot().pending[0].until).toEqual({ notBefore: NOW + HOUR });
    h.setTime(NOW + HOUR);
    await vi.waitFor(() => expect(h.deliveries[0]?.ids).toEqual(["text"]));
    expect(h.evaluateDecision).toHaveBeenCalledTimes(1);
  });

  it("records each decision as its own entry, beside the character state", async () => {
    const h = setup({ assembleDecisionContext });
    h.tasks.set("alice", study());
    h.evaluateDecision.mockResolvedValue(answer("WAKE", 1));
    await h.router.receive("alice", stimulus("text"));
    h.evaluateDecision.mockResolvedValue({
      status: "unavailable",
      reason: "timeout",
    });
    await h.router.receive("alice", stimulus("again"));

    expect([...h.decisions.keys()]).toEqual([
      expect.stringMatching(/^alice:decision:/),
      expect.stringMatching(/^alice:decision:/),
    ]);
    const recorded = await h.router.decisions();
    expect(recorded.map(({ agentId }) => agentId)).toEqual(["alice", "alice"]);
    expect(recorded[0].record).toMatchObject({
      question: "wake_decision",
      action: "STEER",
      source: "model",
      choice: "WAKE",
      latencyScore: 1,
      delayMs: HOUR,
      simTime: NOW,
      stimulusIds: ["text"],
      taskId: "study",
    });
    expect(recorded[1].record).toMatchObject({
      action: "STEER",
      source: "fallback",
      note: "decision unavailable: timeout",
    });

    // Recovery walks character states only, never decision entries.
    await h.restart().recover();
    expect([...h.states.keys()]).toEqual(["alice"]);
  });

  it("checks earlier when the activity ends before the delay", async () => {
    const h = setup({ assembleDecisionContext });
    h.tasks.set("alice", study("study", NOW + 5 * 60_000));
    h.evaluateDecision.mockResolvedValue(answer("WAKE", 1));
    await h.router.receive("alice", stimulus("text"));
    expect(h.snapshot().pending[0].until).toEqual({
      notBefore: NOW + HOUR,
      taskId: "study",
    });
    h.setTime(NOW + 5 * 60_000);
    await h.router.deadline("alice");
    expect(h.deliveries[0].ids).toContain("text");
  });

  it("shows everything waiting once something gets an immediate wake", async () => {
    const h = setup({ assembleDecisionContext });
    h.tasks.set("alice", study());
    h.evaluateDecision.mockResolvedValueOnce(answer("DEFER"));
    await h.router.receive("alice", stimulus("homework"));
    h.evaluateDecision.mockResolvedValueOnce(answer("WAKE", 0));
    await h.router.receive("alice", stimulus("emergency"));
    expect(h.deliveries).toHaveLength(1);
    expect([...h.deliveries[0].ids].sort()).toEqual(["emergency", "homework"]);
  });

  it("lets a busy brain defer to the activity boundary instead of the next thought", async () => {
    const h = setup({ assembleDecisionContext });
    h.tasks.set("alice", study());
    await h.router.started("alice", "busy");
    h.evaluateDecision.mockResolvedValue(answer("DEFER"));
    await h.router.receive("alice", stimulus("text"));
    await h.router.ended("alice", "busy", false);
    expect(h.deliver).not.toHaveBeenCalled();
    h.setTime(NOW + HOUR);
    await h.router.deadline("alice");
    expect(h.deliveries[0].ids).toContain("text");
  });

  it("discards ignored stimuli for good and reports only what the brain was shown", async () => {
    const h = setup({ assembleDecisionContext });
    h.tasks.set("alice", study());
    h.evaluateDecision.mockResolvedValueOnce(answer("IGNORE"));
    await h.router.receive("alice", stimulus("chatter"));
    h.evaluateDecision.mockResolvedValueOnce(answer("DEFER"));
    await h.router.receive("alice", stimulus("later"));
    let noticed = await h.router.noticed("alice");
    expect(noticed(stimulus("chatter"))).toBe(false);
    expect(noticed(stimulus("later"))).toBe(false);

    h.setTime(NOW + HOUR);
    await h.router.deadline("alice");
    expect(h.deliveries[0].ids).not.toContain("chatter");
    noticed = await h.router.noticed("alice");
    expect(noticed(stimulus("chatter"))).toBe(false);
    expect(noticed(stimulus("later"))).toBe(true);
    // A duplicate of the ignored stimulus is still deduplicated.
    await h.router.receive("alice", stimulus("chatter"));
    expect(h.snapshot().pending.map((item) => item.id)).not.toContain(
      "chatter",
    );
  });

  it("treats a deferral with no activity as attention now", async () => {
    const h = setup({ assembleDecisionContext });
    h.evaluateDecision.mockResolvedValue(answer("DEFER"));
    await h.router.receive("alice", stimulus("text"));
    expect(h.deliveries[0].ids).toEqual(["text"]);
  });

  it("shows Jev the speech in progress and cuts it off on a steer", async () => {
    const h = setup({ assembleDecisionContext });
    const speech = {
      current: vi.fn(() => ({
        sessionKey: "agent:alice:chat:direct:bob",
        said: ["Wait..."],
        unsaid: ["I told you not to go!"],
      })),
      interrupt: vi.fn(() => true),
    };
    h.router.attachSpeech(speech);
    await h.router.started("alice", "busy");
    h.evaluateDecision.mockResolvedValueOnce(answer("QUEUE_NEXT"));
    await h.router.receive("alice", stimulus("uh huh"));
    expect(speech.interrupt).not.toHaveBeenCalled();
    expect(requests.at(-1)?.currentSpeech).toEqual(speech.current());
    h.evaluateDecision.mockResolvedValueOnce(answer("STEER"));
    await h.router.receive("alice", stimulus("I didn't actually go!"));
    expect(speech.interrupt).toHaveBeenCalledExactlyOnceWith("alice");
    expect(h.deliveries[0]).toMatchObject({
      mode: "steer",
      ids: ["I didn't actually go!"],
    });
  });
});

describe("Foreseen stimuli", () => {
  it("holds a stimulus until its moment, then keeps it only if confirmed", async () => {
    const confirm = vi.fn<NonNullable<PerceptionDeps["confirm"]>>(
      async (_agentId, item) =>
        item.id === "seen"
          ? { ...item, text: "Bob waves from across the courtyard." }
          : undefined,
    );
    const h = setupWake({ readinessPollMs: 10, confirm });
    const ahead = (id: string): Stimulus => ({
      id,
      sessionKey: "agent:alice:tasks",
      sender: "bob",
      text: `Bob crosses the courtyard (${id}).`,
      timestamp: NOW + 60_000,
      foreseen: true,
    });
    await h.router.receive("alice", ahead("seen"));
    await h.router.receive("alice", ahead("gone"));
    // Not happened yet: neither judged nor confirmed.
    expect(h.evaluateDecision).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();

    h.setTime(NOW + 60_000);
    await vi.waitFor(() => expect(h.deliveries[0]?.ids).toEqual(["seen"]));
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(h.deliveries[0]?.message).toContain(
      "Seen around you:\n- [Sat 2026-10-24 12:01] Bob waves from across the courtyard.",
    );
    expect(h.snapshot().pending).toEqual([]);
  });

  it("wakes for a sighting outside the tool call that foresaw it", async () => {
    // Live: foreseen during start_task, the timer woke inside that closed
    // call, and the decision runtime and brain handoff refused.
    const caller = new AsyncLocalStorage<string>();
    const scopes: (string | undefined)[] = [];
    const confirm = vi.fn<NonNullable<PerceptionDeps["confirm"]>>(
      async (_agentId, item) => {
        scopes.push(caller.getStore());
        return item;
      },
    );
    const h = setupWake({ readinessPollMs: 10, confirm });
    await caller.run("start_task", () =>
      h.router.receive("alice", {
        id: "seen",
        sessionKey: "agent:alice:tasks",
        sender: "bob",
        text: "Bob is here.",
        timestamp: NOW + 60_000,
        foreseen: true,
      }),
    );
    h.setTime(NOW + 60_000);
    await vi.waitFor(() => expect(h.deliveries[0]?.ids).toEqual(["seen"]));
    expect(scopes).toEqual([undefined]);
  });

  it("judges and hands over a burst outside the call that delivered it", async () => {
    // Live: stimuli from a CLI `location.place` call were judged inside its
    // scope after the client disconnected, and every decision fell back.
    const caller = new AsyncLocalStorage<string>();
    const scopes: (string | undefined)[] = [];
    const h = setupWake({ coalesceWindowMs: 10 });
    h.evaluateDecision.mockImplementation(async () => {
      scopes.push(caller.getStore());
      return {
        status: "ok",
        result: {
          answers: { wake_decision: { type: "choice", choice: "WAKE" } },
        },
      };
    });
    await caller.run("location.place", () =>
      h.router.receive("alice", stimulus("placed")),
    );
    await vi.waitFor(() => expect(h.deliveries[0]?.ids).toEqual(["placed"]));
    expect(scopes).toEqual([undefined]);
  });

  it("hands nothing over while the clock is paused, and takes it up on resume", async () => {
    // Live: paused mid-meeting, four characters kept steering each other at
    // one sim instant.
    const h = setupWake();
    h.setSpeed(0);
    await h.router.receive("alice", stimulus("held"));
    expect(h.deliveries).toEqual([]);
    expect(h.evaluateDecision).not.toHaveBeenCalled();
    expect(h.snapshot().pending.map((item) => item.id)).toEqual(["held"]);
    h.setSpeed(1);
    await h.router.resume();
    expect(h.deliveries[0]?.ids).toEqual(["held"]);
  });

  it("admits the system agent immediately while peers stay frozen, including busy steering", async () => {
    const h = setupWake({ systemAgentId: "alice" });
    h.setSpeed(0);
    // A long activity must not make console input wait for its sim deadline.
    h.tasks.set("alice", {
      id: "console-task",
      type: "working",
      description: "Assisting Sensei",
      duration: 60,
      startedAt: new Date(NOW).toISOString(),
      endAt: new Date(NOW + 3_600_000).toISOString(),
    });
    await h.router.receive("bob", stimulus("peer-held", "bob"));
    await h.router.receive("alice", stimulus("console"));
    expect(h.deliveries.map((d) => d.ids)).toEqual([["console"]]);
    expect(h.evaluateDecision).not.toHaveBeenCalled();
    await h.router.started("alice", "console-run");
    await h.router.receive("alice", stimulus("follow-up"));
    expect(h.deliveries[1]).toMatchObject({
      mode: "steer",
      ids: ["follow-up"],
    });
    expect(h.snapshot("bob").pending.map((item) => item.id)).toEqual([
      "peer-held",
    ]);
    expect(h.evaluateDecision).not.toHaveBeenCalled();
  });

  it("keeps the system agent's offstage gate", async () => {
    const h = setupWake({ systemAgentId: "alice", onstage: async () => false });
    h.setSpeed(0);
    await h.router.receive("alice", stimulus("offstage"));
    expect(h.deliveries).toEqual([]);
  });

  it("does not give the system agent a foreseen event before its sim timestamp", async () => {
    const h = setupWake({ systemAgentId: "alice" });
    h.setSpeed(0);
    await h.router.receive("alice", {
      ...stimulus("future"),
      timestamp: NOW + 60_000,
    });
    expect(h.deliveries).toEqual([]);
    expect(h.evaluateDecision).not.toHaveBeenCalled();
    h.setTime(NOW + 60_000);
    await h.router.drain("alice");
    expect(h.deliveries[0]?.ids).toEqual(["future"]);
  });

  it("keeps texts to an offstage character, unjudged, until they come back", async () => {
    const offstage = new Set(["alice"]);
    const h = setupWake({ onstage: async (id) => !offstage.has(id) });
    await h.router.receive("alice", stimulus("while-away"));
    await h.router.idleWake("alice");
    expect(h.deliveries).toEqual([]);
    expect(h.evaluateDecision).not.toHaveBeenCalled();
    expect(h.snapshot().pending).toHaveLength(2);
    offstage.delete("alice");
    await h.router.drain("alice");
    expect(h.deliveries).toHaveLength(1);
    expect(h.deliveries[0]?.ids).toContain("while-away");
  });

  it("leaves a sighting that has not happened out of what was waiting", async () => {
    const confirm = vi.fn<NonNullable<PerceptionDeps["confirm"]>>(
      async (_agentId, item) => ({ ...item, text: "Bob waves." }),
    );
    const h = setup({ confirm });
    // Live: picking up the phone for a queued chat handed over a crossing
    // stamped a minute later, unconfirmed, with its placeholder text.
    h.states.set("alice", {
      pending: [
        { ...stimulus("waiting"), action: "QUEUE_NEXT" },
        {
          id: "later",
          sessionKey: "agent:alice:tasks",
          sender: "bob",
          text: "Bob is here.",
          timestamp: NOW + 60_000,
          foreseen: true,
        },
      ],
    });
    await h.router.ended("alice", "earlier", false);
    expect(h.deliveries[0]?.ids).toEqual(["waiting"]);
    expect(confirm).not.toHaveBeenCalled();
    expect(h.snapshot().pending.map((item) => item.id)).toEqual(["later"]);
  });
});
