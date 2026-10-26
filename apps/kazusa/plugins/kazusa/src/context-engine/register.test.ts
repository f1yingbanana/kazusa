import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { readSessionTranscriptCatalogPage } from "openclaw/plugin-sdk/session-transcript-runtime";
import { describe, expect, it, vi } from "vitest";
import { Clock } from "../clock/clock.ts";
import { registerContextEngine } from "./register.ts";

vi.mock("openclaw/plugin-sdk/core", () => ({
  buildMemorySystemPromptAddition: vi.fn(
    () => "Use memory_search for older memories.",
  ),
  delegateCompactionToRuntime: vi.fn(async () => ({
    ok: true,
    compacted: false,
  })),
}));

vi.mock("openclaw/plugin-sdk/session-transcript-runtime", () => ({
  readSessionTranscriptCatalogPage: vi.fn(),
}));

const SIM_TIME = Date.parse("2026-10-23T08:00:00Z");

async function setup(contextEngine = {}) {
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
      agent: {
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
  const clock = new Clock({
    initialTime: "2026-10-23T08:00:00Z",
    defaultSpeed: 0,
    store: { lookup: async () => undefined, register: async () => {} },
  });
  registerContextEngine(api, { clock });
  const engine = await register.mock.calls[0][1]({});
  return { engine, register, readHistory, assertCurrent, on };
}

describe("Native context-engine registration", () => {
  it("requires a runtime agent identity even when the session key has one", async () => {
    const { engine, readHistory } = await setup();
    await expect(
      engine.assemble({
        sessionId: "brain",
        sessionKey: "agent:alice:brain",
        messages: [],
      }),
    ).rejects.toThrow("requires runtimeContext.sessionTarget.agentId");
    expect(readHistory).not.toHaveBeenCalled();
  });

  it("uses the runtime session target when supplied", async () => {
    const { engine, readHistory } = await setup();
    await engine.assemble({
      sessionId: "brain",
      messages: [],
      runtimeContext: {
        sessionTarget: {
          agentId: "alice",
          sessionKey: "agent:alice:brain",
          storePath: "/runtime/store",
        },
      },
    });
    expect(readHistory).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "alice",
        storePath: "/runtime/store",
      }),
    );
  });

  it("rejects conflicting runtime and session-key owners before reading", async () => {
    const { engine, readHistory } = await setup();
    await expect(
      engine.assemble({
        sessionId: "brain",
        sessionKey: "agent:alice:brain",
        messages: [],
        runtimeContext: { sessionTarget: { agentId: "bob" } },
      }),
    ).rejects.toThrow("does not match");
    expect(readHistory).not.toHaveBeenCalled();
  });

  it("registers a replay-safe engine and reads only the current character's ledgers", async () => {
    const { engine, register, readHistory } = await setup();
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
      prompt: "Task wake. [kazusa:skill=task_lifecycle]",
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
    expect(result.systemPromptAddition).not.toContain("user-invocable");
  });

  it("does not leak private memory into chat or unrelated sessions", async () => {
    const { engine, readHistory } = await setup();
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
        /\[carol Fri 2026-10-23 08:00\] \[speaker:alice\] Hello/g,
      ),
    ).toHaveLength(2);
  });

  it("resolves task-interrupt when tagged and ignores invalid marker paths", async () => {
    const { engine } = await setup();
    const result = await engine.assemble({
      runtimeContext: { sessionTarget: { agentId: "alice" } },
      sessionId: "brain",
      sessionKey: "agent:alice:brain",
      messages: [],
      prompt:
        "Incoming interrupt. [kazusa:skill=task-interrupt] [kazusa:skill=../../secret]",
    });
    expect(result.systemPromptAddition).toContain("# Kazusa Task Interrupt");
    expect(result.systemPromptAddition).not.toContain("secret");
  });
});
