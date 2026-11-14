#!/usr/bin/env node
/**
 * The system agent's tools and skills belong to the app, not the world: they
 * grow with each release, and a world outlives many. So the world keeps only
 * what is its own, and before every Gateway start this rewrites the rest:
 *
 * - Her tools: the world's config keeps her workspace, name and cwd, and
 *   includes the rest from a file rewritten from `apps/kazusa/base.json`. Keys
 *   set beside the include still override it.
 * - Her skills: Kazusa's own guides (`.agents/` at its root), copied into her
 *   workspace's `.agents/`. A copy, not a link: a link stores where Kazusa was,
 *   so moving the folder broke it, and some drives (FAT32, exFAT) can't hold
 *   one at all.
 */
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Where the world's config finds them, relative to it (setup writes this too). */
export const SYSTEM_AGENT_INCLUDE = "./.state/kazusa/system-agent.json";

const worldOf = (root) => path.join(root, "apps/kazusa/world");

/** Rewrites the included file from `base.json`, once setup has made a world. */
export function syncSystemAgent(root) {
  const world = worldOf(root);
  if (!existsSync(path.join(world, "openclaw.json"))) return;
  const { systemAgent } = JSON.parse(
    readFileSync(path.join(root, "apps/kazusa/base.json"), "utf8"),
  );
  const target = path.join(world, SYSTEM_AGENT_INCLUDE);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(systemAgent, null, 2)}\n`);
}

/**
 * Removes `target` without following it: a link (an older Kazusa's junction)
 * goes alone, never what it points at.
 */
function remove(target) {
  let stat;
  try {
    stat = lstatSync(target);
  } catch {
    return;
  }
  if (stat.isSymbolicLink()) unlinkSync(target);
  else rmSync(target, { recursive: true, force: true, maxRetries: 5 });
}

/**
 * Replaces the system agent's `.agents/` with a fresh copy of Kazusa's, once
 * setup has made a world. Returns where it went, or undefined when there was
 * nothing to do.
 */
export function syncSystemAgentSkills(root) {
  const world = worldOf(root);
  const configFile = path.join(world, "openclaw.json");
  const source = path.join(root, ".agents");
  if (!existsSync(configFile) || !existsSync(source)) return undefined;
  const { agents } = JSON.parse(readFileSync(configFile, "utf8"));
  const id = agents?.defaults?.systemAgent?.agentId;
  if (!id) return undefined;
  const workspace = path.resolve(
    world,
    agents.entries?.[id]?.workspace ?? `./workspaces/${id}`,
  );
  if (!existsSync(workspace)) return undefined;
  const target = path.join(workspace, ".agents");
  remove(target);
  cpSync(source, target, { recursive: true, dereference: true });
  return target;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  syncSystemAgent(root);
  syncSystemAgentSkills(root);
}
