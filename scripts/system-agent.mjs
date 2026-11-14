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
  realpathSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Where the world's config finds them, relative to it (setup writes this too). */
export const SYSTEM_AGENT_INCLUDE = "./.state/kazusa/system-agent.json";

const worldOf = (root) => path.join(root, "apps/kazusa/world");

/** Whether `inner` is somewhere under `outer`. */
function within(inner, outer) {
  const relative = path.relative(outer, inner);
  if (relative === "" || path.isAbsolute(relative)) return false;
  return relative !== ".." && !relative.startsWith(`..${path.sep}`);
}

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

/** Whether anything, a dangling link included, is at `target`. */
function occupied(target) {
  try {
    lstatSync(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * Puts a copy of `source` at `target`, whatever was there before. The copy is
 * made beside it first, and the old one goes only once the new one is in place,
 * so a copy that fails partway (a full disk) leaves the last one working. Both
 * spares end in `.tmp`, which every world's git ignores.
 */
function replaceWithCopy(source, target) {
  const fresh = `${target}.new.tmp`;
  const old = `${target}.old.tmp`;
  remove(fresh);
  remove(old);
  try {
    cpSync(source, fresh, { recursive: true, dereference: true });
  } catch (error) {
    remove(fresh);
    throw error;
  }
  const had = occupied(target);
  if (had) renameSync(target, old);
  try {
    renameSync(fresh, target);
  } catch (error) {
    if (had) renameSync(old, target);
    remove(fresh);
    throw error;
  }
  remove(old);
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
  // A hand-edited config could point her workspace at Kazusa itself, where her
  // `.agents` would be the very guides being copied.
  const from = realpathSync.native(source);
  const into = path.join(realpathSync.native(workspace), ".agents");
  if (from === into || within(into, from) || within(from, into))
    throw new Error(
      `The system agent's workspace overlaps Kazusa's own guides: ${workspace}`,
    );
  const target = path.join(workspace, ".agents");
  replaceWithCopy(source, target);
  return target;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  syncSystemAgent(root);
  syncSystemAgentSkills(root);
}
