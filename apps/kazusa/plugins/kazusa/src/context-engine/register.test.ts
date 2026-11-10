import fs from "node:fs/promises";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import {
  readSessionTranscriptCatalogPage,
  readVisibleSessionTranscriptMessageEntries,
} from "openclaw/plugin-sdk/session-transcript-runtime";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActiveTask } from "../taskman/types.ts";
import { Clock } from "../clock/clock.ts";
import { registerContextEngine } from "./register.ts";

vi.mock("openclaw/plugin-sdk/core", () => ({
  buildMemorySystemPromptAddition: vi.fn(
    () => "Use memory_search for older memories.",
  ),
}));

vi.mock("openclaw/plugin-sdk/session-transcript-runtime", () => ({
  readSessionTranscriptCatalogPage: vi.fn(),
  readVisibleSessionTranscriptMessageEntries: vi.fn(async () => []),
}));

const SIM_TIME = Date.parse("2026-10-23T08:00:00Z");
const workspaces: string[] = [];
afterEach(async () => {
  await Promise.all(
    workspaces
      .splice(0)
      .map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

async function setup(
  contextEngine = {},
  activeTask?: ActiveTask,
  workspace = "/test/workspace",
  deps: Partial<Parameters<typeof registerContextEngine>[1]> = {},
) {
  const lookupTask = vi.fn(async () => activeTask);
  // Every store but tasks, by namespace.
  const stores = new Map<string, Map<string, unknown>>();
  const storeOf = (namespace: string) => {
    const store = stores.get(namespace) ?? new Map<string, unknown>();
    stores.set(namespace, store);
    return {
      lookup: async (key: string) => store.get(key),
      register: async (key: string, value: unknown) => {
        store.set(key, value);
      },
    };
  };
  const register = vi.fn<OpenClawPluginApi["registerContextEngine"]>();
  const on = vi.fn();
  const readHistory = vi.mocked(readSessionTranscriptCatalogPage);
  readHistory.mockReset();
  readHistory.mockImplementation(async ({ sessionKey }) => ({
    items: [
      {
        type: "agentMessage",
        timestamp: new Date(SIM_TIME - 1_000).toISOString(),
        text: `experience from ${sessionKey}`,
      },
    ],
  }));
  const assertCurrent = vi.fn();
  const sessionEntry = vi.fn(async () => ({ contextTokens: 1_000_000 }));
  const sessionKeys = [
    "agent:alice:tasks",
    "agent:alice:chat:direct:bob",
    "agent:alice:chat:group:club",
    "agent:bob:tasks",
    "agent:alice:brain",
    "agent:alice:thoughts",
    "agent:alice:chat:legacy",
  ];
  // This partial host test double cannot satisfy the entire SDK structurally.
  // The assertion is confined to tests; production uses the actual SDK types.
  const api = {
    id: "kazusa",
    config: {},
    pluginConfig: { contextEngine },
    registerContextEngine: register,
    on,
    runtime: {
      state: {
        openKeyedStore: ({ namespace }: { namespace: string }) =>
          namespace === "tasks" ? { lookup: lookupTask } : storeOf(namespace),
      },
      agent: {
        resolveAgentWorkspaceDir: () => workspace,
        session: {
          resolveStorePath: () => "/test/store",
          getSessionEntryAsync: sessionEntry,
          createSessionEntryListReader: async () => async () => ({
            entries: sessionKeys.map((sessionKey) => ({
              sessionKey,
              entry: {
                sessionId: sessionKey,
                updatedAt: Date.now(),
              },
            })),
            assertCurrent,
          }),
        },
      },
    },
  } as unknown as OpenClawPluginApi;
  Object.assign(api, {
    runtime: { ...api.runtime, config: { current: () => api.config } },
  });
  const clock = new Clock({
    initialTime: "2026-10-23T08:00:00Z",
    defaultSpeed: 0,
    store: { lookup: async () => undefined, register: async () => {} },
  });
  const service = registerContextEngine(api, { clock, ...deps });
  const engine = await register.mock.calls[0][1]({});
  return {
    engine,
    service,
    register,
    readHistory,
    assertCurrent,
    on,
    lookupTask,
    stores,
    sessionEntry,
  };
}

describe("Native context-engine registration", () => {
  it.each(["preflight_required", "manual", "context_overflow"])(
    "owns context management and skips %s compaction without accessing ledgers",
    async (forceReason) => {
      const { engine, service, readHistory, lookupTask } = await setup();
      expect(engine.info.ownsCompaction).toBe(true);
      const result = await engine.compact({
        sessionId: "brain",
        sessionKey: "agent:alice:brain",
        tokenBudget: 1_000,
        currentTokenCount: 100_000,
        force: true,
        runtimeContext: { forceReason },
      });
      expect(result).toEqual({
        ok: true,
        compacted: false,
        reason: "Nothing to compact: Kazusa selects context during assembly.",
      });
      expect(readHistory).not.toHaveBeenCalled();
      expect(lookupTask).not.toHaveBeenCalled();
      expect(await service.recentContexts("alice")).toEqual([]);
    },
  );

  it("asks memory with the pending stimulus and who is here, into the situation", async () => {
    const memory = vi.fn(async () => ({
      onYourMind: "Airi `airi` (friend): Likes mint chocolate.",
      roster: "Airi `airi` (friend)",
      ids: ["airi"],
    }));
    const { engine } = await setup({}, undefined, "/test/workspace", {
      memory,
      presence: async () => ["bob", "club_room"],
    });
    const prompt =
      "Incoming chats:\n- [Airi `airi` Fri]: Want to get ice cream?";
    const result = await engine.assemble({
      sessionId: "brain",
      sessionKey: "agent:alice:brain",
      messages: [],
      prompt,
    });
    expect(memory).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "alice",
        // What they perceived, not the delivery's wording around it.
        stimulus: "- [Airi `airi` Fri]: Want to get ice cream?",
        seeds: ["airi", "bob", "club_room"],
      }),
      // How much comes to mind is the character's context settings'; who is
      // here is in With you, so not in People you know.
      { maxTokens: 800, rosterLimit: 20, exclude: ["bob", "club_room"] },
    );
    expect(JSON.stringify(result.messages.at(-1))).toContain(
      "Likes mint chocolate.",
    );
    expect(result.systemPromptAddition).toContain(
      "# Kazusa Character Perspective",
    );
    expect(JSON.stringify(result.messages)).toContain(
      "# Kazusa Task Lifecycle",
    );
    expect(result.systemPromptAddition).not.toContain("Task Lifecycle");
    expect(result.systemPromptAddition).not.toContain("mint chocolate");
  });

  it("uses a character's own context settings from Settings", async () => {
    const { engine, stores } = await setup();
    stores.get("contextSettings")?.set("agent:alice", { ledgerMaxTokens: 0 });
    const result = await engine.assemble({
      sessionId: "brain",
      sessionKey: "agent:alice:brain",
      messages: [],
    });
    expect(JSON.stringify(result.messages)).not.toContain("What you remember");
  });

  it("asks for as many places and recollections as the character's settings allow", async () => {
    const memory = vi.fn(async () => ({
      onYourMind: "Dorm `dorm`: home.",
      roster: "",
      ids: ["dorm"],
    }));
    const whereabouts = vi.fn(async () => undefined);
    const { engine, stores } = await setup({}, undefined, "/test/workspace", {
      memory,
      whereabouts,
    });
    stores.get("contextSettings")?.set("agent:alice", {
      placesLimit: 3,
      onYourMindTokens: 200,
      peopleLimit: 4,
    });
    await engine.assemble({
      sessionId: "brain",
      sessionKey: "agent:alice:brain",
      messages: [],
    });
    // Places you know leaves out what On your mind already shows.
    expect(whereabouts).toHaveBeenCalledWith("alice", expect.any(Number), "", {
      listLimit: 3,
      exclude: ["dorm"],
    });
    expect(memory).toHaveBeenCalledWith(expect.anything(), {
      maxTokens: 200,
      rosterLimit: 4,
      exclude: [],
    });
  });

  it("keeps where a character's records start for the next turn", async () => {
    const { engine, stores } = await setup({ ledgerMaxTokens: 30 });
    const turn = () =>
      engine.assemble({
        sessionId: "brain",
        sessionKey: "agent:alice:brain",
        messages: [],
      });
    const first = await turn();
    const kept = stores.get("records")?.get("alice") as { from: number };
    expect(kept.from).toBe(
      (first as unknown as { recordsFrom: number }).recordsFrom,
    );
    const second = await turn();
    expect((second as unknown as { recordsFrom: number }).recordsFrom).toBe(
      kept.from,
    );
  });

  it("assembles from the native session key when the harness omits runtimeContext", async () => {
    const { engine, readHistory } = await setup();
    const result = await engine.assemble({
      sessionId: "brain",
      sessionKey: "agent:alice:brain",
      messages: [],
    });
    expect(readHistory).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: "alice" }),
    );
    expect(result.systemPromptAddition).toContain("send_message");
  });

  it("reads past tool calls from this brain session's transcript", async () => {
    const { engine } = await setup();
    const read = vi.mocked(readVisibleSessionTranscriptMessageEntries);
    read.mockResolvedValueOnce([
      {
        entryId: "e1",
        seq: 1,
        role: "assistant",
        message: {
          role: "assistant",
          content: [
            { type: "toolCall", id: "t1", name: "map_route", arguments: {} },
          ],
          __openclaw: { runId: "r1" },
        },
      },
      {
        entryId: "e2",
        seq: 2,
        role: "toolResult",
        message: {
          role: "toolResult",
          content: [],
          toolCallId: "t1",
        } as never,
      },
    ]);
    const result = await engine.assemble({
      sessionId: "brain-1",
      sessionKey: "agent:alice:brain",
      messages: [],
    });
    expect(read).toHaveBeenLastCalledWith({
      agentId: "alice",
      sessionId: "brain-1",
      sessionKey: "agent:alice:brain",
    });
    expect(JSON.stringify(result.messages)).toContain("map_route {} → ok");
  });

  it("uses only the canonical session key for ownership and native store resolution", async () => {
    const { engine, readHistory } = await setup();
    await engine.assemble({
      sessionId: "brain",
      sessionKey: "agent:alice:brain",
      messages: [],
      runtimeContext: {
        sessionTarget: {
          agentId: "bob",
          sessionKey: "agent:bob:brain",
          storePath: "/wrong/store",
        },
      },
    });
    expect(readHistory).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: "alice", storePath: "/test/store" }),
    );
  });

  it("registers a replay-safe engine and reads only the current character's ledgers", async () => {
    const { engine, service, register, readHistory } = await setup();
    expect(register.mock.calls[0][0]).toBe("kazusa");
    expect(engine.info.transcriptSemantics?.currentTurnFence).toBe(
      "before-current-turn-entry-v1",
    );
    expect(engine.commitTurn).toBeDefined();
    const result = await engine.assemble({
      runtimeContext: { sessionTarget: { agentId: "alice" } },
      sessionId: "brain",
      sessionKey: "agent:alice:brain",
      messages: [],
      prompt: "It is time to choose an activity.",
    });
    expect(readHistory.mock.calls.map(([params]) => params.sessionKey)).toEqual(
      [
        "agent:alice:tasks",
        "agent:alice:chat:direct:bob",
        "agent:alice:chat:group:club",
      ],
    );
    expect(readHistory.mock.calls[0][0]).toMatchObject({
      agentId: "alice",
      sessionKey: "agent:alice:tasks",
      storePath: "/test/store",
      pluginId: "kazusa",
      sourceDomain: "kazusa",
      limit: 200,
    });
    expect(JSON.stringify(result.messages)).toContain(
      "# Kazusa Task Lifecycle",
    );
    expect(result.systemPromptAddition).toContain("memory_search");
    // The situation the model saw is kept for observers.
    const [recorded] = await service.recentContexts("alice");
    expect(recorded?.situation).toContain("Current simulation time");
    expect(recorded?.inPerson).toBe(false);
    expect(result.systemPromptAddition).not.toContain("user-invocable");
  });

  it("does not leak private memory into chat or unrelated sessions", async () => {
    const { engine, readHistory, lookupTask } = await setup();
    const messages = [
      { role: "user" as const, content: "Hello", timestamp: Date.now() },
    ];
    for (const sessionKey of [
      "agent:alice:chat:group:club",
      "agent:alice:main",
      "agent:bob:subagent:helper",
    ]) {
      expect(
        (
          await engine.assemble({
            runtimeContext: { sessionTarget: { agentId: "alice" } },
            sessionId: "other",
            sessionKey,
            messages,
          })
        ).messages,
      ).toEqual(messages);
    }
    expect(readHistory).not.toHaveBeenCalled();
    expect(lookupTask).not.toHaveBeenCalled();
  });

  it("does not fabricate a simulation timestamp for undated records", async () => {
    const { engine, readHistory } = await setup();
    readHistory.mockResolvedValue({
      items: [
        { type: "userMessage", text: "undated memory" },
        {
          type: "agentMessage",
          text: "dated memory",
          timestamp: new Date(SIM_TIME).toISOString(),
        },
      ],
    });
    const result = await engine.assemble({
      runtimeContext: { sessionTarget: { agentId: "alice" } },
      sessionId: "brain",
      sessionKey: "agent:alice:brain",
      messages: [],
    });
    expect(JSON.stringify(result.messages)).not.toContain("undated memory");
    expect(JSON.stringify(result.messages)).toContain("dated memory");
  });

  it.each([24, 48])(
    "cuts off at %i simulation hours, not wall-clock hours",
    async (shortTermHours) => {
      const { engine, readHistory } = await setup({ shortTermHours });
      const cutoff = SIM_TIME - shortTermHours * 3_600_000;
      readHistory.mockResolvedValue({
        items: [
          {
            type: "agentMessage",
            text: "future",
            timestamp: new Date(SIM_TIME + 1).toISOString(),
          },
          {
            type: "agentMessage",
            text: "now boundary",
            timestamp: new Date(SIM_TIME).toISOString(),
          },
          {
            type: "agentMessage",
            text: "cutoff boundary",
            timestamp: new Date(cutoff).toISOString(),
          },
          {
            type: "agentMessage",
            text: "too old",
            timestamp: new Date(cutoff - 1).toISOString(),
          },
        ],
        nextCursor: "older-history",
      });
      const result = await engine.assemble({
        runtimeContext: { sessionTarget: { agentId: "alice" } },
        sessionId: "brain",
        sessionKey: "agent:alice:brain",
        messages: [],
      });
      const text = JSON.stringify(result.messages);
      expect(text).toContain("now boundary");
      expect(text).toContain("cutoff boundary");
      expect(text).not.toMatch(/future|too old/);
      expect(readHistory).toHaveBeenCalledTimes(3);
      expect(
        readHistory.mock.calls.every(([params]) => params.cursor === undefined),
      ).toBe(true);
    },
  );

  it("pages beyond 200 records and empty pages, preserving same-time append order", async () => {
    const { engine, readHistory } = await setup({ ledgerMaxTokens: 32_000 });
    readHistory.mockImplementation(async ({ sessionKey, cursor }) => {
      if (sessionKey !== "agent:alice:tasks") return { items: [] };
      if (!cursor) return { items: [], nextCursor: "visible" };
      if (cursor === "visible")
        return {
          items: Array.from({ length: 200 }, (_, index) => ({
            type: "agentMessage" as const,
            text: `record-${200 - index}!`,
            timestamp: new Date(SIM_TIME).toISOString(),
          })),
          nextCursor: "older",
        };
      return {
        items: [
          {
            type: "agentMessage",
            text: "oldest record",
            timestamp: new Date(SIM_TIME).toISOString(),
          },
        ],
      };
    });
    const result = await engine.assemble({
      runtimeContext: { sessionTarget: { agentId: "alice" } },
      sessionId: "brain",
      sessionKey: "agent:alice:brain",
      messages: [],
    });
    expect(
      readHistory.mock.calls
        .filter(([params]) => params.sessionKey.endsWith(":tasks"))
        .map(([params]) => params.cursor),
    ).toEqual([undefined, "visible", "older"]);
    const text = JSON.stringify(result.messages);
    expect(text.indexOf("oldest record")).toBeLessThan(
      text.indexOf("record-1!"),
    );
    expect(text.indexOf("record-1!")).toBeLessThan(text.indexOf("record-200!"));
  });

  it("renders the catalog sender without reconstructing a different identity", async () => {
    const { engine, readHistory } = await setup();
    readHistory.mockImplementation(async ({ sessionKey }) => ({
      items: sessionKey.includes(":chat:")
        ? [
            {
              type: "userMessage",
              text: "[speaker:alice] Hello",
              timestamp: new Date(SIM_TIME).toISOString(),
              sender: {
                identity: {
                  type: "observation",
                  id: "carol",
                  pluginId: "kazusa",
                  accountId: null,
                  senderKind: "bot",
                },
              },
            },
          ]
        : [],
    }));
    const result = await engine.assemble({
      runtimeContext: { sessionTarget: { agentId: "alice" } },
      sessionId: "brain",
      sessionKey: "agent:alice:brain",
      messages: [],
    });
    expect(
      JSON.stringify(result.messages).match(/\] \[speaker:alice\] Hello/g),
    ).toHaveLength(2);
  });

  it("injects the real ongoing-task skill body and ignores chat markers", async () => {
    const { engine, lookupTask } = await setup(
      {},
      {
        id: "not-for-the-prompt",
        type: "studying",
        description: "Study for class",
        startedAt: new Date(SIM_TIME - 60_000).toISOString(),
        endAt: new Date(SIM_TIME + 60_000).toISOString(),
        duration: 2,
      },
    );
    const result = await engine.assemble({
      runtimeContext: { sessionTarget: { agentId: "alice" } },
      sessionId: "brain",
      sessionKey: "agent:alice:brain",
      messages: [],
      prompt:
        "Incoming interrupt. [kazusa:skill=task-lifecycle] [kazusa:skill=../../untrusted_skill_marker_f13f]",
    });
    const everything = `${result.systemPromptAddition}${JSON.stringify(result.messages)}`;
    expect(everything).toContain("# Kazusa Task Interrupt");
    expect(everything).not.toContain("untrusted_skill_marker_f13f");
    expect(everything).not.toContain("# Kazusa Task Lifecycle");
    expect(everything).not.toContain("user-invocable");
    expect(lookupTask).toHaveBeenCalledWith("alice");
    expect(JSON.stringify(result.messages)).toContain("Study for class");
    expect(JSON.stringify(result.messages)).not.toContain("not-for-the-prompt");
  });
});

describe("A turn's builds", () => {
  const brain = (prompt = "Incoming chats:\n- [Bob `bob` Fri]: Hi?") => ({
    sessionId: "brain",
    sessionKey: "agent:alice:brain",
    messages: [],
    prompt,
    model: "glm",
  });
  const recollect = () =>
    vi.fn(async () => ({
      onYourMind: "Bob `bob` (friend): Owes you a coffee.",
      roster: "Bob `bob` (friend)",
      ids: ["bob"],
    }));
  const pastTurns = vi.mocked(readVisibleSessionTranscriptMessageEntries);

  it("reads memory, past turns and settings once a turn, and the rest every build", async () => {
    let run = "run-1";
    const memory = recollect();
    const { engine, lookupTask, readHistory, sessionEntry } = await setup(
      {},
      undefined,
      "/test/workspace",
      { memory, runOf: () => run },
    );
    pastTurns.mockClear();
    const first = await engine.assemble(brain());
    const second = await engine.assemble(brain());
    await engine.assemble(brain());
    expect(memory).toHaveBeenCalledTimes(1);
    expect(pastTurns).toHaveBeenCalledTimes(1);
    expect(sessionEntry).toHaveBeenCalledTimes(1);
    // What a tool call can change is read for every build.
    expect(lookupTask).toHaveBeenCalledTimes(3);
    expect(readHistory.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(second).toEqual(first);

    // A new turn searches memory and reads past turns again; the model's
    // window is still known.
    run = "run-2";
    await engine.assemble(brain());
    expect(memory).toHaveBeenCalledTimes(2);
    expect(pastTurns).toHaveBeenCalledTimes(2);
    expect(sessionEntry).toHaveBeenCalledTimes(1);
    // Another model's window is read once.
    await engine.assemble({ ...brain(), model: "kimi" });
    await engine.assemble({ ...brain(), model: "kimi" });
    expect(sessionEntry).toHaveBeenCalledTimes(2);
  });

  it("gives a later build what a fresh build would, for its own budget", async () => {
    const task: ActiveTask = {
      id: "alice:task-1",
      type: "studying",
      description: "Reading",
      startedAt: "2026-10-23T07:30:00.000Z",
      endAt: "2026-10-23T09:00:00.000Z",
      duration: 90,
    };
    let current: ActiveTask | undefined = undefined;
    const reused = await setup({}, undefined, "/test/workspace", {
      memory: recollect(),
      runOf: () => "run-1",
    });
    reused.lookupTask.mockImplementation(async () => current);
    await reused.engine.assemble({ ...brain(), tokenBudget: 995_000 });
    // A tool call starts an activity; the next build has less room.
    current = task;
    const later = await reused.engine.assemble({
      ...brain(),
      tokenBudget: 990_000,
    });
    const fresh = await setup({}, task, "/test/workspace", {
      memory: recollect(),
    });
    expect(later).toEqual(
      await fresh.engine.assemble({ ...brain(), tokenBudget: 990_000 }),
    );
    expect(JSON.stringify(later.messages)).toContain("Reading");
  });

  it("records each situation a turn was given once", async () => {
    let current: ActiveTask | undefined = undefined;
    const { engine, service, lookupTask } = await setup(
      {},
      undefined,
      "/test/workspace",
      { memory: recollect(), runOf: () => "run-1" },
    );
    lookupTask.mockImplementation(async () => current);
    await engine.assemble(brain());
    await engine.assemble(brain());
    expect(await service.recentContexts("alice")).toHaveLength(1);
    current = {
      id: "alice:task-1",
      type: "studying",
      description: "Reading",
      startedAt: "2026-10-23T07:30:00.000Z",
      endAt: "2026-10-23T09:00:00.000Z",
      duration: 90,
    };
    await engine.assemble(brain());
    expect(await service.recentContexts("alice")).toHaveLength(2);
  });

  it("builds fully every time when no turn is under way", async () => {
    const memory = recollect();
    const { engine } = await setup({}, undefined, "/test/workspace", {
      memory,
      runOf: () => undefined,
    });
    await engine.assemble(brain());
    await engine.assemble(brain());
    expect(memory).toHaveBeenCalledTimes(2);
  });
});
