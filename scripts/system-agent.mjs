#!/usr/bin/env node
/**
 * The system agent's tools and skills belong to the app, not the world: they
 * grow with each release, and a world outlives many. So the world's config
 * keeps only what is its own (workspace, name, cwd) and includes the rest from
 * a file rewritten from `apps/kazusa/base.json` before every Gateway start.
 * Keys set beside the include still override it.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Where the world's config finds them, relative to it (setup writes this too). */
export const SYSTEM_AGENT_INCLUDE = "./.state/kazusa/system-agent.json";

/**
 * Rewrites the included file, and moves a world from before the include onto
 * it, dropping the copy its setup made. Returns what it changed, to report.
 */
export function syncSystemAgent(root) {
  const world = path.join(root, "apps/kazusa/world");
  const configFile = path.join(world, "openclaw.json");
  if (!existsSync(configFile)) return [];
  const { systemAgent } = JSON.parse(
    readFileSync(path.join(root, "apps/kazusa/base.json"), "utf8"),
  );
  const target = path.join(world, SYSTEM_AGENT_INCLUDE);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(systemAgent, null, 2)}\n`);

  const config = JSON.parse(readFileSync(configFile, "utf8"));
  const id = config.agents?.defaults?.systemAgent?.agentId;
  const entry = id ? config.agents?.entries?.[id] : undefined;
  if (!entry || entry.$include) return [];
  const { tools: _tools, skills: _skills, ...own } = entry;
  config.agents.entries[id] = { $include: SYSTEM_AGENT_INCLUDE, ...own };
  writeFileSync(configFile, `${JSON.stringify(config, null, 2)}\n`);
  return [`${id}'s tools and skills now come with Kazusa and update with it.`];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  for (const line of syncSystemAgent(root)) console.log(line);
}
