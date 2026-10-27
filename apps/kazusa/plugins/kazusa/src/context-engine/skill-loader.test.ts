import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createSkillLoader,
  expandUserPath,
  isDefaultStateDir,
  normalizeSkillName,
  parseSkillMarkdown,
  resolveOpenClawBundledSkillsDir,
  resolveStateDir,
  resolveUserPath,
  SkillFrontmatterSchema,
  stripFrontmatter,
} from "./skill-loader.ts";

describe("Skill loader", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "kazusa-skill-loader-test-"),
    );
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("expands user home path and resolves relative paths", () => {
    const home = os.homedir();
    expect(expandUserPath("~/skills")).toBe(path.join(home, "skills"));
    expect(expandUserPath("./relative")).toBe("./relative");
    expect(resolveUserPath("./skills", tempDir)).toBe(
      path.join(tempDir, "skills"),
    );
  });

  it("detects default state directory and custom OPENCLAW_STATE_DIR", () => {
    const home = os.homedir();
    expect(isDefaultStateDir({})).toBe(true);
    expect(isDefaultStateDir({ OPENCLAW_STATE_DIR: "" })).toBe(true);
    expect(
      isDefaultStateDir({ OPENCLAW_STATE_DIR: path.join(home, ".openclaw") }),
    ).toBe(true);

    const customState = path.join(tempDir, "custom-state");
    expect(isDefaultStateDir({ OPENCLAW_STATE_DIR: customState })).toBe(false);
    expect(resolveStateDir({ OPENCLAW_STATE_DIR: customState })).toBe(
      customState,
    );
    expect(resolveStateDir({})).toBe(path.join(home, ".openclaw"));
  });

  it("normalizes skill names leniently", () => {
    expect(normalizeSkillName("Context_Conventions")).toBe(
      "context-conventions",
    );
    expect(normalizeSkillName("  task-lifecycle  ")).toBe("task-lifecycle");
    expect(normalizeSkillName("skill_name_with_underscores")).toBe(
      "skill-name-with-underscores",
    );
  });

  it("resolves bundled openclaw skills directory via OPENCLAW_BUNDLED_SKILLS_DIR", async () => {
    const mockBundled = path.join(tempDir, "mock-bundled-skills");
    await fs.mkdir(mockBundled, { recursive: true });
    const resolved = resolveOpenClawBundledSkillsDir(process.cwd(), {
      OPENCLAW_BUNDLED_SKILLS_DIR: mockBundled,
    });
    expect(resolved).toBe(mockBundled);
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
    expect(stripFrontmatter(raw)).toBe(
      `# Instruction Title\nDo something useful.`,
    );
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

  it("loads structured skill document with loadSkillDocument", async () => {
    const loader = createSkillLoader();
    const doc = await loader.loadSkillDocument("context-conventions");
    expect(doc.frontmatter?.name).toBe("context-conventions");
    expect(doc.frontmatter?.["user-invocable"]).toBe(false);
    expect(doc.body).toContain("# Kazusa Character Perspective");
  });

  it("resolves built-in packaged fallback skills", async () => {
    const loader = createSkillLoader();
    const content = await loader.loadSkill("context-conventions");
    expect(content).toContain("Character Perspective");
    expect(content).not.toContain("---");
  });

  it("orders candidate roots exactly according to OpenClaw 1:1 precedence hierarchy", () => {
    const fakeHome = path.join(tempDir, "home");
    const workspaceDir = path.join(tempDir, "workspace");
    const customExtra = path.join(tempDir, "extra");
    const pluginDir = path.join(tempDir, "plugin");

    const env: NodeJS.ProcessEnv = {
      HOME: fakeHome,
    };

    const loader = createSkillLoader({
      workspaceDir,
      agentId: "agent-alpha",
      pluginRootDir: pluginDir,
      config: {
        skills: {
          load: {
            extraDirs: [customExtra],
          },
        },
      },
      env,
    });

    const roots = loader.getCandidateRoots();

    // Priority 1: Workspace skills
    expect(roots[0]).toBe(path.join(workspaceDir, "skills"));
    // Priority 2: Project agent skills
    expect(roots[1]).toBe(path.join(workspaceDir, ".agents", "skills"));
    // Priority 3: Personal agent skills (default state dir)
    expect(roots[2]).toBe(path.join(fakeHome, ".agents", "skills"));
    // Priority 4: Managed / local skills (<state-dir>/skills)
    expect(roots[3]).toBe(path.join(fakeHome, ".openclaw", "skills"));
    // Priority 5: Workshop skills (<state-dir>/agents/<agentId>/agent/workshop-skills)
    expect(roots[4]).toBe(
      path.join(
        fakeHome,
        ".openclaw",
        "agents",
        "agent-alpha",
        "agent",
        "workshop-skills",
      ),
    );
    // Priority 6: Bundled skills (Kazusa shared/skills + OpenClaw bundled)
    expect(roots[5]).toContain(path.join("shared", "skills"));
    // Priority 7 (lowest): Extra directories & Plugin skills
    const extraIndex = roots.indexOf(customExtra);
    const pluginIndex = roots.indexOf(path.join(pluginDir, "skills"));
    expect(extraIndex).toBeGreaterThan(5);
    expect(pluginIndex).toBeGreaterThan(5);
  });

  it("excludes personal ~/.agents/skills when OPENCLAW_STATE_DIR is non-default", () => {
    const fakeHome = path.join(tempDir, "home");
    const customState = path.join(tempDir, "custom-openclaw-state");
    const workspaceDir = path.join(tempDir, "workspace");

    const env: NodeJS.ProcessEnv = {
      HOME: fakeHome,
      OPENCLAW_STATE_DIR: customState,
    };

    const loader = createSkillLoader({
      workspaceDir,
      agentId: "agent-beta",
      env,
    });

    const roots = loader.getCandidateRoots();

    // Must NOT contain fakeHome/.agents/skills
    expect(roots).not.toContain(path.join(fakeHome, ".agents", "skills"));
    // Must contain custom state managed skills
    expect(roots).toContain(path.join(customState, "skills"));
    // Must contain custom state workshop skills for agent-beta
    expect(roots).toContain(
      path.join(
        customState,
        "agents",
        "agent-beta",
        "agent",
        "workshop-skills",
      ),
    );
  });

  it("respects OpenClaw precedence: workspace skills override extraDirs and fallbacks", async () => {
    const workspaceDir = path.join(tempDir, "workspace");
    const workspaceSkillDir = path.join(
      workspaceDir,
      "skills",
      "context-conventions",
    );
    await fs.mkdir(workspaceSkillDir, { recursive: true });
    await fs.writeFile(
      path.join(workspaceSkillDir, "SKILL.md"),
      `---\nname: context-conventions\n---\n# Workspace Custom Conventions\nOverridden!`,
      "utf8",
    );

    const extraSkillsDir = path.join(tempDir, "extra-skills");
    const extraSkillDir = path.join(extraSkillsDir, "context-conventions");
    await fs.mkdir(extraSkillDir, { recursive: true });
    await fs.writeFile(
      path.join(extraSkillDir, "SKILL.md"),
      `---\nname: context-conventions\n---\n# Extra Custom Conventions`,
      "utf8",
    );

    const loader = createSkillLoader({
      config: {
        skills: {
          load: {
            extraDirs: [extraSkillsDir],
          },
        },
      },
      workspaceDir,
    });

    const content = await loader.loadSkill("context-conventions");
    expect(content).toContain("Workspace Custom Conventions");
    expect(content).not.toContain("Extra Custom Conventions");
    expect(content).not.toContain("Context Engine Conventions");
  });

  it("verifies bundled skills (Priority 6) override extraDirs (Priority 7)", async () => {
    // When a skill exists in bundled skills (e.g. context-conventions) AND in extraDirs,
    // OpenClaw precedence dictates bundled > extraDirs.
    const extraSkillsDir = path.join(tempDir, "extra-skills");
    const collidingDir = path.join(extraSkillsDir, "context-conventions");
    await fs.mkdir(collidingDir, { recursive: true });
    await fs.writeFile(
      path.join(collidingDir, "SKILL.md"),
      `---\nname: context-conventions\n---\n# Colliding Extra Convention`,
      "utf8",
    );

    const loader = createSkillLoader({
      config: {
        skills: {
          load: {
            extraDirs: [extraSkillsDir],
          },
        },
      },
    });

    const content = await loader.loadSkill("context-conventions");
    // Bundled skill must win over extraDirs
    expect(content).toContain("Kazusa Character Perspective");
    expect(content).not.toContain("Colliding Extra Convention");
  });

  it("respects extraDirs from config when skill does not collide with higher tiers", async () => {
    const extraSkillsDir = path.join(tempDir, "extra-skills");
    const extraSkillDir = path.join(extraSkillsDir, "custom-extra");
    await fs.mkdir(extraSkillDir, { recursive: true });
    await fs.writeFile(
      path.join(extraSkillDir, "SKILL.md"),
      `---\nname: custom-extra\n---\n# Extra Skill Body`,
      "utf8",
    );

    const loader = createSkillLoader({
      config: {
        skills: {
          load: {
            extraDirs: [extraSkillsDir],
          },
        },
      },
    });

    const content = await loader.loadSkill("custom-extra");
    expect(content).toBe("# Extra Skill Body");
  });

  it("resolves plugin skills declared in openclaw.plugin.json", async () => {
    const pluginDir = path.join(tempDir, "plugin");
    const customSkillsDir = path.join(pluginDir, "sub-skills", "plugin-tool");
    await fs.mkdir(customSkillsDir, { recursive: true });
    await fs.writeFile(
      path.join(customSkillsDir, "SKILL.md"),
      `---\nname: plugin-tool\n---\n# Plugin Tool Skill`,
      "utf8",
    );
    await fs.writeFile(
      path.join(pluginDir, "openclaw.plugin.json"),
      JSON.stringify({ skills: ["sub-skills"] }),
      "utf8",
    );

    const loader = createSkillLoader({
      pluginRootDir: pluginDir,
    });

    const content = await loader.loadSkill("plugin-tool");
    expect(content).toBe("# Plugin Tool Skill");
  });

  it("resolves deeply grouped layouts up to 6 levels deep", async () => {
    const extraSkillsDir = path.join(tempDir, "extra-skills");
    // 4 levels deep: cat1 / cat2 / cat3 / deep-skill
    const deepDir = path.join(
      extraSkillsDir,
      "cat1",
      "cat2",
      "cat3",
      "deep-skill",
    );
    await fs.mkdir(deepDir, { recursive: true });
    await fs.writeFile(
      path.join(deepDir, "SKILL.md"),
      `---\nname: deep-skill\n---\n# Deeply Grouped Skill Body`,
      "utf8",
    );

    const loader = createSkillLoader({
      config: {
        skills: {
          load: {
            extraDirs: [extraSkillsDir],
          },
        },
      },
    });

    const content = await loader.loadSkill("deep-skill");
    expect(content).toBe("# Deeply Grouped Skill Body");
  });

  it("resolves skill when directory name differs but frontmatter name matches", async () => {
    const extraSkillsDir = path.join(tempDir, "extra-skills");
    // Folder is arbitrary-folder-name, but frontmatter name is custom-named-skill
    const skillDir = path.join(extraSkillsDir, "arbitrary-folder-name");
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(
      path.join(skillDir, "SKILL.md"),
      `---\nname: custom-named-skill\n---\n# Body of Custom Named Skill`,
      "utf8",
    );

    const loader = createSkillLoader({
      config: {
        skills: {
          load: {
            extraDirs: [extraSkillsDir],
          },
        },
      },
    });

    const content = await loader.loadSkill("custom-named-skill");
    expect(content).toBe("# Body of Custom Named Skill");
  });

  it("stops grouped traversal below a directory that already contains SKILL.md", async () => {
    const extraSkillsDir = path.join(tempDir, "extra-skills");
    const parentSkillDir = path.join(extraSkillsDir, "parent-skill");
    const nestedUnderParentDir = path.join(parentSkillDir, "nested-shadowed");

    await fs.mkdir(nestedUnderParentDir, { recursive: true });
    // Parent contains SKILL.md
    await fs.writeFile(
      path.join(parentSkillDir, "SKILL.md"),
      `---\nname: parent-skill\n---\n# Parent`,
      "utf8",
    );
    // Nested under parent contains SKILL.md
    await fs.writeFile(
      path.join(nestedUnderParentDir, "SKILL.md"),
      `---\nname: nested-shadowed\n---\n# Nested Should Not Be Found`,
      "utf8",
    );

    const loader = createSkillLoader({
      config: {
        skills: {
          load: {
            extraDirs: [extraSkillsDir],
          },
        },
      },
    });

    // Parent is found
    expect(await loader.loadSkill("parent-skill")).toBe("# Parent");
    // Nested below parent is NOT traversed per OpenClaw spec
    await expect(loader.loadSkill("nested-shadowed")).rejects.toThrow();
  });

  it("includes execution workspace skills following the agent catalog", () => {
    const workspaceDir = path.join(tempDir, "workspace");
    const execWorkspaceDir = path.join(tempDir, "exec-workspace");

    const loader = createSkillLoader({
      workspaceDir,
      executionWorkspaceDir: execWorkspaceDir,
    });

    const roots = loader.getCandidateRoots();
    const agentSkillsIndex = roots.indexOf(path.join(workspaceDir, "skills"));
    const execSkillsIndex = roots.indexOf(
      path.join(execWorkspaceDir, "skills"),
    );
    const execAgentSkillsIndex = roots.indexOf(
      path.join(execWorkspaceDir, ".agents", "skills"),
    );

    expect(agentSkillsIndex).toBe(0);
    expect(execSkillsIndex).toBeGreaterThan(agentSkillsIndex);
    // Within execution workspace, skills/ wins over .agents/skills/
    expect(execSkillsIndex).toBeLessThan(execAgentSkillsIndex);
  });

  it("caches loaded skills and clears cache on clearCache()", async () => {
    const extraSkillsDir = path.join(tempDir, "extra-skills");
    const skillDir = path.join(extraSkillsDir, "cached-skill");
    await fs.mkdir(skillDir, { recursive: true });
    const skillFile = path.join(skillDir, "SKILL.md");
    await fs.writeFile(
      skillFile,
      `---\nname: cached-skill\n---\n# Version 1`,
      "utf8",
    );

    const loader = createSkillLoader({
      config: {
        skills: {
          load: {
            extraDirs: [extraSkillsDir],
          },
        },
      },
    });

    expect(await loader.loadSkill("cached-skill")).toBe("# Version 1");

    // Overwrite on disk
    await fs.writeFile(
      skillFile,
      `---\nname: cached-skill\n---\n# Version 2`,
      "utf8",
    );

    // Still returns cached content
    expect(await loader.loadSkill("cached-skill")).toBe("# Version 1");

    // After clearing cache, loads new version
    loader.clearCache();
    expect(await loader.loadSkill("cached-skill")).toBe("# Version 2");
  });

  it("throws clear error when skill cannot be found in any candidate root", async () => {
    const loader = createSkillLoader({
      fallbackDirs: [tempDir],
    });

    await expect(loader.loadSkill("non-existent-skill")).rejects.toThrow(
      /Kazusa skill "non-existent-skill" could not be resolved from candidate roots/u,
    );
  });
});
