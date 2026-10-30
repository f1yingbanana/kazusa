import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { readSessionTranscriptCatalogPage } from "openclaw/plugin-sdk/session-transcript-runtime";
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
) {
  const lookupTask = vi.fn(async () => activeTask);
  const contexts = new Map<string, unknown>();
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
          namespace === "context"
            ? {
                lookup: async (key: string) => contexts.get(key),
                register: async (key: string, value: unknown) => {
                  contexts.set(key, value);
                },
              }
            : { lookup: lookupTask },
      },
      agent: {
        resolveAgentWorkspaceDir: () => workspace,
        session: {
          resolveStorePath: () => "/test/store",
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
  const service = registerContextEngine(api, { clock });
  const engine = await register.mock.calls[0][1]({});
  return {
    engine,
    service,
    register,
    readHistory,
    assertCurrent,
    on,
    lookupTask,
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

  it("retrieves the character's dated relationship card from the pending perception", async () => {
    const workspace = await fs.mkdtemp(
      path.join(os.tmpdir(), "kazusa-brain-context-"),
    );
    workspaces.push(workspace);
    const cards = path.join(workspace, "wiki/entities/characters");
    await fs.mkdir(cards, { recursive: true });
    await fs.writeFile(
      path.join(cards, "kurimura-airi.md"),
      "---\npeer_id: kurimura-airi\nlast_interaction_iso: 2026-10-20T17:00:00Z\n---\n## Quick Impression\nA trusted friend who likes mint chocolate.\n\n## Interaction Log\nAn older detailed conversation.",
    );
    await fs.writeFile(
      path.join(cards, "stranger.md"),
      "Unrelated private memory.",
    );
    const { engine } = await setup({}, undefined, workspace);
    const result = await engine.assemble({
      sessionId: "brain",
      sessionKey: "agent:alice:brain",
      messages: [],
      prompt:
        "Incoming chats:\n- [kurimura-airi Fri 2026-10-23 08:00] (chat:direct:kurimura-airi): Want to get ice cream?",
    });
    const text = JSON.stringify(result.messages);
    expect(text).toContain("A trusted friend who likes mint chocolate.");
    expect(text).toContain("2026-10-20T17:00:00Z");
    expect(text).not.toMatch(
      /older detailed conversation|Unrelated private memory/,
    );
    expect(result.systemPromptAddition).toContain(
      "# Kazusa Character Perspective",
    );
    expect(result.systemPromptAddition).toContain("# Kazusa Task Lifecycle");
    expect(result.systemPromptAddition).not.toContain("A trusted friend");
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
    expect(result.systemPromptAddition).toContain("# Kazusa Task Lifecycle");
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
    const { engine, readHistory } = await setup();
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
      JSON.stringify(result.messages).match(
        /\[`carol` Fri 2026-10-23 08:00\] \[speaker:alice\] Hello/g,
      ),
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
    expect(result.systemPromptAddition).toContain("# Kazusa Task Interrupt");
    expect(result.systemPromptAddition).not.toContain("untrusted_skill_marker_f13f");
    expect(result.systemPromptAddition).not.toContain(
      "# Kazusa Task Lifecycle",
    );
    expect(result.systemPromptAddition).not.toContain("user-invocable");
    expect(lookupTask).toHaveBeenCalledWith("alice");
    expect(JSON.stringify(result.messages)).toContain("Study for class");
    expect(JSON.stringify(result.messages)).not.toContain("not-for-the-prompt");
  });
});
