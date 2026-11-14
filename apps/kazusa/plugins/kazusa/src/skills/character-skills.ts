import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { OpenClawConfig } from "openclaw/plugin-sdk/core";
import type { ContextEngineConfig } from "../context-engine/config.ts";
import { parseSkillMarkdown } from "../context-engine/skill-loader.ts";
import { resolveUserPath } from "../state-dir.ts";

/** How deep OpenClaw looks for a grouped skill under a root. */
const MAX_GROUPED_SKILL_SCAN_DEPTH = 6;

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
    "kazusa-tools",
    "kazusa-results",
    "kazusa-deliveries",
  ]);
}

/** One copy of a skill a character can read, and whose it is. */
export interface SkillCopy {
  /** `world`, or the character whose workspace holds it. */
  readonly owner: string;
  readonly file: string;
  readonly description: string;
}

/**
 * Every skill characters can read and where each copy is: the world's
 * (`skills.load.extraDirs`, every character) and each character's own
 * (`<workspace>/skills` and `.agents/skills`, theirs alone), as OpenClaw finds
 * them, the system agent's included: her `.agents` is a copy of the repo's. The
 * engine's own and those hidden from models are left out.
 */
export async function characterSkills(
  config: OpenClawConfig,
  engine: ReadonlySet<string>,
  workspaceOf: (agentId: string) => string | undefined,
  cwd: string = process.cwd(),
): Promise<Map<string, SkillCopy[]>> {
  const skills = new Map<string, SkillCopy[]>();
  const add =
    (owner: string) => (name: string, copy: Omit<SkillCopy, "owner">) => {
      if (engine.has(name)) return;
      skills.set(name, [...(skills.get(name) ?? []), { owner, ...copy }]);
    };
  for (const dir of config.skills?.load?.extraDirs ?? []) {
    await collect(resolveUserPath(dir, cwd), 0, add("world"));
  }
  for (const agentId of Object.keys(config.agents?.entries ?? {}).sort()) {
    const workspace = workspaceOf(agentId);
    if (!workspace) continue;
    for (const dir of ["skills", path.join(".agents", "skills")]) {
      await collect(path.join(workspace, dir), 0, add(agentId));
    }
  }
  return skills;
}

/**
 * What OpenClaw would show of a skill's copies, as a short hash: where each is
 * and its name and description. Bodies are left out; OpenClaw reads those when
 * a skill is opened, so an edit to one needs no new list.
 */
export function skillRevision(
  name: string,
  copies: readonly SkillCopy[],
  cwd: string = process.cwd(),
): string {
  const lines = copies
    .map((copy) =>
      [path.relative(cwd, copy.file), name, copy.description].join("\t"),
    )
    .sort();
  return createHash("sha256")
    .update(lines.join("\n"))
    .digest("hex")
    .slice(0, 12);
}

/** OpenClaw's grouped layout: a `SKILL.md` ends the search below it. */
async function collect(
  dir: string,
  depth: number,
  add: (name: string, copy: Omit<SkillCopy, "owner">) => void,
): Promise<void> {
  const file = path.join(dir, "SKILL.md");
  if (existsSync(file)) {
    const { frontmatter } = parseSkillMarkdown(await fs.readFile(file, "utf8"));
    if (frontmatter?.["disable-model-invocation"] !== true) {
      add(frontmatter?.name ?? path.basename(dir), {
        file,
        description: frontmatter?.description ?? "",
      });
    }
    return;
  }
  if (depth >= MAX_GROUPED_SKILL_SCAN_DEPTH || !existsSync(dir)) return;
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && !entry.name.startsWith(".")) {
      await collect(path.join(dir, entry.name), depth + 1, add);
    }
  }
}
