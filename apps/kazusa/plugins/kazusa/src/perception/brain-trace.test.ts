import { describe, expect, it } from "vitest";
import { brainTurns } from "./brain-trace.ts";

const user = (entryId: string, content: unknown, timestamp = 1) => ({
  entryId,
  message: { role: "user", content, timestamp },
});
const assistant = (
  entryId: string,
  runId: string | undefined,
  content: unknown,
  extra: Record<string, unknown> = {},
) => ({
  entryId,
  message: {
    role: "assistant",
    content,
    timestamp: 2,
    __openclaw: runId ? { runId } : {},
    ...extra,
  },
});
const usage = (input: number, output: number, cost?: number) => ({
  input,
  output,
  cacheRead: 1,
  cacheWrite: 0,
  totalTokens: input + output + 1,
  ...(cost === undefined ? {} : { cost: { total: cost } }),
});

describe("brainTurns", () => {
  it("makes one turn per run and one call per assistant message", () => {
    const turns = brainTurns([
      user("u1", "wake up"),
      assistant(
        "a1",
        "run-1",
        [
          { type: "thinking", thinking: "hmm" },
          {
            type: "toolCall",
            id: "t1",
            name: "start_task",
            arguments: { a: 1 },
          },
        ],
        { provider: "zai", model: "glm", usage: usage(10, 5, 0.5) },
      ),
      {
        entryId: "r1",
        message: {
          role: "toolResult",
          toolCallId: "t1",
          content: [{ type: "text", text: "blocked" }],
          isError: true,
        },
      },
      assistant("a2", "run-1", [{ type: "text", text: "NO_REPLY" }], {
        usage: usage(20, 1, 0.25),
      }),
      user("u2", [{ type: "text", text: "again" }]),
      assistant("a3", "run-2", [{ type: "text", text: "ok" }]),
    ]);

    expect(turns.map((turn) => turn.id)).toEqual(["run-1", "run-2"]);
    expect(turns[0].prompts).toEqual(["wake up"]);
    expect(turns[0].calls).toHaveLength(2);
    expect(turns[0].calls[0].model).toBe("glm");
    expect(turns[0].calls[0].steps[1]).toMatchObject({
      type: "tool",
      name: "start_task",
      result: "blocked",
      isError: true,
    });
    expect(turns[0].usage).toMatchObject({
      input: 30,
      output: 6,
      total: 38,
      cost: 0.75,
    });
    expect(turns[1].prompts).toEqual(["again"]);
    expect(turns[1].usage).toBeUndefined();
  });

  it("keeps a tool call with no result, which may still have run", () => {
    const [turn] = brainTurns([
      assistant("a1", "run-1", [
        { type: "toolCall", id: "t1", name: "send_message", arguments: {} },
      ]),
    ]);
    const step = turn.calls[0].steps[0];
    expect(step).toMatchObject({ type: "tool", name: "send_message" });
    expect(step).not.toHaveProperty("result");
  });

  it("attaches input that arrives mid-run to that run", () => {
    const [turn, ...rest] = brainTurns([
      assistant("a1", "run-1", [{ type: "text", text: "one" }]),
      user("u1", "steer"),
      assistant("a2", "run-1", [{ type: "text", text: "two" }]),
    ]);
    expect(rest).toEqual([]);
    expect(turn.prompts).toEqual(["steer"]);
  });

  it("returns input no run has reached as a last turn with no calls", () => {
    const turns = brainTurns([
      assistant("a1", "run-1", [{ type: "text", text: "one" }]),
      user("u1", "waiting"),
    ]);
    expect(turns[1]).toMatchObject({ prompts: ["waiting"], calls: [] });
  });

  it("clips very long text", () => {
    const [turn] = brainTurns([user("u1", "x".repeat(9000))]);
    expect(turn.prompts[0]).toContain("… (1000 more characters)");
  });

  it("has no turns for an empty transcript", () => {
    expect(brainTurns([])).toEqual([]);
  });
});
