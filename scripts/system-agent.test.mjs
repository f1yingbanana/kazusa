import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SYSTEM_AGENT_INCLUDE, syncSystemAgent } from "./system-agent.mjs";

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
