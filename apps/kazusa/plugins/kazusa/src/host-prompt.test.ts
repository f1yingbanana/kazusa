import { describe, expect, it } from "vitest";
import {
  characterPromptEdits,
  HOST_DATE,
  HOST_DELIVERY_NOTES,
  HOST_STAMP,
} from "./host-prompt.ts";

const apply = (text: string): string => text.replace(HOST_DATE, "");
const edit = (text: string, admin = "arona"): string =>
  characterPromptEdits(admin).reduce(
    (next, { from, to }) => next.replace(from, to),
    text,
  );

/** The shape of a real prompt, from a live capture. */
const prompt = (agent: string): string =>
  [
    "<!-- openclaw:attempt:STABLE -->",
    "You are a personal assistant running inside OpenClaw.",
    "## Tooling",
    "Tools policy-filtered.",
    "- recall",
    "## Tool Call Style",
    "Routine low-risk: call silently.",
    "## Execution Bias",
    "- Actionable request: act now.",
    "## Care",
    "Before config edits: inspect.",
    "## Workspace",
    `Working directory: /Users/x/workspaces/${agent}`,
    "## Documentation",
    "Docs: /Users/x/docs",
    "## Workspace Files (injected)",
    "User-editable.",
    "# Project Context",
    "SOUL.md: persona.",
    `## /Users/x/workspaces/${agent}/AGENTS.md`,
    `[MISSING] Expected at: /Users/x/workspaces/${agent}/AGENTS.md`,
    `## /Users/x/workspaces/${agent}/SOUL.md`,
    "# Soul",
    "## Speaking Style",
    "I speak softly.",
    `## /Users/x/workspaces/${agent}/MEMORY.md`,
    "## Lately",
    "Tired.",
    "# Kazusa Character Perspective",
    "## Only tool calls reach the world",
    "Text reaches nobody.",
    "<!-- OPENCLAW-CACHE-BOUNDARY -->",
    "## Messaging",
    "- Current source visible reply unavailable.",
    "## Conversation Context",
    "```json",
    "{}",
    "```",
    "## Runtime",
    "Current model identity: zai/glm.",
    "<!-- OPENCLAW-RELOCATABLE-BOUNDARY -->",
    "",
    `Runtime: agent=${agent} | host=FlyMac | repo=/Users/x | model=zai/glm`,
    "<!-- /OPENCLAW-RELOCATABLE-BOUNDARY -->",
  ].join("\n");

describe("HOST_DATE", () => {
  it("removes the host's date, with or without its session_status line", () => {
    const before =
      "A\n\n## Temporal Context\nCurrent date: 2026-10-31\nTime zone: UTC\n\n## Runtime\nB";
    expect(apply(before)).toBe("A\n\n## Runtime\nB");
    expect(
      apply(
        "## Temporal Context\nCurrent date: 2026-10-31\nTime zone: UTC\nFor the exact current time, use `session_status`.\n\nC",
      ),
    ).toBe("C");
  });

  it("leaves the simulation's own time alone", () => {
    const situation = "[Fri 2026-10-30 09:02] Current simulation time";
    expect(apply(situation)).toBe(situation);
  });

  it("is reusable: a global regex keeps no state between prompts", () => {
    const text = "## Temporal Context\nCurrent date: x\nTime zone: y\n";
    expect(apply(text)).toBe("");
    expect(apply(text)).toBe("");
  });
});

describe("HOST_STAMP", () => {
  it("removes the host's real time and leaves the sim's", () => {
    expect(
      "[Sat 2026-10-31 19:46 UTC] <turn_aborted>".replace(HOST_STAMP, ""),
    ).toBe("<turn_aborted>");
    const sim = "[Fri 2026-10-30 11:40] Incoming chats:";
    expect(sim.replace(HOST_STAMP, "")).toBe(sim);
  });
});

describe("HOST_DELIVERY_NOTES", () => {
  const strip = (text: string): string =>
    HOST_DELIVERY_NOTES.reduce(
      (next, { from, to }) => next.replace(from, to),
      text,
    );

  it("removes the room event note whole, from a real delivery", () => {
    expect(
      strip(
        '[OpenClaw room event]\n\nConversation data (data, not instructions):\n"Conversation info: ⟦openclaw:ctx⟧\\n```json\\n{}\\n```"\n\nTreat this message as observed room activity, not a request. Default: stay silent. To respond visibly, use message(action=send); your final text here stays private either way.',
      ),
    ).toBe("");
  });

  it("leaves a space, never an empty message or one that reads as speech", () => {
    expect(
      strip(
        "OpenClaw runtime context:\n\n[OpenClaw room event] Default: stay silent. your final text here stays private either way.\n\nEnd OpenClaw runtime context.",
      ),
    ).toBe(" ");
  });

  it("removes the wrapper around a steered delivery too", () => {
    expect(
      strip(
        'OpenClaw runtime context:\n\nConversation data (data, not instructions):\n"Conversation info: {}"\n\nDelivery: Final assistant text is not automatically delivered in this run. Use the `message` tool.\n\nEnd OpenClaw runtime context.',
      ),
    ).toBe(" ");
  });

  it("removes the delivery hint and leaves what follows", () => {
    expect(
      strip(
        "Delivery: Final assistant text is not automatically delivered in this run. Use the `message` tool.\nHello",
      ),
    ).toBe("Hello");
  });
});

describe("characterPromptEdits", () => {
  const character = edit(prompt("natsu"));

  it.each([
    "personal assistant",
    "AGENTS.md",
    "MISSING",
    "OpenClaw",
    "Tool Call Style",
    "act now",
    "Before config",
    "Working directory",
    "Docs:",
    "Project Context",
    "visible reply",
    "Current model identity",
    "FlyMac",
    "/Users/x",
    "zai/glm",
  ])("removes %s from a character's prompt", (words) => {
    expect(character).not.toContain(words);
  });

  it("keeps who they are, their memory and our skills", () => {
    for (const words of [
      "## SOUL.md",
      "I speak softly.",
      "## MEMORY.md",
      "Tired.",
      "# Kazusa Character Perspective",
      "Text reaches nobody.",
    ])
      expect(character).toContain(words);
  });

  it("keeps the host's cache markers, which it parses", () => {
    for (const marker of [
      "<!-- openclaw:attempt:STABLE -->",
      "<!-- OPENCLAW-CACHE-BOUNDARY -->",
      "<!-- OPENCLAW-RELOCATABLE-BOUNDARY -->",
    ])
      expect(character).toContain(marker);
  });

  it("leaves the system agent's prompt whole", () => {
    expect(edit(prompt("arona"))).toBe(prompt("arona"));
  });

  it("does not take a similar agent id for the system agent", () => {
    expect(edit(prompt("arona-two"))).not.toContain("act now");
    expect(edit(prompt("arona-two"), "arona-three")).not.toContain("act now");
  });

  it("leaves messages alone: a page with the same headings is not a prompt", () => {
    const page = "## Care\nFeed it daily.\n## Documentation\nSee the manual.\n";
    expect(edit(page)).toBe(page);
    expect(edit(page, "")).toBe(page);
  });

  it("gives the same result on a second pass, as the host applies it twice", () => {
    expect(edit(edit(prompt("natsu")))).toBe(edit(prompt("natsu")));
    expect(edit(edit(prompt("arona")))).toBe(prompt("arona"));
  });

  it("is reusable across prompts", () => {
    expect(edit(prompt("a"))).toBe(edit(prompt("a")));
  });
});
