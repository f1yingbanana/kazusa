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
});
