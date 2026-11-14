import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  SYSTEM_AGENT_INCLUDE,
  syncSystemAgent,
  syncSystemAgentSkills,
} from "./system-agent.mjs";

const SYSTEM_AGENT = {
  tools: { allow: ["kazusa", "read"] },
  skills: ["world-update"],
};

function repo(entry) {
  const root = mkdtempSync(path.join(tmpdir(), "kazusa-system-agent-"));
  const app = path.join(root, "apps/kazusa");
  mkdirSync(app, { recursive: true });
  writeFileSync(
    path.join(app, "base.json"),
    JSON.stringify({ systemAgent: SYSTEM_AGENT, config: {} }),
  );
  if (entry) {
    mkdirSync(path.join(app, "world"));
    writeFileSync(
      path.join(app, "world/openclaw.json"),
      JSON.stringify({
        agents: {
          defaults: { systemAgent: { agentId: "admin" } },
          entries: { admin: entry, ann: { workspace: "./workspaces/ann" } },
        },
      }),
    );
  }
  return { root, world: path.join(app, "world") };
}
const read = (file) => JSON.parse(readFileSync(file, "utf8"));

describe("syncSystemAgent", () => {
  it("rewrites the included file, leaving the world's config and overrides alone", () => {
    const entry = {
      $include: SYSTEM_AGENT_INCLUDE,
      workspace: "./workspaces/admin",
      skills: ["kazusa"],
    };
    const { root, world } = repo(entry);
    const before = readFileSync(path.join(world, "openclaw.json"), "utf8");
    syncSystemAgent(root);
    expect(readFileSync(path.join(world, "openclaw.json"), "utf8")).toBe(
      before,
    );
    expect(read(path.join(world, SYSTEM_AGENT_INCLUDE))).toEqual(SYSTEM_AGENT);
  });

  it("does nothing before setup has made a world", () => {
    const { root, world } = repo();
    syncSystemAgent(root);
    expect(existsSync(world)).toBe(false);
  });
});

describe("syncSystemAgentSkills", () => {
  /** A set-up world whose system agent has a workspace, and Kazusa's guides. */
  function world() {
    const made = repo({ workspace: "./workspaces/admin" });
    const guide = path.join(made.root, ".agents/skills/world-building");
    mkdirSync(guide, { recursive: true });
    writeFileSync(path.join(guide, "SKILL.md"), "v2\n");
    const agents = path.join(made.world, "workspaces/admin/.agents");
    mkdirSync(path.dirname(agents), { recursive: true });
    return { ...made, agents };
  }
  const skill = (agents) =>
    readFileSync(path.join(agents, "skills/world-building/SKILL.md"), "utf8");

  it("copies Kazusa's guides into her workspace", () => {
    const { root, agents } = world();
    expect(syncSystemAgentSkills(root)).toBe(agents);
    expect(lstatSync(agents).isDirectory()).toBe(true);
    expect(skill(agents)).toBe("v2\n");
  });

  it("replaces the last copy whole, so a guide Kazusa dropped goes", () => {
    const { root, agents } = world();
    const dropped = path.join(agents, "skills/dropped");
    mkdirSync(dropped, { recursive: true });
    writeFileSync(path.join(dropped, "SKILL.md"), "old\n");
    syncSystemAgentSkills(root);
    expect(existsSync(dropped)).toBe(false);
    expect(skill(agents)).toBe("v2\n");
  });

  it("swaps an older Kazusa's link for a copy, leaving what it pointed at", () => {
    const { root, agents } = world();
    const elsewhere = path.join(root, "elsewhere");
    mkdirSync(elsewhere);
    writeFileSync(path.join(elsewhere, "keep.md"), "mine\n");
    symlinkSync(elsewhere, agents, "junction");
    syncSystemAgentSkills(root);
    expect(lstatSync(agents).isSymbolicLink()).toBe(false);
    expect(skill(agents)).toBe("v2\n");
    expect(readFileSync(path.join(elsewhere, "keep.md"), "utf8")).toBe(
      "mine\n",
    );
  });

  it("replaces a link left pointing at where Kazusa was before it moved", () => {
    const { root, agents } = world();
    const moved = path.join(root, "moved");
    mkdirSync(moved);
    symlinkSync(moved, agents, "junction");
    rmSync(moved, { recursive: true });
    expect(existsSync(agents)).toBe(false);
    syncSystemAgentSkills(root);
    expect(skill(agents)).toBe("v2\n");
  });

  it("leaves no spares behind", () => {
    const { root, agents } = world();
    syncSystemAgentSkills(root);
    syncSystemAgentSkills(root);
    expect(readdirSync(path.dirname(agents))).toEqual([".agents"]);
  });

  // An unreadable guide fails the copy; root and Windows read it anyway.
  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "keeps the last copy when a new one can't be made",
    () => {
      const { root, agents } = world();
      syncSystemAgentSkills(root);
      chmodSync(
        path.join(root, ".agents/skills/world-building/SKILL.md"),
        0o000,
      );
      expect(() => syncSystemAgentSkills(root)).toThrow();
      expect(skill(agents)).toBe("v2\n");
      expect(readdirSync(path.dirname(agents))).toEqual([".agents"]);
    },
  );

  it("refuses a workspace that is Kazusa itself, keeping its guides", () => {
    const { root, world: dir } = world();
    const configFile = path.join(dir, "openclaw.json");
    const config = JSON.parse(readFileSync(configFile, "utf8"));
    config.agents.entries.admin.workspace = path.relative(dir, root);
    writeFileSync(configFile, JSON.stringify(config));
    expect(() => syncSystemAgentSkills(root)).toThrow(/overlaps/);
    expect(skill(path.join(root, ".agents"))).toBe("v2\n");
  });

  it("does nothing before setup has made a world", () => {
    const { root, world: dir } = repo();
    mkdirSync(path.join(root, ".agents/skills"), { recursive: true });
    expect(syncSystemAgentSkills(root)).toBeUndefined();
    expect(existsSync(dir)).toBe(false);
  });
});
