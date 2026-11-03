import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { clearSkillCaches } from "./context-engine/skill-loader.ts";
import {
  bundledSkillText,
  createSkillText,
  describeTool,
  skillSections,
} from "./skill-text.ts";

function roots(files: Record<string, string>): string[] {
  const base = mkdtempSync(path.join(os.tmpdir(), "skill-text-"));
  const dirs = new Set<string>();
  for (const [file, body] of Object.entries(files)) {
    const full = path.join(base, file);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, body);
    dirs.add(path.join(base, file.split("/")[0]));
  }
  return [...dirs];
}

describe("skill text", () => {
  it("reads `## name` sections, ignoring what comes before the first", () => {
    expect([
      ...skillSections("Intro.\n\n## one\n\nFirst.\n\n## two\nSecond\nline.\n"),
    ]).toEqual([
      ["one", "First."],
      ["two", "Second\nline."],
    ]);
  });

  it("takes each section from the first skill that has it", () => {
    // A world or character overrides one line without copying the rest.
    const [world, bundled] = roots({
      "world/kazusa-results/SKILL.md":
        "---\nname: kazusa-results\n---\n## already-said\nYou said that.\n",
      "bundled/kazusa-results/SKILL.md":
        "## already-said\nYou already said that.\n\n## lookup-limit\nThat's all.\n",
    });
    const text = createSkillText({ getCandidateRoots: () => [world, bundled] });
    expect(text("kazusa-results#already-said")).toBe("You said that.");
    expect(text("kazusa-results#lookup-limit")).toBe("That's all.");
    expect(text.maybe("kazusa-results#nothing")).toBeUndefined();
    expect(() => text("kazusa-results#nothing")).toThrow("nothing");
  });

  it("fills placeholders and leaves unknown ones", () => {
    const [dir] = roots({
      "skills/kazusa-deliveries/SKILL.md":
        "## check-in\nYour {type} ended at {time}. {note}\n",
    });
    const text = createSkillText({ getCandidateRoots: () => [dir] });
    expect(
      text("kazusa-deliveries#check-in", { type: "study", note: "" }),
    ).toBe("Your study ended at {time}.");
  });

  it("reads an edited skill again after refresh_skills", () => {
    const [dir] = roots({ "skills/kazusa-results/SKILL.md": "## a\nOld.\n" });
    const text = createSkillText({ getCandidateRoots: () => [dir] });
    expect(text("kazusa-results#a")).toBe("Old.");
    writeFileSync(path.join(dir, "kazusa-results/SKILL.md"), "## a\nNew.\n");
    expect(text("kazusa-results#a")).toBe("Old.");
    clearSkillCaches();
    expect(text("kazusa-results#a")).toBe("New.");
  });

  it("words a tool and its fields, with what code gave a field as {data}", () => {
    const [dir] = roots({
      "skills/kazusa-tools/SKILL.md": [
        "## start_task\nStart something, {minDuration} min at least.",
        "## start_task.where\nWhere. Trips: {data}.",
        "## start_task.list.kind\nWhich kind.",
      ].join("\n\n"),
    });
    const text = createSkillText({ getCandidateRoots: () => [dir] });
    const tool = describeTool(
      text,
      {
        name: "start_task",
        parameters: {
          type: "object",
          properties: {
            where: { type: "string", description: "`traveling`" },
            stray: { type: "string", description: "Left over in code." },
            list: {
              type: "array",
              items: {
                anyOf: [
                  { type: "string" },
                  {
                    type: "object",
                    properties: { kind: { type: "string" } },
                  },
                ],
              },
            },
          },
        },
      },
      { minDuration: 10 },
    );
    expect(tool.description).toBe("Start something, 10 min at least.");
    expect(tool.parameters).toEqual({
      type: "object",
      properties: {
        where: { type: "string", description: "Where. Trips: `traveling`." },
        stray: { type: "string" },
        list: {
          type: "array",
          items: {
            anyOf: [
              { type: "string" },
              {
                type: "object",
                properties: {
                  kind: { type: "string", description: "Which kind." },
                },
              },
            ],
          },
        },
      },
    });
  });

  it("has every section Kazusa's own code asks for", () => {
    const text = bundledSkillText();
    for (const ref of [
      "kazusa-results#already-said",
      "kazusa-results#lookup-limit",
      "kazusa-results#second-activity",
      "kazusa-results#out-of-time",
      "kazusa-results#hard-limit",
      "kazusa-results#aloud-on-the-way",
      "kazusa-results#aloud-not-here",
      "kazusa-results#aloud-not-there",
      "kazusa-deliveries#before-replying",
      "kazusa-deliveries#check-in",
      "kazusa-deliveries#idle-check-in",
      ...[
        "start_task",
        "delay_task",
        "send_message",
        "list_chats",
        "manage_chat",
        "recall",
        "look_up",
        "remember",
      ].map((tool) => `kazusa-tools#${tool}`),
    ])
      expect({ ref, text: text.maybe(ref) }).toEqual({
        ref,
        text: expect.any(String),
      });
  });
});
