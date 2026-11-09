import { estimateTokens } from "openclaw/plugin-sdk/agent-core";
import { describe, expect, it } from "vitest";
import { brainTurns } from "../perception/brain-trace.ts";
import { sharedDir } from "../shared-dir.ts";
import { createSkillText } from "../skill-text.ts";
import { callShape, errorLine, renderToolHistory } from "./tool-history.ts";

const skillText = createSkillText({
  getCandidateRoots: () => [sharedDir("skills")],
});
const text = (section: string, values?: Record<string, string>) =>
  skillText(`kazusa-deliveries#${section}`, values);

describe("callShape", () => {
  it("keeps where a message went, never what it said", () => {
    const shape = callShape("send_message", {
      sessionKey: "chat:direct:user:sensei",
      messages: [
        { type: "action", text: "waves" },
        { type: "text", text: "Morning, Sensei! Did you sleep at all?" },
      ],
    });
    expect(shape).toContain("chat:direct:user:sensei");
    const huddle = `chat:huddle:${"f".repeat(64)}`;
    expect(
      callShape("send_message", { sessionKey: huddle, messages: [] }),
    ).toContain(huddle);
    expect(shape).toContain("2 (action, text)");
    expect(shape).not.toContain("Morning");
  });

  it("cuts long strings in other tools", () => {
    const shape = callShape("start_task", {
      type: "socializing",
      description: "a long walk ".repeat(20),
    });
    expect(shape).toContain('"type":"socializing"');
    expect(shape.length).toBeLessThan(120);
  });
});

describe("errorLine", () => {
  it("unwraps the host's envelope and Zod's issues", () => {
    const text = JSON.stringify({
      status: "error",
      tool: "send_message",
      error: JSON.stringify([
        {
          path: [],
          message: "Supply either a sessionKey or members for a chat.",
        },
      ]),
    });
    expect(errorLine(text)).toBe(
      "Supply either a sessionKey or members for a chat.",
    );
  });
});

describe("renderToolHistory", () => {
  const call = (id: string, name: string, args: unknown, runId: string) => ({
    entryId: id,
    message: {
      role: "assistant",
      content: [{ type: "toolCall", id, name, arguments: args }],
      __openclaw: { runId },
    },
  });
  const result = (toolCallId: string, text: string, isError = false) => ({
    entryId: `${toolCallId}-result`,
    message: {
      role: "toolResult",
      toolCallId,
      content: [{ type: "text", text }],
      isError,
    },
  });
  const prompt = (entryId: string, content: string) => ({
    entryId,
    message: { role: "user", content },
  });
  const turns = brainTurns([
    prompt("p1", "[Mon 2026-11-02 00:09] Messages noticed while thinking: …"),
    call("t1", "start_task", { type: "eating" }, "r1"),
    result("t1", "started"),
    prompt("p2", "[Mon 2026-11-02 07:30] Your activity has ended."),
    call("t2", "send_message", { messages: [{ type: "text" }] }, "r2"),
    result("t2", "Supply either a sessionKey or members for a chat.", true),
    call("t3", "wiki_lint", {}, "r2"),
  ]);

  it("shows each past call and its outcome, oldest first, under its turn's time", () => {
    expect(renderToolHistory(turns, 1000, text)).toBe(
      [
        "Your recent tool calls, already done: how you called each and what came back.",
        "",
        "[Mon 2026-11-02 00:09]",
        '- start_task {"type":"eating"} → ok',
        "",
        "[Mon 2026-11-02 07:30]",
        '- send_message {"messages":"1 (text)"} → error: Supply either a sessionKey or members for a chat.',
        "- wiki_lint {} → no result",
      ].join("\n"),
    );
  });

  it("keeps the newest calls that fit, and nothing at 0", () => {
    const tight = renderToolHistory(turns, 50, text);
    expect(tight).toContain("wiki_lint");
    expect(tight).not.toContain("start_task");
    expect(renderToolHistory(turns, 0, text)).toBe("");
    expect(renderToolHistory([], 1000, text)).toBe("");
  });

  // A long history: turns of one to four calls, some failing, some unanswered.
  const long = brainTurns(
    Array.from({ length: 40 }, (_, turn) => {
      const hour = String(turn % 24).padStart(2, "0");
      const rows: object[] = [
        prompt(`p${turn}`, `[Mon 2026-11-02 ${hour}:15] Turn ${turn}.`),
      ];
      for (let index = 0; index <= turn % 4; index += 1) {
        const id = `c${turn}-${index}`;
        rows.push(
          call(
            id,
            index % 2 ? "send_message" : "start_task",
            index % 2
              ? { sessionKey: `chat:direct:p${turn}`, messages: [{}, {}] }
              : { type: "working", description: `task number ${turn}` },
            `r${turn}`,
          ),
        );
        if (index !== 3)
          rows.push(
            result(id, index === 2 ? "Unknown chat." : "ok", index === 2),
          );
      }
      return rows as Parameters<typeof brainTurns>[0];
    }).flat(),
  );

  /** The digest as it was first written: every line formatted, then trimmed. */
  function formatAllThenTrim(maxTokens: number): string {
    const tokens = (line: string) =>
      line ? estimateTokens({ role: "user", content: line, timestamp: 0 }) : 0;
    const calls = long.flatMap((turn) => {
      const stamp =
        turn.prompts[0]?.match(
          /^\[[^\]\n]*\d{4}-\d{2}-\d{2} \d{2}:\d{2}[^\]\n]*\]/,
        )?.[0] ?? "";
      return turn.calls
        .flatMap((step) => step.steps)
        .flatMap((step) => {
          if (step.type !== "tool") return [];
          const outcome =
            step.result === undefined
              ? text("tool-no-result")
              : step.isError
                ? text("tool-error", { error: errorLine(step.result) })
                : text("tool-ok");
          const line = text("tool-call", {
            name: step.name,
            args: callShape(step.name, JSON.parse(step.input)),
            outcome,
          });
          return [{ turn, stamp, line }];
        });
    });
    const heading = text("tool-history");
    let used = tokens(heading);
    let from = calls.length;
    while (from > 0) {
      const { turn, stamp, line } = calls[from - 1];
      const cost =
        tokens(line) + (calls[from]?.turn === turn ? 0 : tokens(stamp));
      if (used + cost > maxTokens) break;
      used += cost;
      from -= 1;
    }
    if (from === calls.length) return "";
    return [
      heading,
      ...calls
        .slice(from)
        .flatMap(({ turn, stamp, line }, index, kept) =>
          kept[index - 1]?.turn === turn
            ? [line]
            : ["", ...(stamp ? [stamp] : []), line],
        ),
    ].join("\n");
  }

  it("matches formatting everything then trimming, at every budget", () => {
    for (const budget of [0, 20, 40, 60, 90, 150, 300, 600, 1200, 4000, 1e6])
      expect(renderToolHistory(long, budget, text)).toBe(
        formatAllThenTrim(budget),
      );
  });

  it("words only the lines it keeps", () => {
    let lookups = 0;
    const counted = (section: string, values?: Record<string, string>) => {
      lookups += 1;
      return text(section, values);
    };
    const digest = renderToolHistory(long, 600, counted);
    const kept = digest.split("\n").filter((line) => line.startsWith("- "));
    // The heading, two per kept line, and two for the one that didn't fit.
    expect(lookups).toBe(1 + 2 * kept.length + 2);
    expect(kept.length).toBeLessThan(
      long.flatMap((turn) => turn.calls.flatMap((c) => c.steps)).length / 2,
    );
  });
});
