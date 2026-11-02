import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { OpenClawConfig } from "openclaw/plugin-sdk/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CONTEXT_ENGINE_CONFIG } from "../context-engine/config.ts";
import { characterSkills, engineSkills } from "./character-skills.ts";

const engine = engineSkills(CONTEXT_ENGINE_CONFIG.parse({}));

async function skill(dir: string, frontmatter: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, "SKILL.md"),
    `---\n${frontmatter}\n---\n\nBody.\n`,
  );
}

describe("characterSkills", () => {
  let cwd: string;

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
    expect(await characterSkills(config, engine, cwd)).toEqual([
      "cooking",
      "fishing",
    ]);
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
    expect(await characterSkills(config, engine, cwd)).toEqual([
      "plain",
      "smithing",
    ]);
  });

  it("has nothing to list without shared roots", async () => {
    expect(await characterSkills({}, engine, cwd)).toEqual([]);
  });
});
