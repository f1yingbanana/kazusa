import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { readRecentUserAssistantTextForSession } from "openclaw/plugin-sdk/session-store-runtime";
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

vi.mock("openclaw/plugin-sdk/session-store-runtime", () => ({
  readRecentUserAssistantTextForSession: vi.fn(),
}));

const SIM_TIME = Date.parse("2026-10-23T08:00:00Z");

async function setup(contextEngine = {}) {
  const register = vi.fn<OpenClawPluginApi["registerContextEngine"]>();
  const readHistory = vi.mocked(readRecentUserAssistantTextForSession);
  readHistory.mockReset();
  readHistory.mockImplementation(async ({ sessionKey }) => [
    {
      role: "assistant",
      timestamp: SIM_TIME - 1_000,
      text: `experience from ${sessionKey}`,
    },
  ]);
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
    config: {},
    pluginConfig: { contextEngine },
    registerContextEngine: register,
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
  return { engine, register, readHistory, assertCurrent };
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
      minTimestampMs: SIM_TIME - 24 * 3_600_000,
      beforeTimestampMs: SIM_TIME + 1,
      limit: Number.MAX_SAFE_INTEGER,
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
    readHistory.mockResolvedValue([
      { role: "user", text: "undated memory" },
      { role: "assistant", text: "dated memory", timestamp: SIM_TIME },
    ]);
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
      await engine.assemble({
        runtimeContext: { sessionTarget: { agentId: "alice" } },
        sessionId: "brain",
        sessionKey: "agent:alice:brain",
        messages: [],
      });
      expect(readHistory).toHaveBeenCalledWith(
        expect.objectContaining({
          minTimestampMs: cutoff,
          beforeTimestampMs: SIM_TIME + 1,
        }),
      );
    },
  );

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
