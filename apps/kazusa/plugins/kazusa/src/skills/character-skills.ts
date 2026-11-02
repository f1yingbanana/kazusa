import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { OpenClawConfig } from "openclaw/plugin-sdk/core";
import type { ContextEngineConfig } from "../context-engine/config.ts";
import {
  MAX_GROUPED_SKILL_SCAN_DEPTH,
  parseSkillMarkdown,
  resolveUserPath,
} from "../context-engine/skill-loader.ts";

/**
 * Skills the plugin reads and injects itself. They are how the world works,
 * delivered when they apply, so a character never looks one up.
 */
export function engineSkills(
  contextEngine: ContextEngineConfig,
): ReadonlySet<string> {
  return new Set([
    ...Object.values(contextEngine.skills),
    "perception",
    "location-judgment",
    "sleep-consolidation",
  ]);
}

/**
 * The world's shared skills (`skills.load.extraDirs`) a character may read,
 * sorted: every one there but the engine's own and those hidden from models.
 * Roots resolve against the Gateway's cwd, as OpenClaw resolves them.
 */
export async function characterSkills(
  config: OpenClawConfig,
  engine: ReadonlySet<string>,
  cwd: string = process.cwd(),
): Promise<string[]> {
  const names = new Set<string>();
  for (const dir of config.skills?.load?.extraDirs ?? []) {
    await collect(resolveUserPath(dir, cwd), 0, names);
  }
  return [...names].filter((name) => !engine.has(name)).sort();
}

/** OpenClaw's grouped layout: a `SKILL.md` ends the search below it. */
async function collect(
  dir: string,
  depth: number,
  into: Set<string>,
): Promise<void> {
  const file = path.join(dir, "SKILL.md");
  if (existsSync(file)) {
    const { frontmatter } = parseSkillMarkdown(await fs.readFile(file, "utf8"));
    if (frontmatter?.["disable-model-invocation"] !== true) {
      into.add(frontmatter?.name ?? path.basename(dir));
    }
    return;
  }
  if (depth >= MAX_GROUPED_SKILL_SCAN_DEPTH || !existsSync(dir)) return;
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && !entry.name.startsWith(".")) {
      await collect(path.join(dir, entry.name), depth + 1, into);
    }
  }
}
