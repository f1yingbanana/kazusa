import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  OpenClawConfig,
  OpenClawPluginApi,
} from "openclaw/plugin-sdk/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSkillLoader } from "../context-engine/skill-loader.ts";
import { describeSync, registerSkills } from "./register.ts";

interface Tool {
  readonly name: string;
  readonly execute: () => Promise<{
    content: { text: string }[];
    details: unknown;
  }>;
}

function setup(root: string, listed?: string[]) {
  let config = {
    agents: {
      defaults: {
        ...(listed ? { skills: listed } : {}),
      },
    },
    skills: { load: { extraDirs: [root] } },
  } as OpenClawConfig;
  const tools: Tool[] = [];
  const hooks: Record<string, () => Promise<void>> = {};
  const mutateConfigFile = vi.fn(
    async (params: { mutate: (draft: OpenClawConfig) => void }) => {
      const draft = structuredClone(config);
      params.mutate(draft);
      config = draft;
    },
  );
  const api = {
    pluginConfig: {},
    logger: { warn: vi.fn() },
    registerTool: (tool: Tool) => tools.push(tool),
    on: (name: string, hook: () => Promise<void>) => {
      hooks[name] = hook;
    },
    runtime: {
      config: { current: () => config, mutateConfigFile },
    },
  } as unknown as OpenClawPluginApi;
  registerSkills(api, { watch: false });
  const tool = tools.find((t) => t.name === "refresh_skills");
  if (!tool) throw new Error("refresh_skills was not registered");
  return { tool, hooks, mutateConfigFile, config: () => config };
}

async function skill(
  root: string,
  name: string,
  body = "Body.",
): Promise<void> {
  await fs.mkdir(path.join(root, name), { recursive: true });
  await fs.writeFile(
    path.join(root, name, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${name}\n---\n\n${body}\n`,
  );
}

describe("refresh_skills", () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "kazusa-refresh-skills-"));
    await skill(root, "context-conventions");
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("lists a new shared skill for characters", async () => {
    const world = setup(root, []);
    await skill(root, "fishing");
    const result = await world.tool.execute();
    expect(result.details).toEqual({
      skills: ["fishing"],
      added: ["fishing"],
      removed: [],
    });
    expect(world.config().agents?.defaults?.skills).toEqual(["fishing"]);
  });

  it("leaves the config alone when nothing came or went", async () => {
    await skill(root, "fishing");
    const world = setup(root, ["fishing"]);
    await world.tool.execute();
    expect(world.mutateConfigFile).not.toHaveBeenCalled();
  });

  it("drops a removed skill", async () => {
    const world = setup(root, ["fishing"]);
    expect((await world.tool.execute()).details).toEqual({
      skills: [],
      added: [],
      removed: ["fishing"],
    });
    expect(world.config().agents?.defaults?.skills).toEqual([]);
  });

  it("restricts an unlisted world to its shared skills on start", async () => {
    const world = setup(root);
    await world.hooks.gateway_start();
    expect(world.config().agents?.defaults?.skills).toEqual([]);
  });

  it("makes every loader read an edited skill again", async () => {
    await skill(root, "kazusa-test-cached");
    const loader = createSkillLoader({ worldDir: root, defaultsDir: root });
    expect(await loader.loadSkill("kazusa-test-cached")).toBe("Body.");
    await skill(root, "kazusa-test-cached", "Edited.");
    expect(await loader.loadSkill("kazusa-test-cached")).toBe("Body.");
    await setup(root, []).tool.execute();
    expect(await loader.loadSkill("kazusa-test-cached")).toBe("Edited.");
  });
});

describe("describeSync", () => {
  it("says what characters can read and what changed", () => {
    expect(
      describeSync({
        skills: ["fishing"],
        added: ["fishing"],
        removed: [],
      }),
    ).toMatch(
      /^Characters can read: fishing\. Since the last refresh: added fishing\./,
    );
    expect(describeSync({ skills: [], added: [], removed: [] })).toMatch(
      /^Characters have no skills to read\. None added or removed\./,
    );
  });
});
