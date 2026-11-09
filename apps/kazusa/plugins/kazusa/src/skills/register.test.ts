import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  OpenClawConfig,
  OpenClawPluginApi,
} from "openclaw/plugin-sdk/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSkillLoader } from "../context-engine/skill-loader.ts";
import { describeSync, registerSkills, type SkillSync } from "./register.ts";

interface Tool {
  readonly name: string;
  readonly execute: () => Promise<{
    content: { text: string }[];
    details: SkillSync;
  }>;
}

async function skill(
  root: string,
  name: string,
  body = "Body.",
  description = name,
): Promise<void> {
  await fs.mkdir(path.join(root, name), { recursive: true });
  await fs.writeFile(
    path.join(root, name, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`,
  );
}

describe("refresh_skills", () => {
  let root: string;
  let worldDir: string;
  let workspaces: string;

  function setup() {
    let config = {
      agents: {
        defaults: {},
        entries: { "airi-kurimura": {}, "natsu-yutori": {}, arona: {} },
      },
      skills: { load: { extraDirs: [worldDir] } },
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
      logger: { warn: vi.fn(), info: vi.fn() },
      registerTool: (tool: Tool) => tools.push(tool),
      on: (name: string, hook: () => Promise<void>) => {
        hooks[name] = hook;
      },
      runtime: {
        config: { current: () => config, mutateConfigFile },
        agent: {
          resolveAgentWorkspaceDir: (_config: unknown, agentId: string) =>
            path.join(workspaces, agentId),
        },
      },
    } as unknown as OpenClawPluginApi;
    registerSkills(api, { watch: false });
    const tool = tools.find((t) => t.name === "refresh_skills");
    if (!tool) throw new Error("refresh_skills was not registered");
    const refresh = async () => (await tool.execute()).details;
    return { refresh, tool, hooks, mutateConfigFile, config: () => config };
  }

  const entries = (config: OpenClawConfig) => config.skills?.entries ?? {};
  const revision = (config: OpenClawConfig, name: string) =>
    entries(config)[name]?.config?.kazusaRevision;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "kazusa-refresh-skills-"));
    worldDir = path.join(root, "shared", "skills");
    workspaces = path.join(root, "workspaces");
    await skill(worldDir, "context-conventions");
    await skill(worldDir, "fishing");
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("hides Kazusa's own skills and gives each skill characters read a revision", async () => {
    const world = setup();
    const result = await world.refresh();
    expect(result).toEqual({
      shared: ["fishing"],
      own: {},
      changed: ["fishing"],
    });
    expect(entries(world.config())["context-conventions"]).toEqual({
      enabled: false,
    });
    expect(entries(world.config())["kazusa-results"]).toEqual({
      enabled: false,
    });
    expect(revision(world.config(), "fishing")).toMatch(/^[0-9a-f]{12}$/);
  });

  it("leaves the config alone when nothing changed", async () => {
    const world = setup();
    await world.refresh();
    world.mutateConfigFile.mockClear();
    expect((await world.refresh()).changed).toEqual([]);
    expect(world.mutateConfigFile).not.toHaveBeenCalled();
  });

  it("gives a character's own skill, and their own copy of a world skill, a new revision", async () => {
    const world = setup();
    await world.refresh();
    const before = revision(world.config(), "fishing");
    await skill(path.join(workspaces, "airi-kurimura", "skills"), "violin");
    await skill(
      path.join(workspaces, "natsu-yutori", ".agents", "skills"),
      "fishing",
      "Natsu's way.",
    );
    const result = await world.refresh();
    expect(result.changed).toEqual(["fishing", "violin"]);
    expect(result.own).toEqual({
      "airi-kurimura": ["violin"],
      "natsu-yutori": ["fishing"],
    });
    expect(revision(world.config(), "fishing")).not.toBe(before);
    expect(revision(world.config(), "violin")).toMatch(/^[0-9a-f]{12}$/);
  });

  it("needs no new revision for a body edit, and one for a new description", async () => {
    const world = setup();
    await world.refresh();
    await skill(worldDir, "fishing", "New body.");
    expect((await world.refresh()).changed).toEqual([]);
    await skill(worldDir, "fishing", "New body.", "When to fish.");
    expect((await world.refresh()).changed).toEqual(["fishing"]);
  });

  it("takes a removed skill's revision away, and its entry with nothing else in it", async () => {
    const world = setup();
    await world.refresh();
    await fs.rm(path.join(worldDir, "fishing"), {
      recursive: true,
    });
    expect((await world.refresh()).changed).toEqual(["fishing"]);
    expect(entries(world.config()).fishing).toBeUndefined();
  });

  it("treats the system agent's own skills as any character's", async () => {
    await skill(path.join(workspaces, "arona", "skills"), "repair");
    const result = await setup().refresh();
    expect(result.own).toEqual({ arona: ["repair"] });
    expect(result.shared).toEqual(["fishing"]);
  });

  it("refreshes on start, for skills that changed while stopped", async () => {
    const world = setup();
    await world.hooks.gateway_start();
    expect(revision(world.config(), "fishing")).toBeDefined();
  });

  it("makes every loader read an edited skill again", async () => {
    await skill(root, "kazusa-test-cached");
    const loader = createSkillLoader({ worldDir: root, defaultsDir: root });
    expect(await loader.loadSkill("kazusa-test-cached")).toBe("Body.");
    await skill(root, "kazusa-test-cached", "Edited.");
    expect(await loader.loadSkill("kazusa-test-cached")).toBe("Body.");
    await setup().tool.execute();
    expect(await loader.loadSkill("kazusa-test-cached")).toBe("Edited.");
  });
});

describe("describeSync", () => {
  it("says what everyone and each character can read, and what changed", () => {
    expect(
      describeSync({
        shared: ["fishing"],
        own: { "airi-kurimura": ["violin"] },
        changed: ["violin"],
      }),
    ).toMatch(
      /^Every character can read: fishing\. airi-kurimura's own: violin\. Changed since the last refresh: violin\./,
    );
    expect(describeSync({ shared: [], own: {}, changed: [] })).toMatch(
      /^No skills every character can read\. Nothing changed since the last refresh\./,
    );
  });
});
