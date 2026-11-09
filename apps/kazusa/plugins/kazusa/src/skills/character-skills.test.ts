import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { OpenClawConfig } from "openclaw/plugin-sdk/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CONTEXT_ENGINE_CONFIG } from "../context-engine/config.ts";
import {
  characterSkills,
  engineSkills,
  skillRevision,
  type SkillCopy,
} from "./character-skills.ts";

const engine = engineSkills(CONTEXT_ENGINE_CONFIG.parse({}));

async function skill(dir: string, frontmatter: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, "SKILL.md"),
    `---\n${frontmatter}\n---\n\nBody.\n`,
  );
}

const names = (skills: Map<string, SkillCopy[]>) => [...skills.keys()].sort();

describe("characterSkills", () => {
  let cwd: string;
  const workspaceOf = (agentId: string) =>
    path.join(cwd, "workspaces", agentId);

  beforeEach(async () => {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), "kazusa-character-skills-"));
  });

  afterEach(async () => {
    await fs.rm(cwd, { recursive: true, force: true });
  });

  it("lists the shared skills but the engine's own, from every root", async () => {
    await skill(path.join(cwd, "shared/skills/fishing"), "name: fishing");
    await skill(path.join(cwd, "shared/skills/in-person"), "name: in-person");
    await skill(path.join(cwd, "defaults/perception"), "name: perception");
    await skill(path.join(cwd, "defaults/cooking"), "name: cooking");
    const config = {
      skills: {
        load: { extraDirs: ["./shared/skills", "./defaults", "./none"] },
      },
    } as OpenClawConfig;
    expect(
      names(await characterSkills(config, engine, workspaceOf, cwd)),
    ).toEqual(["cooking", "fishing"]);
  });

  it("names a skill as OpenClaw does and finds grouped ones", async () => {
    await skill(path.join(cwd, "skills/crafts/forge"), "name: smithing");
    await skill(path.join(cwd, "skills/plain"), "description: no name");
    await skill(
      path.join(cwd, "skills/hidden"),
      "name: hidden\ndisable-model-invocation: true",
    );
    const config = {
      skills: { load: { extraDirs: ["skills"] } },
    } as OpenClawConfig;
    expect(
      names(await characterSkills(config, engine, workspaceOf, cwd)),
    ).toEqual(["plain", "smithing"]);
  });

  it("knows whose each copy is: the world's or one character's", async () => {
    await skill(path.join(cwd, "shared/skills/fishing"), "name: fishing");
    await skill(
      path.join(cwd, "workspaces/airi/skills/fishing"),
      "name: fishing\ndescription: Airi's way.",
    );
    await skill(
      path.join(cwd, "workspaces/airi/.agents/skills/violin"),
      "name: violin",
    );
    await skill(
      path.join(cwd, "workspaces/airi/skills/in-person"),
      "name: in-person",
    );
    await skill(
      path.join(cwd, "workspaces/arona/skills/repair"),
      "name: repair",
    );
    const config = {
      agents: {
        defaults: {},
        entries: { airi: {}, arona: {} },
      },
      skills: { load: { extraDirs: ["./shared/skills"] } },
    } as OpenClawConfig;
    const skills = await characterSkills(config, engine, workspaceOf, cwd);
    expect(names(skills)).toEqual(["fishing", "repair", "violin"]);
    expect(skills.get("fishing")?.map(({ owner }) => owner)).toEqual([
      "world",
      "airi",
    ]);
    expect(skills.get("violin")?.map(({ owner }) => owner)).toEqual(["airi"]);
  });

  it("has nothing to list without shared roots or characters", async () => {
    expect(names(await characterSkills({}, engine, workspaceOf, cwd))).toEqual(
      [],
    );
  });
});

describe("skillRevision", () => {
  const copy = (file: string, description = "d"): SkillCopy => ({
    owner: "world",
    file,
    description,
  });

  it("changes with where the copies are and what they say, not their order", () => {
    const one = skillRevision("fishing", [copy("/w/a/SKILL.md")], "/w");
    expect(one).toMatch(/^[0-9a-f]{12}$/);
    expect(skillRevision("fishing", [copy("/w/a/SKILL.md")], "/w")).toBe(one);
    expect(
      skillRevision("fishing", [copy("/w/a/SKILL.md", "other")], "/w"),
    ).not.toBe(one);
    const two = [copy("/w/a/SKILL.md"), copy("/w/b/SKILL.md")];
    expect(skillRevision("fishing", two, "/w")).not.toBe(one);
    expect(skillRevision("fishing", [...two].reverse(), "/w")).toBe(
      skillRevision("fishing", two, "/w"),
    );
  });
});
