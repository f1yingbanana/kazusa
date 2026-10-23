import { describe, expect, it } from "vitest";
import { executeDelayTask, executeStartTask } from "./taskman.ts";
import type { ActiveTask, TaskStore, ToolExecutionContext } from "./types.ts";

function createInMemoryTaskStore(): TaskStore {
  const tasks = new Map<string, ActiveTask>();
  return {
    async lookup(key: string): Promise<ActiveTask | undefined> {
      return tasks.get(key);
    },
    async register(key: string, value: ActiveTask): Promise<void> {
      tasks.set(key, value);
    },
    async entries(): Promise<
      ReadonlyArray<{ readonly key: string; readonly value: ActiveTask }>
    > {
      return [...tasks.entries()].map(([key, value]) => ({ key, value }));
    },
  };
}

function makeContext(): {
  readonly context: ToolExecutionContext;
  readonly messages: string[];
} {
  const messages: string[] = [];
  return {
    messages,
    context: {
      agentId: "alice",
      store: createInMemoryTaskStore(),
      clock: {
        time: (): number => new Date("2026-10-21T08:00:00.000Z").getTime(),
      },
      minDuration: 15,
      async appendTaskLedgerEntry(message: string): Promise<void> {
        messages.push(message);
      },
    },
  };
}

describe("Taskman", () => {
  it("creates one durable task lease", async () => {
    const { context, messages } = makeContext();
    const result = await executeStartTask(
      {
        type: "eat_breakfast",
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
    expect(messages).toHaveLength(1);
  });

  it("replaces the active task", async () => {
    const { context, messages } = makeContext();
    const first = await executeStartTask(
      { type: "reading", description: "Reading a book", duration: 30 },
      context,
    );
    if (!first.success) throw new Error("Expected the first task to start");
    const replacement = await executeStartTask(
      {
        type: "writing",
        description: "Writing a letter",
        duration: 30,
        summary: "Finished the final chapter.",
      },
      context,
    );

    expect(replacement).toMatchObject({
      success: true,
      task: { type: "writing" },
    });
    await expect(context.store.lookup("alice")).resolves.toMatchObject({
      type: "writing",
    });
    expect(messages.at(-1)).toContain("Concluded reading task");
  });

  it("delays a task", async () => {
    const { context } = makeContext();
    await executeStartTask(
      { type: "study", description: "Studying counterpoint", duration: 60 },
      context,
    );
    const delayed = await executeDelayTask({ additionalDuration: 15 }, context);
    expect(delayed.task).toMatchObject({ duration: 75 });
  });
});
