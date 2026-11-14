#!/usr/bin/env node
/**
 * The system agent's tools belong to the app, not the world: they grow with
 * each release, and a world outlives many. So the world's config keeps only
 * what is its own (workspace, name, cwd) and includes the rest from a file
 * rewritten from `apps/kazusa/base.json` before every Gateway start. Keys set
 * beside the include still override it.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Where the world's config finds them, relative to it (setup writes this too). */
export const SYSTEM_AGENT_INCLUDE = "./.state/kazusa/system-agent.json";

/** Rewrites the included file from `base.json`, once setup has made a world. */
export function syncSystemAgent(root) {
  const world = path.join(root, "apps/kazusa/world");
  if (!existsSync(path.join(world, "openclaw.json"))) return;
  const { systemAgent } = JSON.parse(
    readFileSync(path.join(root, "apps/kazusa/base.json"), "utf8"),
  );
  const target = path.join(world, SYSTEM_AGENT_INCLUDE);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(systemAgent, null, 2)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  syncSystemAgent(root);
}
