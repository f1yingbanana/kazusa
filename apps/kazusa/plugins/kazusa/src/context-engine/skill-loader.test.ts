import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearSkillCaches,
  createSkillLoader,
  kazusaSkillsDir,
  parseSkillMarkdown,
  SkillFrontmatterSchema,
} from "./skill-loader.ts";

async function skill(root: string, name: string, body: string): Promise<void> {
  await fs.mkdir(path.join(root, name), { recursive: true });
  await fs.writeFile(
    path.join(root, name, "SKILL.md"),
    `---\nname: ${name}\ndescription: test\n---\n\n${body}\n`,
  );
}

describe("Skill loader", () => {
  let tempDir: string;
  let world: string;
  let defaults: string;
  let airi: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "kazusa-skill-loader-test-"),
    );
    world = path.join(tempDir, "world", "shared", "skills");
    defaults = path.join(tempDir, "kazusa", "shared", "skills");
    airi = path.join(tempDir, "world", "workspaces", "airi");
    await fs.mkdir(world, { recursive: true });
    clearSkillCaches();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("parses YAML frontmatter and extracts markdown body with typed Zod schema", () => {
    const raw = `---
name: test-skill
description: "A multiline
  test skill"
user-invocable: false
command-dispatch: tool
command-tool: test_tool
custom-property: custom-value
---

# Instruction Title
Do something useful.`;
    const doc = parseSkillMarkdown(raw);
    expect(doc.frontmatter).toEqual({
      name: "test-skill",
      description: "A multiline test skill",
      "user-invocable": false,
      "command-dispatch": "tool",
      "command-tool": "test_tool",
      "custom-property": "custom-value",
    });
    expect(doc.body).toBe(`# Instruction Title\nDo something useful.`);
  });

  it("handles malformed frontmatter gracefully by returning null frontmatter", () => {
    const invalidYaml = `---
name: "unterminated string
---
# Body Remains Intact`;
    const doc = parseSkillMarkdown(invalidYaml);
    expect(doc.frontmatter).toBeNull();
    expect(doc.body).toBe("# Body Remains Intact");

    const nonObjectYaml = `---
- item 1
- item 2
---
# Sequence Body`;
    const docNonObject = parseSkillMarkdown(nonObjectYaml);
    expect(docNonObject.frontmatter).toBeNull();
    expect(docNonObject.body).toBe("# Sequence Body");
  });

  it("validates SkillFrontmatterSchema directly with Zod", () => {
    const valid = SkillFrontmatterSchema.safeParse({
      name: "valid-name",
      description: "valid description",
      "user-invocable": true,
      extraField: 123,
    });
    expect(valid.success).toBe(true);

    const invalid = SkillFrontmatterSchema.safeParse("not an object");
    expect(invalid.success).toBe(false);
  });

  it("loads Kazusa's own skills by default", async () => {
    const loader = createSkillLoader({ worldDir: world });
    const doc = await loader.loadSkillDocument("context-conventions");
    expect(doc.frontmatter?.name).toBe("context-conventions");
    expect(doc.frontmatter?.["user-invocable"]).toBe(false);
    expect(doc.body).toContain("# Kazusa Character Perspective");
    expect(await loader.loadSkill("context-conventions")).not.toContain("---");
  });

  it("finds Kazusa's skills beside the plugin it was loaded from", () => {
    expect(kazusaSkillsDir("/repo/apps/kazusa/plugins/kazusa")).toBe(
      path.resolve("/repo/apps/kazusa/shared/skills"),
    );
    expect(kazusaSkillsDir()).toMatch(
      /[\\/]apps[\\/]kazusa[\\/]shared[\\/]skills$/,
    );
  });

  it("looks in the character's, the world's, then Kazusa's skills", async () => {
    const loader = createSkillLoader({
      worldDir: world,
      defaultsDir: defaults,
      workspaceOf: (agentId) => (agentId === "airi" ? airi : undefined),
    });
    expect(loader.getCandidateRoots({ agentId: "airi" })).toEqual([
      path.join(airi, "skills"),
      world,
      defaults,
    ]);
    expect(loader.getCandidateRoots({ agentId: "natsu" })).toEqual([
      world,
      defaults,
    ]);
    expect(loader.getCandidateRoots()).toEqual([world, defaults]);
  });

  it("takes the first place that has the skill", async () => {
    const loader = createSkillLoader({
      worldDir: world,
      defaultsDir: defaults,
      workspaceOf: (agentId) => (agentId === "airi" ? airi : undefined),
    });
    await skill(defaults, "task-lifecycle", "Kazusa's.");
    expect(await loader.loadSkill("task-lifecycle", { agentId: "airi" })).toBe(
      "Kazusa's.",
    );
    await skill(world, "task-lifecycle", "The world's.");
    await skill(path.join(airi, "skills"), "task-lifecycle", "Airi's.");
    clearSkillCaches();
    expect(await loader.loadSkill("task-lifecycle", { agentId: "airi" })).toBe(
      "Airi's.",
    );
    expect(await loader.loadSkill("task-lifecycle", { agentId: "natsu" })).toBe(
      "The world's.",
    );
  });

  it("reads each file once until skill caches clear", async () => {
    const loader = createSkillLoader({
      worldDir: world,
      defaultsDir: defaults,
    });
    await skill(defaults, "perception", "First.");
    expect((await loader.loadSkillDocument("perception")).body).toBe("First.");
    await skill(defaults, "perception", "Second.");
    await skill(world, "perception", "The world's.");
    expect((await loader.loadSkillDocument("perception")).body).toBe("First.");
    clearSkillCaches();
    expect((await loader.loadSkillDocument("perception")).body).toBe(
      "The world's.",
    );
  });

  it("names the places it looked when no place has the skill", async () => {
    const loader = createSkillLoader({
      worldDir: world,
      defaultsDir: defaults,
    });
    await expect(loader.loadSkill("missing")).rejects.toThrow(
      `is in none of:\n  ${world}\n  ${defaults}`,
    );
  });
});
