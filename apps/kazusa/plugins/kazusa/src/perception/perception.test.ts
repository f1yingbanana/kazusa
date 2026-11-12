import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
type BackgroundWork = <T>(run: () => Promise<T>) => Promise<T>;
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
import { BrainSlots } from "./brain-slots.ts";
import type { DecisionStore } from "./decision-database.ts";

const NOW = Date.parse("2026-10-24T12:00:00Z");

function stimulus(
  id: string,
  agentId = "alice",
  text = `Message ${id}`,
): Stimulus {
  return {
    id,
    sessionKey: `agent:${agentId}:chat:direct:bob`,
    // Distinct senders, so only the burst tests fold messages together.
    sender: `sender-${id}`,
    text,
    timestamp: NOW,
  };
}

type SetupOptions = Partial<PerceptionConfig> & {
  backgroundWork?: BackgroundWork;
  assembleDecisionContext?: PerceptionDeps["assembleDecisionContext"];
  confirm?: PerceptionDeps["confirm"];
  onstage?: PerceptionDeps["onstage"];
  realtime?: PerceptionDeps["realtime"];
  systemAgentId?: string;
};

type Judged = Parameters<NonNullable<PerceptionDeps["onDecision"]>>[1];

function setup(options: SetupOptions = {}) {
  // The inbox namespace, and kept decisions keyed `<agentId>:decision:<n>`.
  const states = new Map<string, PerceptionState>();
  const decisions = new Map<string, PerceptionDecisionRecord>();
  /** Every decision, kept or not. */
  const judged: Judged[] = [];
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
      [...states].map(([key, value]) => ({
        key,
        createdAt: NOW,
        value: structuredClone(value),
      })),
  };
  const decisionStore: DecisionStore = {
    record: (agentId, record) => {
      z.json().parse(record);
      decisions.set(
        `${agentId}:decision:${decisions.size}`,
        structuredClone(record),
      );
    },
    // Newest first, as the database answers.
    window: ({ before, after, actors }) =>
      [...decisions]
        .map(([key, record]) => ({
          agentId: key.slice(0, key.indexOf(":decision:")),
          record: structuredClone(record),
        }))
        .filter(
          ({ agentId, record }) =>
            (before === undefined || record.simTime < before) &&
            (after === undefined || record.simTime > after) &&
            (!actors || actors.includes(agentId)),
        )
        .reverse(),
  };

  const {
    backgroundWork = async (run) => run(),
    confirm,
    onstage,
    realtime,
    systemAgentId,
    ...configOptions
  } = options;
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
    onDecision: (_agentId: string, decision: Judged) => {
      judged.push(decision);
    },
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
    ...(realtime ? { realtime } : {}),
    api: {
      lifecycle: { runInBackgroundContext: backgroundWork },
      runtime: {
        agent: { resolveAgentWorkspaceDir: () => undefined },
        config: {
          current: () => ({
            agents: {
              defaults: {
                ...(systemAgentId
                  ? { systemAgent: { agentId: systemAgentId } }
                  : {}),
              },
            },
          }),
        },
      },
      logger: { info: vi.fn(), warn: vi.fn() },
    } as unknown as OpenClawPluginApi,
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
    judged,
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

/** Jev wants every stimulus seen now: woken at once, or steered into a turn. */
function setupWake(options: SetupOptions = {}) {
  const h = setup(options);
  h.evaluateDecision.mockResolvedValue({
    status: "ok",
    result: {
      answers: {
        wake_decision: { type: "choice", choice: "WAKE" },
        attention_allocation: { type: "choice", choice: "STEER" },
        response_latency: { type: "score", score: 0 },
      },
    },
  });
  return h;
}

describe("Brain slots", () => {
  it("merges what arrives while waiting into one turn when a slot opens", async () => {
    const h = setupWake({ maxConcurrentBrains: 1 });
    let finishBob = (): void => {};
    h.deliver.mockImplementationOnce(async (delivery, lifecycle) => {
      h.deliveries.push(structuredClone(delivery));
      await lifecycle.onAdopted();
      await new Promise<void>((resolve) => {
        finishBob = resolve;
      });
    });
    await h.router.receive("bob", {
      ...stimulus("bob-1"),
      sessionKey: "agent:bob:tasks",
    });
    await vi.waitFor(() => expect(h.deliveries).toHaveLength(1));

    await h.router.receive("alice", stimulus("first"));
    await h.router.receive("alice", stimulus("second"));
    await vi.waitFor(() =>
      expect(h.snapshot().pending.map((item) => item.id)).toEqual([
        "first",
        "second",
      ]),
    );
    expect(h.deliveries).toHaveLength(1);
    expect(h.snapshot().deliveries).toBeUndefined();

    finishBob();
    await vi.waitFor(() => expect(h.deliveries).toHaveLength(2));
    expect(h.deliveries[1].agentId).toBe("alice");
    expect(h.deliveries[1].ids).toEqual(["first", "second"]);
  });

  it("gives the slot back when there is nothing to hand over", async () => {
    const slots = new BrainSlots();
    expect(slots.acquire("a", 1, () => {})).toBe(true);
    const granted = vi.fn();
    expect(slots.acquire("b", 1, granted)).toBe(false);
    expect(slots.acquire("b", 1, granted)).toBe(false);
    slots.release("a", 1);
    expect(granted).toHaveBeenCalledTimes(1);
    expect(slots.acquire("b", 1, granted)).toBe(true);
    slots.release("b", 1);
    expect(slots.acquire("c", 1, () => {})).toBe(true);
  });
});

describe("Decision fallback", () => {
  const group = (id: string): Stimulus => ({
    ...stimulus(id),
    sessionKey: "agent:alice:chat:group:guild",
  });

  it("defers a group chat when the decision fails", async () => {
    const h = setup();
    h.tasks.set("alice", {
      id: "work",
      summary: "Working",
      startAt: new Date(NOW).toISOString(),
      endAt: new Date(NOW + 3_600_000).toISOString(),
    } as unknown as ActiveTask);
    h.evaluateDecision.mockRejectedValue(new Error("overloaded"));
    await h.router.receive("alice", group("a"));
    expect(h.deliver).not.toHaveBeenCalled();
    expect(h.snapshot().pending[0].action).toBe("QUEUE_NEXT");
  });

  it("still admits a direct chat when the decision fails", async () => {
    const h = setup();
    h.evaluateDecision.mockRejectedValue(new Error("overloaded"));
    await h.router.receive("alice", stimulus("a"));
    expect(h.deliveries[0].ids).toEqual(["a"]);
  });
});

describe("How they say it", () => {
  const facts = {
    sessionKey: "agent:alice:chat:huddle:club",
    medium: "speaking" as const,
    floor: { speaking: ["bob"], turn: "bob", waiting: 0 },
  };
  const paces = [0.6, 0.8, 1, 1.25, 1.6].map((pace) => ({
    pace,
    description: String(pace),
  }));
  /** The real assembler's questions, without its file reads. */
  const withSpeechQuestions = (floor: boolean) =>
    vi.fn(async (_id: string, params: DecisionContextRequest) => ({
      state: { brainStatus: params.brainStatus, incomingBundle: [] },
      questions: {
        pace: {
          type: "score" as const,
          instructions: "How fast?",
          criteria: paces,
        },
        ...(floor
          ? {
              floor: {
                type: "choice" as const,
                instructions: "How badly?",
                criteria: { CUT_IN: "c", NEXT: "n", WAIT: "w" },
              },
            }
          : {}),
      },
    }));

  it("asks how fast they talk and how badly they want in, in one call", async () => {
    const assembleDecisionContext = withSpeechQuestions(true);
    const h = setup({ assembleDecisionContext });
    h.evaluateDecision.mockResolvedValue({
      status: "ok",
      result: {
        answers: {
          floor: { type: "choice", choice: "CUT_IN" },
          pace: { type: "score", score: 3 },
        },
      },
    });
    expect(await h.router.judgeSpeech("alice", facts)).toEqual({
      floor: "CUT_IN",
      pace: 1.25,
    });
    expect(h.evaluateDecision).toHaveBeenCalledOnce();
    expect(h.evaluateDecision.mock.calls[0][1]).toMatchObject({
      agentId: "alice",
      purpose: "perception.speech",
    });
    expect(assembleDecisionContext.mock.calls[0][1]).toMatchObject({
      brainStatus: "busy_thinking",
      incomingBundle: [],
      speech: facts,
    });
    // Their own impulse, not attention: nothing is recorded or queued.
    expect(h.decisions.size).toBe(0);
    expect(h.states.size).toBe(0);
  });

  it("takes the next pause at an ordinary pace when the answer is unusable", async () => {
    const h = setup({ assembleDecisionContext: withSpeechQuestions(true) });
    h.evaluateDecision.mockResolvedValueOnce({
      status: "ok",
      result: { answers: { floor: { type: "choice", choice: "SHOUT" } } },
    });
    expect(await h.router.judgeSpeech("alice", facts)).toEqual({
      floor: "NEXT",
      pace: 1,
    });
    h.evaluateDecision.mockResolvedValueOnce({
      status: "unavailable",
      reason: "overloaded",
    });
    expect(await h.router.judgeSpeech("alice", facts)).toEqual({
      floor: "NEXT",
      pace: 1,
    });
    h.evaluateDecision.mockRejectedValueOnce(new Error("timeout"));
    expect(await h.router.judgeSpeech("alice", facts)).toEqual({
      floor: "NEXT",
      pace: 1,
    });
  });
});

describe("Tuning out", () => {
  const lunch = "agent:alice:chat:huddle:lunch";
  const line = (id: string): Stimulus => ({
    ...stimulus(id),
    sessionKey: lunch,
    text: "Anyway, the vending machine ate my coins again.",
  });
  /** Asks `still_following` whenever lunch talk is among what they hear. */
  const asking = vi.fn(async (id: string, params: DecisionContextRequest) => {
    const quiet = params.incomingBundle.some(
      (item) => item.sessionKey === lunch,
    );
    return {
      state: {
        character: { id },
        incomingBundle: params.incomingBundle.map((item) => item.id),
        ...(quiet
          ? { quietIn: { conversation: "chat:huddle:lunch", quietMinutes: 12 } }
          : {}),
      },
      questions: {
        wake_decision: {
          type: "choice" as const,
          instructions: "Judge attention",
          criteria: {},
        },
        ...(quiet
          ? {
              still_following: {
                type: "choice" as const,
                instructions: "Still following?",
                criteria: {},
              },
            }
          : {}),
      },
    };
  });
  const answer = (
    following: "FOLLOWING" | "TUNED_OUT",
    wake: "WAKE" | "IGNORE" = "IGNORE",
  ) => ({
    status: "ok",
    result: {
      answers: {
        wake_decision: { type: "choice", choice: wake },
        response_latency: { type: "score", score: 0 },
        still_following: { type: "choice", choice: following },
      },
    },
  });

  it("leaves a conversation they stopped following, and never hears what was said there", async () => {
    const h = setup({ assembleDecisionContext: asking });
    const tuneOut = vi.fn(async () => true);
    h.router.attachConversations({ tuneOut });
    h.evaluateDecision.mockResolvedValue(answer("TUNED_OUT"));
    await h.router.receive("alice", line("lunch-1"));
    await vi.waitFor(() =>
      expect(tuneOut).toHaveBeenCalledWith("alice", "chat:huddle:lunch"),
    );
    expect(h.deliveries).toEqual([]);
    const state = h.snapshot();
    expect(state.pending).toEqual([]);
    expect(state.tunedOut).toEqual([
      { conversation: "chat:huddle:lunch", at: NOW },
    ]);
    expect(h.judged).toEqual([
      expect.objectContaining({
        action: "IGNORE",
        tunedOut: "chat:huddle:lunch",
      }),
    ]);
    // Kept for the timeline: the conversation they left, not its lines.
    expect([...h.decisions.values()]).toEqual([
      {
        simTime: NOW,
        wallTime: expect.any(Number),
        lines: [],
        tunedOut: "huddle:lunch",
      },
    ]);

    // A line said there before they left, arriving late, goes unheard too.
    h.evaluateDecision.mockClear();
    await h.router.receive("alice", { ...line("lunch-2"), timestamp: NOW - 1 });
    expect(h.evaluateDecision).not.toHaveBeenCalled();
    expect(h.snapshot().pending).toEqual([]);

    // Anything else still reaches them, without the conversation they left.
    h.evaluateDecision.mockResolvedValue(answer("FOLLOWING", "WAKE"));
    await h.router.receive("alice", stimulus("text-1"));
    await vi.waitFor(() => expect(h.deliveries).toHaveLength(1));
    expect(h.deliveries[0].ids).toEqual(["text-1"]);
    expect(tuneOut).toHaveBeenCalledOnce();
  });

  it("drops lines from there still waiting, not only those just judged", async () => {
    // A line approved earlier, waiting for the next turn, would otherwise wake
    // them for a conversation they had already left.
    const h = setup({ assembleDecisionContext: asking });
    h.router.attachConversations({ tuneOut: vi.fn(async () => true) });
    h.states.set("alice", {
      pending: [
        { ...line("lunch-0"), timestamp: NOW - 60_000, action: "QUEUE_NEXT" },
        { ...stimulus("text-0"), action: "QUEUE_NEXT" },
      ],
    });
    h.evaluateDecision.mockResolvedValue(answer("TUNED_OUT"));
    await h.router.receive("alice", line("lunch-1"));
    await vi.waitFor(() => expect(h.deliveries).toHaveLength(1));
    expect(h.deliveries[0].ids).toEqual(["text-0"]);
    expect(
      h.snapshot().pending.filter(({ id }) => id.startsWith("lunch")),
    ).toEqual([]);
  });

  it("goes on as before while they still follow it", async () => {
    const h = setup({ assembleDecisionContext: asking });
    const tuneOut = vi.fn(async () => true);
    h.router.attachConversations({ tuneOut });
    h.evaluateDecision.mockResolvedValue(answer("FOLLOWING", "WAKE"));
    await h.router.receive("alice", line("lunch-1"));
    await vi.waitFor(() => expect(h.deliveries).toHaveLength(1));
    expect(h.deliveries[0].ids).toEqual(["lunch-1"]);
    expect(tuneOut).not.toHaveBeenCalled();
    expect(h.judged[0]).not.toHaveProperty("tunedOut");
    expect(h.decisions.size).toBe(0);
  });

  it("still follows lines it would wake for, whatever the second answer", async () => {
    // Someone named in the conversation is listening, even if the second
    // answer says otherwise.
    const h = setup({ assembleDecisionContext: asking });
    const tuneOut = vi.fn(async () => true);
    h.router.attachConversations({ tuneOut });
    h.evaluateDecision.mockResolvedValue(answer("TUNED_OUT", "WAKE"));
    await h.router.receive("alice", line("lunch-1"));
    await vi.waitFor(() => expect(h.deliveries).toHaveLength(1));
    expect(tuneOut).not.toHaveBeenCalled();
    expect(h.snapshot().tunedOut).toBeUndefined();
  });

  it("ignores a tuned-out answer to a question it never asked", async () => {
    const h = setup();
    const tuneOut = vi.fn(async () => true);
    h.router.attachConversations({ tuneOut });
    h.evaluateDecision.mockResolvedValue(answer("TUNED_OUT", "WAKE"));
    await h.router.receive("alice", line("lunch-1"));
    await vi.waitFor(() => expect(h.deliveries).toHaveLength(1));
    expect(tuneOut).not.toHaveBeenCalled();
  });

  it.each([
    ["can't leave", async () => false],
    [
      "fails to leave",
      async () => {
        throw new Error("messaging unavailable");
      },
    ],
  ])(
    "hears the conversation as before when they %s, and records no leave",
    async (_case, tuneOut) => {
      const h = setup({ assembleDecisionContext: asking });
      h.router.attachConversations({ tuneOut });
      h.evaluateDecision.mockResolvedValue(answer("TUNED_OUT"));
      await h.router.receive("alice", line("lunch-1"));
      await vi.waitFor(() => expect(h.judged).toHaveLength(1));
      const state = h.snapshot();
      expect(state.tunedOut).toBeUndefined();
      expect(h.judged[0]).not.toHaveProperty("tunedOut");
      // Someone else's line in person, not caught: nothing to show.
      expect(h.decisions.size).toBe(0);
      // Judged as the main answer says: ignored here, like any line.
      expect(state.pending).toEqual([]);
    },
  );
});

describe("Stale conversation", () => {
  const huddle = "agent:alice:chat:huddle:cafe";
  const line = (id: string, minutesAgo: number, sessionKey = huddle) => ({
    ...stimulus(id),
    sessionKey,
    timestamp: NOW - minutesAgo * 60_000,
  });

  it("lets unread lines of a conversation in person go, all but its newest", async () => {
    // Live: two huddles held 2,844 unread lines; most were minutes old.
    const h = setup();
    h.states.set("alice", {
      brainRun: "busy",
      pending: [
        { ...line("old", 5), action: "QUEUE_NEXT" },
        line("older", 3),
        line("recent", 1),
        line("last", 4, "agent:alice:chat:huddle:park"),
        line("text", 30, "agent:alice:chat:direct:bob"),
      ],
    });
    h.evaluateDecision.mockResolvedValue({
      status: "ok",
      result: {
        answers: {
          attention_allocation: { type: "choice", choice: "QUEUE_NEXT" },
        },
      },
    });
    await h.router.drain("alice");
    expect(h.snapshot().pending.map(({ id }) => id)).toEqual([
      "recent",
      "last",
      "text",
    ]);
  });

  it("keeps a line already handed to the brain", async () => {
    const h = setup();
    const held = line("held", 5);
    h.states.set("alice", {
      brainRun: "busy",
      pending: [held, line("newer", 0)],
      deliveries: [
        {
          id: "d",
          agentId: "alice",
          mode: "followup",
          message: "",
          ids: ["held"],
          keys: [stimulusKey(held)],
        },
      ],
    });
    h.evaluateDecision.mockResolvedValue({
      status: "ok",
      result: {
        answers: {
          attention_allocation: { type: "choice", choice: "QUEUE_NEXT" },
        },
      },
    });
    await h.router.drain("alice");
    expect(h.snapshot().pending.map(({ id }) => id)).toEqual(["held", "newer"]);
  });
});

describe("Message bursts", () => {
  const chat = "agent:alice:chat:direct:bob";
  const message = (id: string, timestamp: number, sender = "bob") => ({
    ...stimulus(id),
    sessionKey: chat,
    sender,
    text: `text ${id}`,
    timestamp,
  });

  it("folds a sender's burst into one item and adopts every message", async () => {
    const h = setupWake({ coalesceWindowMs: 60_000 });
    await h.router.receive("alice", message("a", NOW));
    await h.router.receive("alice", message("b", NOW + 30_000));
    await h.router.receive("alice", message("b", NOW + 30_000));
    expect(h.snapshot().pending).toHaveLength(1);
    expect(h.snapshot().pending[0].text).toBe("text a\ntext b");

    await h.router.drain("alice");
    await vi.waitFor(() => expect(h.deliveries).toHaveLength(1));
    expect(h.deliveries[0].keys).toEqual([
      stimulusKey({ id: "a", sessionKey: chat }),
      stimulusKey({ id: "b", sessionKey: chat }),
    ]);
  });

  it("records a burst left unread as all of its texts", async () => {
    const h = setupWake({ coalesceWindowMs: 60_000 });
    h.evaluateDecision.mockResolvedValue({
      status: "ok",
      result: {
        answers: { wake_decision: { type: "choice", choice: "IGNORE" } },
      },
    });
    await h.router.receive("alice", message("a", NOW));
    await h.router.receive("alice", message("b", NOW + 30_000));
    await h.router.receive("alice", message("c", NOW + 40_000));
    await h.router.drain("alice");
    await vi.waitFor(() => expect(h.decisions.size).toBe(1));
    expect([...h.decisions.values()][0].lines).toEqual([
      {
        messageId: "a",
        chatId: expect.stringMatching(/^direct:/),
        sender: "bob",
        excerpt: "text a text b text c",
        count: 3,
      },
    ]);
  });

  it("keeps apart other senders, later messages and sent items", async () => {
    const h = setupWake({ coalesceWindowMs: 60_000 });
    await h.router.receive("alice", message("a", NOW));
    await h.router.receive("alice", message("b", NOW + 1_000, "carol"));
    await h.router.receive("alice", message("c", NOW + 2_000));
    await h.router.receive("alice", message("d", NOW + 200_000));
    expect(h.snapshot().pending.map((item) => item.id)).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
  });
});

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

  it("checks in once for a task that has ended, however often its wake fires", async () => {
    // Unpausing re-arms every lease, ended ones too: the wake fires again for
    // a character still deciding what to do next.
    const h = setupWake();
    h.tasks.set("alice", {
      id: "task-1",
      type: "studying" as const,
      description: "Physics",
      duration: 60,
      startedAt: new Date(NOW - 3_600_000).toISOString(),
      endAt: new Date(NOW).toISOString(),
    });
    await h.router.deadline("alice");
    await h.router.ended("alice", "external", false);
    expect(h.deliveries).toHaveLength(1);
    h.setTime(NOW + 60_000);
    await h.router.deadline("alice");
    expect(h.deliveries).toHaveLength(1);
    expect(h.snapshot().pending).toEqual([]);
  });

  it("checks in again for the same task once it is delayed", async () => {
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
  });

  it("keeps a check-in an older record took in, when it drops its lists", async () => {
    const h = setupWake();
    const endAt = new Date(NOW).toISOString();
    h.tasks.set("alice", {
      id: "task-1",
      type: "studying" as const,
      description: "Physics",
      duration: 60,
      startedAt: new Date(NOW - 3_600_000).toISOString(),
      endAt,
    });
    h.states.set("alice", {
      pending: [],
      processedIds: [
        "a",
        stimulusKey({
          sessionKey: "agent:alice:tasks",
          id: `task-deadline:task-1:${endAt}`,
        }),
      ],
    } as never);
    await h.router.drain("alice");
    expect(h.snapshot()).not.toHaveProperty("processedIds");
    await h.router.deadline("alice");
    expect(h.deliveries).toEqual([]);
  });

  it("leaves out the stimulus key lists older records carry on their next save", async () => {
    const h = setupWake();
    h.states.set("alice", {
      pending: [],
      processedIds: ["a", "b"],
      ignoredIds: ["b"],
    } as never);
    await h.router.drain("alice");
    expect(h.snapshot()).not.toHaveProperty("processedIds");
    expect(h.snapshot()).not.toHaveProperty("ignoredIds");
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

  it("scopes IDs to the ledger and preserves original simulation time", async () => {
    const h = setupWake();
    const item = { ...stimulus("same"), timestamp: NOW - 123_456 };
    await h.router.receive("alice", item);
    expect(h.deliveries).toHaveLength(1);
    await h.router.receive("alice", {
      ...item,
      sessionKey: "agent:alice:chat:direct:carol",
    });
    expect(h.deliveries).toHaveLength(2);
    expect(h.deliveries[0].message).toContain("Sat 2026-10-24 11:57");
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

  it("sends one steer at a time and merges what is steered meanwhile", async () => {
    const h = setupWake();
    await h.router.started("alice", "run");
    let adopt: () => void | Promise<void> = () => {};
    h.deliver.mockImplementationOnce(async (delivery, lifecycle) => {
      h.deliveries.push(structuredClone(delivery));
      lifecycle.onDeferred?.();
      adopt = lifecycle.onAdopted;
    });
    await h.router.receive("alice", stimulus("a"));
    await h.router.receive("alice", stimulus("b"));
    await h.router.receive("alice", stimulus("c"));
    expect(h.deliveries.map(({ mode, ids }) => [mode, ids])).toEqual([
      ["steer", ["a"]],
    ]);
    await adopt();
    await vi.waitFor(() => expect(h.deliveries).toHaveLength(2));
    expect(h.deliveries[1]).toMatchObject({ mode: "steer", ids: ["b", "c"] });
    expect(h.snapshot().pending).toEqual([]);
  });

  it("takes back a steer its turn refused, for the next turn with the rest", async () => {
    // Live: each refused steer ran later as a turn of its own, oldest first,
    // still saying "noticed while thinking"; Noa spent 21 of 22 turns so.
    const h = setupWake();
    await h.router.started("alice", "old-run");
    h.deliver.mockImplementationOnce(async (_delivery, lifecycle) => {
      lifecycle.onDeferred?.();
    });
    await h.router.receive("alice", stimulus("a"));
    const [refused, lifecycle] = h.deliver.mock.calls[0];
    expect(refused.mode).toBe("steer");
    await h.router.receive("alice", stimulus("b"));
    expect(h.deliver).toHaveBeenCalledTimes(1);
    expect(h.snapshot().pending.map(({ id, action }) => [id, action])).toEqual([
      ["a", "STEER"],
      ["b", "STEER"],
    ]);

    await h.router.ended("alice", "old-run", false);
    expect(lifecycle.abortSignal?.aborted).toBe(true);
    expect(h.deliveries).toHaveLength(1);
    expect(h.deliveries[0]).toMatchObject({
      mode: "followup",
      ids: ["a", "b"],
    });
    // The host adopting it anyway, as it was taken back, changes nothing.
    await lifecycle.onAdopted();
    lifecycle.onAbandoned?.();
    expect(h.snapshot().pending).toEqual([]);
    expect(h.snapshot().stopped).toBeFalsy();
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
  });

  it("on restart, hands over again what the brain never got", async () => {
    const h = await leftover(false);
    await vi.waitFor(() => expect(h.deliver).toHaveBeenCalledTimes(2));
    expect(h.deliver.mock.calls[1][0].ids).toEqual(["a"]);
  });

  it("tells read listeners what the brain was shown, once adopted", async () => {
    const h = setupWake();
    const read = vi.fn();
    h.router.onRead(read);
    await h.router.receive("alice", stimulus("a"));
    expect(read).toHaveBeenCalledWith(
      expect.objectContaining({
        ids: ["a"],
        keys: [stimulusKey(stimulus("a"))],
      }),
    );
  });

  it("never counts an ignored stimulus as read", async () => {
    const h = setup();
    h.evaluateDecision.mockResolvedValue({
      status: "ok",
      result: {
        answers: {
          wake_decision: { type: "choice", choice: "IGNORE" },
          response_latency: { type: "score", score: 0 },
        },
      },
    });
    const read = vi.fn();
    h.router.onRead(read);
    await h.router.receive("alice", stimulus("a"));
    expect(h.deliver).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });

  it("on restart, counts a handoff the brain transcript has as read", async () => {
    const h = setupWake();
    h.deliver.mockRejectedValueOnce(
      new Error("Connection failed after possible acceptance"),
    );
    await expect(h.router.receive("alice", stimulus("a"))).rejects.toThrow(
      "possible acceptance",
    );
    const restarted = h.restart({ adopted: async () => true });
    const read = vi.fn();
    restarted.onRead(read);
    await restarted.recover();
    expect(read).toHaveBeenCalledWith(expect.objectContaining({ ids: ["a"] }));
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

    it("starts the turn's embedding as it hands the brain its messages", async () => {
      const h = setup();
      const warm = vi.fn();
      const router = h.restart({ warm });
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

      await router.receive("alice", stimulus("a"));

      expect(h.deliveries[0]).toMatchObject({ mode: "followup" });
      expect(warm).toHaveBeenCalledExactlyOnceWith(
        "alice",
        h.deliveries[0].message,
      );
    });

    it("hands the brain its messages even if starting the embedding fails", async () => {
      const h = setup();
      const router = h.restart({
        warm: () => {
          throw new Error("no embedder");
        },
      });
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

      await router.receive("alice", stimulus("a"));

      expect(h.deliver).toHaveBeenCalledTimes(1);
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
      expect(h.judged).toEqual([
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
      // Leading sim-time envelope suppresses OpenClaw's wall-clock stamp;
      // no words of its own follow it, only the lines.
      expect(h.deliveries[0].message).toMatch(
        /^\[\w{3} \d{4}-\d{2}-\d{2} \d{2}:\d{2}\]\n- \[/,
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

    it("reviews queued stimuli once against the completed reply before delivery", async () => {
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

      // The original reply did not cover this request; the review keeps it.
      h.evaluateDecision.mockResolvedValueOnce({
        status: "ok",
        result: {
          answers: { wake_decision: { type: "choice", choice: "WAKE" } },
        },
      });
      await h.router.ended("alice", "run-1", false);
      expect(h.evaluateDecision).toHaveBeenCalledTimes(2);
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
        api: {
          lifecycle: {
            runInBackgroundContext: async <T>(
              run: () => Promise<T>,
            ): Promise<T> => run(),
          },
          runtime: {
            agent: { resolveAgentWorkspaceDir: () => undefined },
            config: { current: () => ({}) },
          },
          logger: { info: vi.fn(), warn: vi.fn() },
        } as unknown as OpenClawPluginApi,
        stateStore: {
          lookup: async (key: string) => structuredClone(h.states.get(key)),
          register: async (key: string, value: PerceptionState) => {
            h.states.set(key, structuredClone(value));
          },
          entries: async () => [],
        },
        decisionStore: { record: () => {}, window: () => [] },
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

    it("queues for the next turn, never steers, when the decision model is unavailable", async () => {
      // Live: a fallback steer for every refused decision ran 1,278 turns.
      const h = setup();
      await h.router.started("alice", "run-busy");
      h.evaluateDecision.mockResolvedValueOnce({
        status: "unavailable",
        reason: "service-error",
      });

      await h.router.receive("alice", stimulus("busy-msg"));

      expect(h.deliver).not.toHaveBeenCalled();
      expect(h.snapshot().pending[0]).toMatchObject({
        id: "busy-msg",
        action: "QUEUE_NEXT",
      });
      h.evaluateDecision.mockResolvedValueOnce({
        status: "unavailable",
        reason: "service-error",
      });
      await h.router.ended("alice", "run-busy", false);
      expect(h.deliveries[0]).toMatchObject({
        mode: "followup",
        ids: ["busy-msg"],
      });
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
      await h.router.receive("alice", {
        ...stimulus("chat-msg", "alice", "Can you help me?"),
        sender: "bob",
      });

      expect(h.deliveries[0].message).not.toContain(
        "[kazusa:skill=task-interrupt]",
      );
      expect(h.deliveries[0].message).toContain(
        "- [`bob` Sat 2026-10-24 12:00] (chat:direct:bob): Can you help me?",
      );
      // The closing reminder is the skill's, as written there.
      expect(h.deliveries[0].message).toMatch(/\n\n\(If you answer: /);
      // No raw JSON stringification
      expect(h.deliveries[0].message).not.toContain("[kazusa\\u003a");
      expect(h.deliveries[0].message).not.toContain('{"id":');
      expect(h.deliveries[0].sessionKeys).toEqual([
        "agent:alice:chat:direct:bob",
      ]);
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

  it("drops a check-in during an activity, but not a job's next run", async () => {
    const h = setup({ assembleDecisionContext });
    h.tasks.set("alice", study());
    const idle = {
      sessionKey: "agent:alice:tasks",
      sender: "kazusa:taskman",
      idle: true,
      timestamp: NOW,
    };
    await h.router.receive("alice", {
      ...idle,
      id: "check-in",
      text: "Activity check-in",
    });
    expect(h.deliver).not.toHaveBeenCalled();
    await h.router.receive("alice", {
      ...idle,
      id: "next-run",
      text: "Carry on with your work: the places",
      resume: true,
    });
    expect(h.deliveries).toHaveLength(1);
    expect(h.deliveries[0].ids).toEqual(["next-run"]);
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
    expect(h.deliveries[0].message).toContain("(chat:direct:bob): ");
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

  it("keeps only the decisions worth showing, apart from the character state", async () => {
    const h = setup({ assembleDecisionContext });
    h.tasks.set("alice", study());
    // Seen, and answered within the hour: nothing to show.
    h.evaluateDecision.mockResolvedValue(answer("WAKE", 1));
    await h.router.receive("alice", stimulus("text"));
    // Set aside until studying ends.
    h.evaluateDecision.mockResolvedValue(answer("DEFER"));
    await h.router.receive("alice", stimulus("homework"));
    // Left unread.
    h.evaluateDecision.mockResolvedValue(answer("IGNORE"));
    await h.router.receive(
      "alice",
      stimulus("spam", "alice", `  Buy\n ${"now ".repeat(40)}`),
    );
    // Someone else's line in person, not caught: nothing to show.
    await h.router.receive("alice", {
      ...stimulus("aside"),
      sessionKey: "agent:alice:chat:huddle:cafe",
    });
    // The player's is.
    await h.router.receive("alice", {
      ...stimulus("hey"),
      sessionKey: "agent:alice:chat:huddle:cafe",
      sender: "user:sensei",
    });

    expect(h.judged.map(({ action }) => action)).toEqual([
      "STEER",
      "DEFER",
      "IGNORE",
      "IGNORE",
      "IGNORE",
    ]);
    // Newest first; oldest first here.
    const kept = (await h.router.decisions({ limit: 10 })).reverse();
    expect(kept.map(({ agentId }) => agentId)).toEqual([
      "alice",
      "alice",
      "alice",
    ]);
    const activity = {
      type: "studying",
      description: "Revising for the exam",
      endAt: NOW + HOUR,
    };
    expect(kept.map(({ record }) => record)).toEqual([
      {
        simTime: NOW,
        wallTime: expect.any(Number),
        outcome: "deferred",
        lines: [
          {
            messageId: "homework",
            chatId: expect.stringMatching(/^direct:/),
            sender: "sender-homework",
            excerpt: "Message homework",
          },
        ],
        activity,
      },
      expect.objectContaining({
        outcome: "ignored",
        lines: [
          expect.objectContaining({
            messageId: "spam",
            // Whitespace folded, cut at 100 characters.
            excerpt: `${`Buy ${"now ".repeat(40)}`.slice(0, 99).trimEnd()}…`,
          }),
        ],
        activity,
      }),
      expect.objectContaining({
        outcome: "ignored",
        lines: [
          expect.objectContaining({
            messageId: "hey",
            chatId: "huddle:cafe",
            sender: "user:sensei",
          }),
        ],
      }),
    ]);

    // The inbox holds character states only.
    await h.restart().recover();
    expect([...h.states.keys()]).toEqual(["alice"]);
  });

  it("keeps no record of a deferral with nothing going on", async () => {
    // Nothing to wait for: the text is taken in at the next turn.
    const h = setup({ assembleDecisionContext });
    h.evaluateDecision.mockResolvedValue(answer("DEFER"));
    await h.router.receive("alice", stimulus("text"));
    await vi.waitFor(() => expect(h.judged).toHaveLength(1));
    expect(h.judged[0]).toMatchObject({ action: "DEFER" });
    expect(h.decisions.size).toBe(0);
  });

  it("cuts an excerpt between characters, never inside an emoji", async () => {
    const h = setup({ assembleDecisionContext });
    h.evaluateDecision.mockResolvedValue(answer("IGNORE"));
    await h.router.receive(
      "alice",
      stimulus("long", "alice", `${"a".repeat(98)}😀😀😀`),
    );
    await vi.waitFor(() => expect(h.decisions.size).toBe(1));
    expect([...h.decisions.values()][0].lines[0].excerpt).toBe(
      `${"a".repeat(98)}😀…`,
    );
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

  it("discards ignored stimuli and hands over only what the brain is shown", async () => {
    const h = setup({ assembleDecisionContext });
    h.tasks.set("alice", study());
    h.evaluateDecision.mockResolvedValueOnce(answer("IGNORE"));
    await h.router.receive("alice", stimulus("chatter"));
    h.evaluateDecision.mockResolvedValueOnce(answer("DEFER"));
    await h.router.receive("alice", stimulus("later"));
    expect(h.snapshot().pending.map((item) => item.id)).toEqual(["later"]);

    h.setTime(NOW + HOUR);
    await h.router.deadline("alice");
    expect(h.deliveries[0].ids).not.toContain("chatter");
    expect(h.deliveries[0].ids).toContain("later");
  });

  it("treats a deferral with no activity as attention now", async () => {
    const h = setup({ assembleDecisionContext });
    h.evaluateDecision.mockResolvedValue(answer("DEFER"));
    await h.router.receive("alice", stimulus("text"));
    expect(h.deliveries[0].ids).toEqual(["text"]);
  });

  /** A send under way in `sessionKey`, which takes whatever stops it. */
  const speaking = (sessionKey: string) => ({
    current: vi.fn(() => ({
      sessionKey,
      said: ["Wait..."],
      unsaid: ["I told you not to go!"],
    })),
    interrupt: vi.fn(
      (_agentId: string, _handoff?: { message: string; atPause?: boolean }) =>
        true,
    ),
  });
  const huddle = (id: string): Stimulus => ({
    ...stimulus(id),
    sessionKey: "agent:alice:chat:huddle:k3x9p2m0qa",
  });

  it("shows Jev the speech in progress and hands a steer back with it", async () => {
    const h = setup({ assembleDecisionContext });
    const speech = speaking("agent:alice:chat:direct:carol");
    h.router.attachSpeech(speech);
    const read = vi.fn();
    h.router.onRead(read);
    await h.router.started("alice", "busy");
    h.evaluateDecision.mockResolvedValueOnce(answer("QUEUE_NEXT"));
    await h.router.receive("alice", stimulus("uh huh"));
    expect(speech.interrupt).not.toHaveBeenCalled();
    expect(requests.at(-1)?.currentSpeech).toEqual(speech.current());
    h.evaluateDecision.mockResolvedValueOnce(answer("STEER"));
    await h.router.receive("alice", stimulus("I didn't actually go!"));
    // Live, a steer sent to the host after the cut-off missed the next model
    // call: the brain typed on without knowing what stopped it.
    expect(speech.interrupt).toHaveBeenCalledExactlyOnceWith("alice", {
      message: expect.stringContaining("I didn't actually go!"),
      atPause: false,
    });
    expect(h.deliver).not.toHaveBeenCalled();
    // Read once a model call starts on it, taken in once one completes.
    expect(read).not.toHaveBeenCalled();
    await h.router.thinking("alice");
    expect(read).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ ids: ["I didn't actually go!"] }),
    );
    expect(h.snapshot().pending.map((item) => item.id)).toContain(
      "I didn't actually go!",
    );
    await h.router.thought("alice");
    expect(h.snapshot().pending.map((item) => item.id)).not.toContain(
      "I didn't actually go!",
    );
    expect(h.snapshot().carried).toBeUndefined();
    expect(read).toHaveBeenCalledOnce();
  });

  it("puts what a run never finished reading back for its next turn", async () => {
    const h = setup({ assembleDecisionContext });
    const speech = speaking("agent:alice:chat:direct:carol");
    h.router.attachSpeech(speech);
    await h.router.started("alice", "busy");
    h.evaluateDecision.mockResolvedValueOnce(answer("STEER"));
    await h.router.receive("alice", stimulus("are you there?"));
    expect(speech.interrupt).toHaveBeenCalledOnce();
    // Live, runs hit their model-call limit with the handed-back lines unread.
    await h.router.thinking("alice");
    speech.current.mockReturnValue(undefined as never);
    await h.router.ended("alice", "busy", false);
    expect(h.deliveries.at(-1)).toMatchObject({
      mode: "followup",
      ids: ["are you there?"],
    });
  });

  it("shows a text in the chat being typed into at once, unjudged", async () => {
    const h = setup({ assembleDecisionContext, coalesceWindowMs: 10_000 });
    const speech = speaking("agent:alice:chat:direct:bob");
    h.router.attachSpeech(speech);
    await h.router.started("alice", "busy");
    await h.router.receive("alice", stimulus("not at schale!"));
    await vi.waitFor(() =>
      expect(speech.interrupt).toHaveBeenCalledExactlyOnceWith("alice", {
        message: expect.stringContaining("not at schale!"),
        atPause: false,
      }),
    );
    expect(h.evaluateDecision).not.toHaveBeenCalled();
    expect(h.judged).toEqual([
      expect.objectContaining({ action: "STEER", source: "automatic" }),
    ]);
    expect(h.decisions.size).toBe(0);
  });

  it("finishes the line being said before taking in one said over it", async () => {
    const h = setup({ assembleDecisionContext });
    const speech = speaking("agent:alice:chat:huddle:k3x9p2m0qa");
    h.router.attachSpeech(speech);
    await h.router.started("alice", "busy");
    h.evaluateDecision.mockResolvedValueOnce(answer("QUEUE_NEXT"));
    await h.router.receive("alice", huddle("hang on"));
    expect(speech.interrupt).toHaveBeenCalledExactlyOnceWith("alice", {
      message: expect.stringContaining("hang on"),
      atPause: true,
    });
    // Cutting in stops them mid-line.
    h.evaluateDecision.mockResolvedValueOnce(answer("STEER"));
    await h.router.receive("alice", huddle("STOP"));
    expect(speech.interrupt).toHaveBeenLastCalledWith("alice", {
      message: expect.stringContaining("STOP"),
      atPause: false,
    });
  });

  it("hands a steer still waiting for the host to a send that begins", async () => {
    const h = setup({ assembleDecisionContext });
    // The host holds the steer until the next tool boundary.
    h.deliver.mockImplementation(async (delivery, lifecycle) => {
      h.deliveries.push(structuredClone(delivery));
      lifecycle.onDeferred?.();
    });
    await h.router.started("alice", "busy");
    h.evaluateDecision.mockResolvedValueOnce(answer("STEER"));
    await h.router.receive("alice", stimulus("wait"));
    expect(h.deliveries[0]).toMatchObject({ mode: "steer", ids: ["wait"] });

    const speech = speaking("agent:alice:chat:direct:carol");
    h.router.attachSpeech(speech);
    await h.router.speaking("alice");
    expect(speech.interrupt).toHaveBeenCalledExactlyOnceWith("alice", {
      message: expect.stringContaining("wait"),
      atPause: false,
    });
    expect(h.snapshot().deliveries ?? []).toEqual([]);
    await h.router.thought("alice");
    expect(h.snapshot().pending).toEqual([]);
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
      "]\n- [Sat 2026-10-24 12:01] Bob waves from across the courtyard.",
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
    const h = setupWake({
      readinessPollMs: 10,
      confirm,
      backgroundWork: async (run) => caller.exit(run),
    });
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
    const h = setupWake({
      coalesceWindowMs: 10,
      backgroundWork: async (run) => caller.exit(run),
    });
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

  it("forgets held sightings going offstage, and keeps the texts", async () => {
    const offstage = new Set<string>();
    const h = setupWake({ onstage: async (id) => !offstage.has(id) });
    await h.router.receive("alice", {
      ...stimulus("sighting", "alice", "Bob is here."),
      timestamp: NOW + 60_000,
      foreseen: true,
    });
    offstage.add("alice");
    await h.router.receive("alice", stimulus("text"));
    await h.router.forgetForeseen("alice");
    expect(h.snapshot().pending.map(({ id }) => id)).toEqual(["text"]);
  });

  it("never holds a sighting for someone offstage", async () => {
    const h = setupWake({ onstage: async () => false });
    await h.router.receive("alice", {
      ...stimulus("sighting", "alice", "Bob is here."),
      foreseen: true,
    });
    expect(h.states.get("alice")).toBeUndefined();
  });

  it("forgets on restart the sightings held from before going offstage", async () => {
    // Live: everyone sent offstage at once left 3,800 sightings held for good,
    // since going offstage again did nothing for those already off.
    const h = setupWake({ onstage: async () => false });
    h.states.set("alice", {
      pending: [
        { ...stimulus("sighting", "alice", "Bob is here."), foreseen: true },
        stimulus("text"),
      ],
    });
    await h.router.recover();
    expect(h.snapshot().pending.map(({ id }) => id)).toEqual(["text"]);
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

  it("brings a queue left by a cut-off run along with the overdue check-in", async () => {
    // Live: a run that hit its limit while a message waited stopped the
    // character, and the supervisor skipped anyone with a queue (2026-11-05).
    const h = setup();
    h.tasks.set("alice", {
      id: "lunch",
      type: "eating",
      description: "Lunch",
      duration: 30,
      startedAt: new Date(NOW - 3_600_000).toISOString(),
      endAt: new Date(NOW - 1_800_000).toISOString(),
    });
    h.states.set("alice", {
      pending: [{ ...stimulus("waiting"), action: "QUEUE_NEXT" }],
      brainRun: "cut-off",
    });
    await h.router.ended("alice", "cut-off", true);
    expect(h.deliveries).toEqual([]);
    await h.router.idleWake("alice");
    expect(h.snapshot().stopped).toBe(false);
    expect(h.deliveries).toHaveLength(1);
    expect(h.deliveries[0]?.ids).toEqual([`task-idle:alice:${NOW}`, "waiting"]);
  });

  it("keeps one check-in waiting however often the supervisor asks", async () => {
    const h = setup();
    // A handoff nobody confirmed holds the queue until a restart settles it.
    h.states.set("alice", {
      pending: [{ ...stimulus("held"), action: "QUEUE_NEXT" }],
      deliveries: [
        {
          id: "unconfirmed",
          agentId: "alice",
          mode: "followup",
          message: "held",
          ids: ["held"],
          keys: [stimulusKey(stimulus("held"))],
        },
      ],
      stopped: true,
    });
    await h.router.idleWake("alice");
    h.setTime(NOW + 60_000);
    await h.router.idleWake("alice");
    h.setTime(NOW + 120_000);
    await h.router.idleWake("alice");
    expect(h.deliveries).toEqual([]);
    expect(
      h
        .snapshot()
        .pending.filter((item) => item.idle)
        .map(({ id }) => id),
    ).toEqual([`task-idle:alice:${NOW}`]);
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

describe("Conversation coverage review", () => {
  const answer = (question: string, choice: string) => ({
    status: "ok",
    result: {
      answers: { [question]: { type: "choice", choice } },
    },
  });
  it("discards a queued greeting already covered by the completed reply", async () => {
    const requests: DecisionContextRequest[] = [];
    const assemble = vi.fn(
      async (
        _id: string,
        request: DecisionContextRequest,
      ): Promise<DecisionBatch> => {
        requests.push(request);
        return {
          state: {},
          questions: {
            [request.brainStatus === "idle"
              ? "wake_decision"
              : "attention_allocation"]: { type: "choice", criteria: {} },
          },
        };
      },
    );
    const h = setup({ assembleDecisionContext: assemble });
    await h.router.started("alice", "reply-1");
    h.evaluateDecision.mockResolvedValueOnce(
      answer("attention_allocation", "QUEUE_NEXT"),
    );
    const greeting = stimulus("hello-again", "alice", "Hello");
    await h.router.receive("alice", greeting);
    expect(h.snapshot().pending[0].reviewAfterRun).toBe(true);
    h.evaluateDecision.mockResolvedValueOnce(answer("wake_decision", "IGNORE"));
    await h.router.ended("alice", "reply-1", false);
    expect(h.deliver).not.toHaveBeenCalled();
    expect(h.snapshot().pending).toEqual([]);
    expect(requests[1]).toMatchObject({
      queuedReview: true,
      incomingBundle: [{ id: "hello-again" }],
      pendingQueue: [],
    });
    await h.router.drain("alice");
    expect(h.evaluateDecision).toHaveBeenCalledTimes(2);
  });
  it("preserves a new question and delivers it once without another latency delay", async () => {
    const h = setup();
    await h.router.started("alice", "reply-1");
    h.evaluateDecision.mockResolvedValueOnce(
      answer("attention_allocation", "QUEUE_NEXT"),
    );
    await h.router.receive(
      "alice",
      stimulus("new-question", "alice", "Hello, are you still there?"),
    );
    h.evaluateDecision.mockResolvedValueOnce(answer("wake_decision", "WAKE"));
    await h.router.ended("alice", "reply-1", false);
    expect(h.deliveries).toHaveLength(1);
    expect(h.deliveries[0].ids).toEqual(["new-question"]);
    expect(h.snapshot().pending).toEqual([]);
  });
  it("preserves queued input when the coverage judge is unavailable", async () => {
    const h = setup();
    await h.router.started("alice", "reply-1");
    h.evaluateDecision.mockResolvedValueOnce(
      answer("attention_allocation", "QUEUE_NEXT"),
    );
    await h.router.receive("alice", stimulus("uncertain"));
    h.evaluateDecision.mockResolvedValueOnce({
      status: "unavailable",
      reason: "timeout",
    });
    await h.router.ended("alice", "reply-1", false);
    expect(h.deliveries[0].ids).toEqual(["uncertain"]);
  });
  it("brings a remote coalescing window forward for a verified huddle and never resets it", async () => {
    vi.useFakeTimers();
    const h = setupWake({
      coalesceWindowMs: 10000,
      realtime: async (_id, item) => item.sessionKey.includes(":huddle:"),
    });
    try {
      await h.router.receive("alice", stimulus("remote"));
      await vi.advanceTimersByTimeAsync(100);
      const local = {
        ...stimulus("local"),
        sessionKey: "agent:alice:chat:huddle:present",
      };
      await h.router.receive("alice", local);
      await vi.advanceTimersByTimeAsync(100);
      await h.router.receive("alice", {
        ...local,
        id: "local-2",
        sender: "someone-else",
      });
      await vi.advanceTimersByTimeAsync(150);
      expect(h.deliveries[0].ids).toEqual(["remote", "local", "local-2"]);
    } finally {
      h.router.dispose();
      vi.useRealTimers();
    }
  });
});

describe("Brain runs that keep failing", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const failed = (
    h: ReturnType<typeof setup>,
    agentId: string,
    runId: string,
  ): Promise<void> =>
    h.router.noteRunOutcome(agentId, {
      error: "Connection error.",
      at: Date.now(),
      runId,
    });
  const checkedInOn = (h: ReturnType<typeof setup>): string[] =>
    h.deliveries.map((delivery) => delivery.agentId);

  it("stops checking in on everyone, and lets the one who failed last try again", async () => {
    // Live: with the network down for 3 h, two characters a minute were woken
    // into runs that could only fail, 436 of them (2026-11-12).
    vi.useFakeTimers({ toFake: ["Date"] });
    const h = setup();
    await failed(h, "alice", "run-1");
    await failed(h, "bob", "run-2");
    await h.router.idleWake("dave");
    expect(checkedInOn(h)).toEqual(["dave"]);
    await failed(h, "carol", "run-3");
    await h.router.idleWake("erin");
    expect(checkedInOn(h)).toEqual(["dave"]);
    // A minute on, one try, by whoever failed last and not by someone new.
    vi.advanceTimersByTime(60_000);
    await h.router.idleWake("erin");
    await h.router.idleWake("frank");
    expect(checkedInOn(h)).toEqual(["dave", "carol"]);
    // The next try waits twice as long.
    vi.advanceTimersByTime(119_000);
    await h.router.idleWake("erin");
    expect(checkedInOn(h)).toEqual(["dave", "carol"]);
  });

  it("checks in on everyone again once a run gets through", async () => {
    const h = setup();
    await failed(h, "alice", "run-1");
    await failed(h, "bob", "run-2");
    await failed(h, "carol", "run-3");
    await h.router.idleWake("erin");
    expect(checkedInOn(h)).toEqual([]);
    await h.router.noteRunOutcome("bob");
    await h.router.idleWake("erin");
    expect(checkedInOn(h)).toEqual(["erin"]);
  });

  it("counts a failed run once, however many registrations report it", async () => {
    const h = setup();
    await failed(h, "alice", "run-1");
    await failed(h, "alice", "run-1");
    await failed(h, "alice", "run-1");
    await h.router.idleWake("erin");
    expect(checkedInOn(h)).toEqual(["erin"]);
  });

  it("tries with whoever is offered when the one who failed last is offstage", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const h = setup({ onstage: async (id) => id !== "carol" });
    await failed(h, "alice", "run-1");
    await failed(h, "bob", "run-2");
    await failed(h, "carol", "run-3");
    vi.advanceTimersByTime(60_000);
    await h.router.idleWake("erin");
    expect(checkedInOn(h)).toEqual(["erin"]);
  });
});
