import { describe, expect, it, vi } from "vitest";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import type { Clock } from "../clock/clock.ts";
import { registerTaskman } from "./register.ts";
import { executeDelayTask, executeStartTask } from "./taskman.ts";
import {
  TASK_CATEGORIES,
  type ActiveTask,
  type TaskStore,
  type ToolExecutionContext,
} from "./types.ts";

function createInMemoryTaskStore(): TaskStore {
  const tasks = new Map<string, ActiveTask>();
  return {
    async lookup(key: string): Promise<ActiveTask | undefined> {
      return tasks.get(key);
    },
    async register(key: string, value: ActiveTask): Promise<void> {
      tasks.set(key, value);
    },
    async entries() {
      return [...tasks.entries()].map(([key, value]) => ({
        key,
        value,
        createdAt: 0,
      }));
    },
  };
}

function makeContext(): {
  readonly context: ToolExecutionContext;
  readonly messages: string[];
  readonly timestamps: number[];
} {
  const messages: string[] = [];
  const timestamps: number[] = [];
  return {
    messages,
    timestamps,
    context: {
      agentId: "alice",
      store: createInMemoryTaskStore(),
      clock: {
        time: (): number => new Date("2026-10-21T08:00:00.000Z").getTime(),
      },
      minDuration: 15,
      async appendTaskLedgerEntry(
        message: string,
        timestamp: number,
      ): Promise<void> {
        messages.push(message);
        timestamps.push(timestamp);
      },
    },
  };
}

describe("Taskman", () => {
  it("assigns distinct IDs at the same simulation instant and preserves identity on delay", async () => {
    const { context } = makeContext();
    const first = await executeStartTask(
      { type: "having fun", description: "Book", duration: 20 },
      context,
    );
    const next = await executeStartTask(
      { type: "having fun", description: "Book", duration: 20 },
      context,
    );
    if (!first.success || !next.success)
      throw new Error("Expected task starts");
    expect(first.task.startedAt).toBe(next.task.startedAt);
    expect(first.task.id).not.toBe(next.task.id);
    expect(first.task.id).toMatch(/^[\da-f-]{36}$/);
    const delayed = await executeDelayTask({ additionalDuration: 5 }, context);
    expect(delayed.task?.id).toBe(next.task.id);
    expect(delayed.task?.endAt).not.toBe(next.task.endAt);
  });

  it("creates one durable task lease", async () => {
    const { context, messages, timestamps } = makeContext();
    const result = await executeStartTask(
      {
        type: "eating",
        description: "Eating scones and tea",
        duration: 5,
      },
      context,
    );

    expect(result.success).toBe(true);
    if (!result.success) throw new Error("Expected the task to start");
    expect(result.task).toMatchObject({
      duration: 15,
      startedAt: "2026-10-21T08:00:00.000Z",
      endAt: "2026-10-21T08:15:00.000Z",
    });
    expect(messages).toEqual([result.message]);
    expect(timestamps).toEqual([Date.parse(result.task.startedAt)]);
  });

  it("replaces the active task and appends a monologue below its summary", async () => {
    const { context, messages } = makeContext();
    const first = await executeStartTask(
      { type: "having fun", description: "Reading a book", duration: 30 },
      context,
    );
    if (!first.success) throw new Error("Expected the first task to start");
    const replacement = await executeStartTask(
      {
        type: "working",
        description: "Writing a letter",
        duration: 30,
        summary: "Finished the final chapter.",
        monologue: "  What an ending. I need to tell Mira about it.  ",
      },
      context,
    );

    expect(replacement).toMatchObject({
      success: true,
      task: { type: "working" },
    });
    await expect(context.store.lookup("alice")).resolves.toMatchObject({
      type: "working",
    });
    expect(messages).toHaveLength(2);
    expect(messages.at(-1)).toBe(
      `${replacement.message}\n\n> *What an ending. I need to tell Mira about it.*`,
    );
    expect(replacement.message).toContain("Concluded having fun task");
    expect(replacement.message).toContain("Finished the final chapter.");
    expect(replacement.message).not.toContain("What an ending.");
    // This reflection belongs to the historical event, not the new active task.
    await expect(context.store.lookup("alice")).resolves.not.toHaveProperty(
      "monologue",
    );
  });

  it("delays a task and appends a monologue below its reason", async () => {
    const { context, messages } = makeContext();
    await executeStartTask(
      { type: "studying", description: "Studying counterpoint", duration: 60 },
      context,
    );
    const delayed = await executeDelayTask(
      {
        additionalDuration: 15,
        reason: "The last exercise needs more work",
        monologue:
          "I can hear the melody, but the harmony keeps slipping away.",
      },
      context,
    );
    expect(delayed.task).toMatchObject({
      duration: 75,
      endAt: "2026-10-21T09:15:00.000Z",
    });
    expect(messages.at(-1)).toBe(
      `${delayed.message}\n\n> *I can hear the melody, but the harmony keeps slipping away.*`,
    );
    expect(delayed.message).toContain("The last exercise needs more work");
    expect(delayed.message).not.toContain("I can hear the melody");
  });

  it("does not record a monologue when there is no task to delay", async () => {
    const { context, messages } = makeContext();
    const result = await executeDelayTask(
      { monologue: "I need more time." },
      context,
    );

    expect(result.success).toBe(false);
    expect(messages).toEqual([]);
  });
});

describe("Task ledger formatting", () => {
  it("renders a monologue in its own italicized blockquote", async () => {
    const { context, messages } = makeContext();
    const result = await executeStartTask(
      {
        type: "having fun",
        description: "Reading",
        duration: 30,
        monologue: "What an ending. I need to tell Mira about it.",
      },
      context,
    );
    expect(messages[0]).toBe(
      `${result.message}\n\n> *What an ending. I need to tell Mira about it.*`,
    );
  });

  it.each([undefined, "", " \n "])(
    "omits an empty monologue (%j)",
    async (monologue) => {
      const { context, messages } = makeContext();
      const result = await executeStartTask(
        { type: "having fun", description: "Reading", duration: 30, monologue },
        context,
      );
      expect(messages).toEqual([result.message]);
    },
  );

  it("keeps multiline text and Markdown punctuation inside the italic quote", async () => {
    const { context, messages } = makeContext();
    const result = await executeStartTask(
      {
        type: "having fun",
        description: "Reading",
        duration: 30,
        monologue:
          "I *must* finish.\n\n> The note says [wait](later) and <stop>.",
      },
      context,
    );
    expect(messages[0]).toBe(
      `${result.message}\n\n> *I \\*must\\* finish. \\> The note says \\[wait\\](later) and \\<stop\\>.*`,
    );
  });
});

describe("Configurable task categories", () => {
  it("binds custom categories to start_task tool schema enum", () => {
    const registeredTools: Array<{
      name: string;
      parameters?: { properties?: { type?: { enum?: string[] } } };
    }> = [];
    const mockApi = {
      pluginConfig: {
        taskman: {
          categories: ["questing", "feasting", "crafting"],
        },
      },
      runtime: {
        state: {
          openKeyedStore: () => createInMemoryTaskStore(),
        },
      },
      lifecycle: {},
      registerTool(
        factory: (ctx: unknown) => {
          name: string;
          parameters?: { properties?: { type?: { enum?: string[] } } };
        },
      ) {
        registeredTools.push(factory({}));
      },
      on() {},
    } as unknown as OpenClawPluginApi;

    const mockClock = {
      init: vi.fn(),
      time: () => 0,
      onClockChange: () => () => {},
    } as unknown as Clock;

    registerTaskman(mockApi, { clock: mockClock });

    const startTaskTool = registeredTools.find((t) => t.name === "start_task");
    expect(startTaskTool).toBeDefined();
    expect(startTaskTool?.parameters?.properties?.type?.enum).toEqual([
      "questing",
      "feasting",
      "crafting",
    ]);
  });

  it("defaults to canonical TASK_CATEGORIES when categories are omitted", () => {
    const registeredTools: Array<{
      name: string;
      parameters?: { properties?: { type?: { enum?: string[] } } };
    }> = [];
    const mockApi = {
      pluginConfig: {},
      runtime: {
        state: {
          openKeyedStore: () => createInMemoryTaskStore(),
        },
      },
      lifecycle: {},
      registerTool(
        factory: (ctx: unknown) => {
          name: string;
          parameters?: { properties?: { type?: { enum?: string[] } } };
        },
      ) {
        registeredTools.push(factory({}));
      },
      on() {},
    } as unknown as OpenClawPluginApi;

    const mockClock = {
      init: vi.fn(),
      time: () => 0,
      onClockChange: () => () => {},
    } as unknown as Clock;

    registerTaskman(mockApi, { clock: mockClock });

    const startTaskTool = registeredTools.find((t) => t.name === "start_task");
    expect(startTaskTool).toBeDefined();
    expect(startTaskTool?.parameters?.properties?.type?.enum).toEqual([
      ...TASK_CATEGORIES,
    ]);
  });
});
