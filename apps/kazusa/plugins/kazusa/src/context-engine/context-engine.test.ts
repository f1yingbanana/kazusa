import { formatSimTime } from "./format.ts";
import { estimateTokens } from "openclaw/plugin-sdk/agent-core";
import type { SessionCatalogTranscriptItem } from "openclaw/plugin-sdk/session-catalog";
import { describe, expect, it, vi } from "vitest";
import { CONTEXT_ENGINE_CONFIG } from "./config.ts";
import { assembleContext, type ContextEngine } from "./context-engine.ts";
import type { SkillLoader } from "./skill-loader.ts";

vi.mock("openclaw/plugin-sdk/core", () => ({
  buildMemorySystemPromptAddition: vi.fn(() => ""),
}));

const NOW = Date.parse("2026-10-23T12:00:00Z");
type Message = Parameters<ContextEngine["assemble"]>[0]["messages"][number];

function user(content: string): Message {
  return { role: "user", content, timestamp: NOW };
}

function event(text: string, timestamp = NOW): SessionCatalogTranscriptItem {
  return {
    text,
    timestamp: new Date(timestamp).toISOString(),
    type: "agentMessage",
  };
}

function incoming(
  text: string,
  id: string,
  timestamp = NOW,
): SessionCatalogTranscriptItem {
  return {
    ...event(text, timestamp),
    type: "userMessage",
    sender: {
      identity: {
        type: "observation",
        id,
        pluginId: "kazusa",
        accountId: null,
        senderKind: "bot",
      },
      label: "Display name, not identity",
    },
  };
}

const testSkillLoader: SkillLoader = {
  loadSkill: vi.fn(async () => "Stay in character."),
  loadSkillDocument: vi.fn(async () => ({
    frontmatter: null,
    body: "Stay in character.",
  })),
  resolveSkillPath: vi.fn(async () => "/fake/SKILL.md"),
  getCandidateRoots: vi.fn(() => []),
  clearCache: vi.fn(),
};

function assemble(
  overrides: Partial<Parameters<typeof assembleContext>[0]> & {
    messages?: Message[];
    tokenBudget?: number;
  } = {},
): ReturnType<typeof assembleContext> {
  return assembleContext({
    run: {
      sessionId: "brain",
      messages: overrides.messages ?? [],
      tokenBudget: overrides.tokenBudget,
    },
    sessionsContext: {},
    simTime: NOW,
    config: CONTEXT_ENGINE_CONFIG.parse({}),
    skillLoader: testSkillLoader,
    ...overrides,
  });
}

describe("Context assembly", () => {
  it("tolerates an optional skill disappearing after resolution", async () => {
    const loader: SkillLoader = {
      ...testSkillLoader,
      loadSkill: vi.fn(async (name) => {
        if (name === "disappeared")
          throw Object.assign(new Error("Missing skill"), { code: "ENOENT" });
        return "Required conventions";
      }),
    };
    const result = await assemble({
      skillLoader: loader,
      run: {
        sessionId: "brain",
        messages: [],
        prompt: "[kazusa:skill=disappeared]",
      },
    });
    expect(result.systemPromptAddition).toContain("Required conventions");
  });

  it("skips absent optional skills without preventing brain assembly", async () => {
    const loader: SkillLoader = {
      ...testSkillLoader,
      resolveSkillPath: vi.fn(async (name) =>
        name === "missing" ? null : "/fake/SKILL.md",
      ),
      loadSkill: vi.fn(async (name) => `${name} instructions`),
    };
    const result = await assemble({
      skillLoader: loader,
      run: {
        sessionId: "brain",
        messages: [],
        prompt: "[kazusa:skill=missing] [kazusa:skill=task-interrupt]",
      },
    });
    expect(result.systemPromptAddition).toContain(
      "task-interrupt instructions",
    );
    expect(result.systemPromptAddition).not.toContain("missing instructions");
    expect(loader.loadSkill).not.toHaveBeenCalledWith(
      "missing",
      expect.anything(),
    );
  });

  it("formats bracketed envelope with speaker and compact simulation time", async () => {
    const result = await assemble({
      sessionsContext: {
        "agent:alice:chat:direct:bob": [
          incoming("Hello Alice", "bob"),
          event("Hello Bob"),
        ],
        "agent:alice:chat:group:club": [
          incoming("Hello everyone", "carol"),
          incoming("Welcome", "bob"),
        ],
      },
    });
    const text = JSON.stringify(result.messages);
    expect(text).toContain("[bob Fri 2026-10-23 12:00] Hello Alice");
    expect(text).toContain("[(self) Fri 2026-10-23 12:00] Hello Bob");
    expect(text).toContain("[carol Fri 2026-10-23 12:00] Hello everyone");
    expect(text).toContain("[bob Fri 2026-10-23 12:00] Welcome");
  });

  it("uses metadata in both chat kinds, never names or speaker tags in dialogue", async () => {
    const result = await assemble({
      sessionsContext: {
        "agent:alice:chat:direct:bob": [incoming("bob: A quotation", "carol")],
        "agent:alice:chat:group:club": [
          incoming("[speaker:alice] A quotation", "bob"),
        ],
      },
    });
    const text = JSON.stringify(result.messages);
    expect(text).toContain("[carol Fri 2026-10-23 12:00] bob: A quotation");
    expect(text).toContain(
      "[bob Fri 2026-10-23 12:00] [speaker:alice] A quotation",
    );
    expect(text).not.toContain("Display name, not identity");
  });

  it("leaves missing authors unknown instead of guessing from direct peers or dialogue", async () => {
    const result = await assemble({
      sessionsContext: {
        "agent:alice:chat:direct:bob": [
          { ...event("[speaker:bob] Legacy message"), type: "userMessage" },
        ],
        "agent:alice:chat:group:club": [
          { ...event("carol: Legacy message"), type: "userMessage" },
        ],
      },
    });
    const text = JSON.stringify(result.messages);
    expect(text).toContain(
      "[unknown Fri 2026-10-23 12:00] [speaker:bob] Legacy message",
    );
    expect(text).toContain(
      "[unknown Fri 2026-10-23 12:00] carol: Legacy message",
    );
  });

  it("excludes undated and out-of-window records, retaining cutoff boundaries", async () => {
    const cutoff = NOW - 24 * 3_600_000;
    const result = await assemble({
      sessionsContext: {
        "agent:alice:tasks": [
          { type: "agentMessage", text: "undated" },
          { ...event("invalid date"), timestamp: "invalid" },
          event("too old", cutoff - 1),
          event("future", NOW + 1),
          event("at cutoff", cutoff),
          event("at now", NOW),
        ],
      },
    });
    const text = JSON.stringify(result.messages);
    expect(text).not.toMatch(/undated|invalid date|too old|future/u);
    expect(text).toContain("at cutoff");
    expect(text).toContain("at now");
  });

  it("selects across sources and then groups whole records by session", async () => {
    const result = await assemble({
      sessionsContext: {
        "agent:alice:chat:group:club": [
          incoming("group reply", "bob", NOW - 1),
        ],
        "agent:alice:tasks": [
          event("reading experience", NOW - 3),
          event("latest experience", NOW),
        ],
        "agent:alice:chat:direct:bob": [event("direct reply", NOW - 2)],
      },
    });
    const text = JSON.stringify(result.messages);
    expect(text.indexOf("reading experience")).toBeLessThan(
      text.indexOf("latest experience"),
    );
    expect(text.match(/### tasks/gu)).toHaveLength(1);
    expect(text).toContain(`[${formatSimTime(NOW - 3)}] reading experience`);
    expect(text).not.toContain(
      `[(self) ${formatSimTime(NOW - 3)}] reading experience`,
    );
    expect(result.systemPromptAddition).toContain("simulation time");
    expect(text).toContain("chat:group:club");
    expect(result.messages.every((message) => message.role === "user")).toBe(
      true,
    );
    expect(result.systemPromptAddition).not.toContain("group reply");
  });

  it("omits non-conversation catalog items and empty text", async () => {
    const result = await assemble({
      sessionsContext: {
        "agent:alice:tasks": [
          { ...event("tool internals"), type: "toolCall" },
          { ...event("hidden reasoning"), type: "reasoning" },
          { type: "agentMessage", timestamp: new Date(NOW).toISOString() },
          event("  "),
          event("Visible experience"),
        ],
      },
    });
    const text = JSON.stringify(result.messages);
    expect(text).not.toMatch(/tool internals|hidden reasoning/);
    expect(text).toContain("Visible experience");
  });

  it("adds current simulation time, without inventing an active-task snapshot", async () => {
    const result = await assemble();
    expect(result.messages).toEqual([]);
    expect(result.systemPromptAddition).toContain(formatSimTime(NOW));
    expect(result.systemPromptAddition).not.toContain("No active task");
  });

  it("uses leftover space for newest records without mutating the source streams", async () => {
    const messages = Array.from({ length: 50 }, (_, index) =>
      event(`event-${index} ${"x".repeat(150)}`, NOW - 50 + index),
    );
    const sessionsContext = { "agent:alice:tasks": messages };
    const original = structuredClone(sessionsContext);
    const result = await assemble({ sessionsContext, tokenBudget: 700 });
    const text = JSON.stringify(result.messages);
    expect(text).toContain("event-49");
    expect(text).not.toContain("event-0 ");
    expect(result.estimatedTokens).toBeLessThanOrEqual(700);
    expect(sessionsContext).toEqual(original);
  });

  it.each([100, 1_000, 10_000])(
    "respects a host budget of %i, including added guidance",
    async (tokenBudget) => {
      const result = await assemble({
        tokenBudget,
        sessionsContext: {
          "agent:alice:tasks": [event("日本語の記憶 ".repeat(600))],
        },
      });
      expect(result.estimatedTokens).toBeLessThanOrEqual(tokenBudget);
    },
  );

  it("skips oversized records without clipping them, leaving room for older messages", async () => {
    const result = await assemble({
      tokenBudget: 600,
      sessionsContext: {
        "agent:alice:tasks": [event("A long experience. ".repeat(600))],
        "agent:alice:chat:direct:bob": [
          event("A complete older message.", NOW - 1),
        ],
      },
    });
    expect(result.estimatedTokens).toBeLessThanOrEqual(600);
    const text = JSON.stringify(result.messages);
    expect(text).not.toContain("A long experience");
    expect(text).not.toContain("[truncated]");
    expect(text).toContain("A complete older message.");
  });

  it.each([0, 1, 10])(
    "fails clearly rather than chopping mandatory instructions at budget %i",
    async (tokenBudget) => {
      await expect(assemble({ tokenBudget })).rejects.toThrow("cannot fit");
    },
  );

  it("uses the SDK's estimate for both history and guidance", async () => {
    const result = await assemble({
      sessionsContext: { "agent:alice:tasks": [event("日本語の記憶 🌸")] },
    });
    expect(result.estimatedTokens).toBe(
      result.messages.reduce(
        (sum, message) => sum + estimateTokens(message),
        0,
      ) + estimateTokens(user(result.systemPromptAddition ?? "")),
    );
  });

  it("keeps a complete recent tool turn and drops whole older turns", async () => {
    const toolTurn: Message[] = [
      user("recent stimulus"),
      {
        role: "assistant",
        timestamp: NOW,
        content: [
          { type: "toolCall", id: "call-1", name: "start_task", arguments: {} },
        ],
        api: "openai-completions",
        provider: "test",
        model: "test",
        stopReason: "toolUse",
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
      },
      {
        role: "toolResult",
        timestamp: NOW,
        toolCallId: "call-1",
        toolName: "start_task",
        content: [{ type: "text", text: "Started reading" }],
        isError: false,
      },
    ];
    const brainMaxTokens = toolTurn.reduce(
      (sum, message) => sum + estimateTokens(message),
      0,
    );
    const params = {
      messages: [user("old stimulus"), ...toolTurn],
      config: CONTEXT_ENGINE_CONFIG.parse({
        brainMaxTokens,
      }),
    };
    expect((await assemble(params)).messages).toEqual(toolTurn);
    expect(
      (
        await assemble({
          ...params,
          config: { ...params.config, brainMaxTokens: brainMaxTokens - 1 },
        })
      ).messages,
    ).toEqual([]);
    const steered = [
      ...toolTurn.slice(0, 2),
      user("another stimulus mid-tool"),
      ...toolTurn.slice(2),
    ];
    expect((await assemble({ ...params, messages: steered })).messages).toEqual(
      [],
    );
    expect(
      (
        await assemble({
          ...params,
          messages: steered,
          config: { ...params.config, brainMaxTokens: brainMaxTokens + 100 },
        })
      ).messages,
    ).toEqual(steered);
  });

  it("preserves native recovery summaries as whole brain history", async () => {
    const message: Message = {
      role: "compactionSummary",
      summary: "Unfinished reply to Bob",
      tokensBefore: 100,
      timestamp: NOW,
    };
    expect((await assemble({ messages: [message] })).messages).toEqual([
      message,
    ]);
  });

  it("dynamically loads skill when kazusa:skill tag is present", async () => {
    const mockLoader: SkillLoader = {
      loadSkill: vi.fn(async (name: string) => `# Mock Skill: ${name}`),
      loadSkillDocument: vi.fn(async (name: string) => ({
        frontmatter: { name },
        body: `# Mock Skill: ${name}`,
      })),
      resolveSkillPath: vi.fn(async () => "/fake/SKILL.md"),
      getCandidateRoots: vi.fn(() => []),
      clearCache: vi.fn(),
    };
    const result = await assemble({
      skillLoader: mockLoader,
      run: {
        sessionId: "brain",
        messages: [],
        prompt: "Task wake. [kazusa:skill=task-lifecycle]",
      },
    });
    expect(mockLoader.loadSkill).toHaveBeenCalledWith(
      "task-lifecycle",
      expect.anything(),
    );
    expect(result.systemPromptAddition).toContain(
      "# Mock Skill: task-lifecycle",
    );
  });

  it("only loads context-conventions and no tag skills when prompt is untagged", async () => {
    const mockLoader: SkillLoader = {
      loadSkill: vi.fn(async (name) => {
        if (name === "context-conventions") return "# Context Conventions";
        return "Unexpected skill";
      }),
      loadSkillDocument: vi.fn(async () => ({
        frontmatter: null,
        body: "# Context Conventions",
      })),
      resolveSkillPath: vi.fn(async () => "/fake/SKILL.md"),
      getCandidateRoots: vi.fn(() => []),
      clearCache: vi.fn(),
    };
    const result = await assemble({
      skillLoader: mockLoader,
      run: {
        sessionId: "brain",
        messages: [],
        prompt: "Regular chat message without any skill tags",
      },
    });
    expect(mockLoader.loadSkill).toHaveBeenCalledTimes(1);
    expect(mockLoader.loadSkill).toHaveBeenCalledWith(
      "context-conventions",
      expect.anything(),
    );
    expect(result.systemPromptAddition).toContain("# Context Conventions");
    expect(result.systemPromptAddition).not.toContain("Unexpected skill");
    expect(result.systemPromptAddition).toContain(formatSimTime(NOW));
  });

  it("defaults to 24 simulated hours, permits more, and rejects removed config", () => {
    expect(CONTEXT_ENGINE_CONFIG.parse({}).shortTermHours).toBe(24);
    expect(
      CONTEXT_ENGINE_CONFIG.parse({ shortTermHours: 48 }).shortTermHours,
    ).toBe(48);
    expect(() => CONTEXT_ENGINE_CONFIG.parse({ shortTermHours: 0 })).toThrow();
    expect(() =>
      CONTEXT_ENGINE_CONFIG.parse({ maxEventTokens: 100 }),
    ).toThrow();
    expect(() => CONTEXT_ENGINE_CONFIG.parse({ unusedOption: true })).toThrow();
  });
});
