#!/usr/bin/env node
/**
 * A character's turn needs its model's provider plugin in the registry it
 * shares with the Gateway. OpenClaw starts a provider plugin with the Gateway
 * only when config names one of its models or the plugin has an explicit hook
 * policy, and Kazusa's model pick (its own store) is never in config. Without
 * one, each character's first turn finds the plugin missing and loads every
 * plugin again, a whole Kazusa included: about 3 s and 29 MB per character.
 * `apps/kazusa/base.json` gives each provider `hooks.allowPromptInjection:
 * true`, which is already the default behaviour and only changes startup. This
 * brings a world made before that, or before a provider was added, in step. It
 * runs before the Gateway starts, since a config change while it runs reloads
 * every plugin.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Sets the hook policy on each plugin `base.json` sets it on, unless the world
 * doesn't allow that plugin or already decided its policy. Returns what it
 * changed, to report.
 */
export function startProviderPlugins(root) {
  const configFile = path.join(root, "apps/kazusa/world/openclaw.json");
  if (!existsSync(configFile)) return [];
  const base = JSON.parse(
    readFileSync(path.join(root, "apps/kazusa/base.json"), "utf8"),
  );
  const wanted = Object.entries(base.config?.plugins?.entries ?? {})
    .filter(([, entry]) => entry?.hooks?.allowPromptInjection === true)
    .map(([id]) => id);
  const config = JSON.parse(readFileSync(configFile, "utf8"));
  const plugins = (config.plugins ??= {});
  const entries = (plugins.entries ??= {});
  const allowed = (id) => !plugins.allow || plugins.allow.includes(id);
  const changed = wanted.filter((id) => {
    if (!allowed(id)) return false;
    const entry = (entries[id] ??= {});
    if (entry.hooks?.allowPromptInjection !== undefined) return false;
    (entry.hooks ??= {}).allowPromptInjection = true;
    return true;
  });
  if (!changed.length) return [];
  writeFileSync(configFile, `${JSON.stringify(config, null, 2)}\n`);
  return [
    `${changed.length} model provider plugins now start with the Gateway, so characters share one Kazusa.`,
  ];
}

/**
 * A world loads plugins by the paths `base.json` had when it was made. One
 * added since (OpenRP's provider) is loaded and allowed here, by the id in its
 * manifest: a path missing from a world means the plugin came after it, not
 * that its player turned it off. One not installed yet is left for the next
 * start. Run before `startProviderPlugins`, which only starts plugins the world
 * allows.
 */
export function loadNewPlugins(root) {
  const worldDir = path.join(root, "apps/kazusa/world");
  const configFile = path.join(worldDir, "openclaw.json");
  if (!existsSync(configFile)) return [];
  const base = JSON.parse(
    readFileSync(path.join(root, "apps/kazusa/base.json"), "utf8"),
  );
  const config = JSON.parse(readFileSync(configFile, "utf8"));
  const plugins = (config.plugins ??= {});
  const paths = ((plugins.load ??= {}).paths ??= []);
  const added = (base.config?.plugins?.load?.paths ?? [])
    .filter((dir) => !paths.includes(dir))
    .flatMap((dir) => {
      const manifest = path.join(worldDir, dir, "openclaw.plugin.json");
      if (!existsSync(manifest)) return [];
      const { id } = JSON.parse(readFileSync(manifest, "utf8"));
      paths.push(dir);
      if (plugins.allow && !plugins.allow.includes(id)) plugins.allow.push(id);
      return [id];
    });
  if (!added.length) return [];
  writeFileSync(configFile, `${JSON.stringify(config, null, 2)}\n`);
  return [`This world now loads new plugins: ${added.join(", ")}.`];
}

/** Tools that took over starting a chat from `send_message` (2026-11-05). */
const CHAT_STARTERS = ["create_group", "talk"];

/**
 * `send_message` only says something in a chat now; `create_group` and `talk`
 * start one. Characters get tools only from an explicit `alsoAllow`, so a world
 * made before this lets each one that may send start chats too: the global list
 * and any character's own. A list without `send_message` is left alone.
 */
export function allowChatStarters(root) {
  const configFile = path.join(root, "apps/kazusa/world/openclaw.json");
  if (!existsSync(configFile)) return [];
  const config = JSON.parse(readFileSync(configFile, "utf8"));
  const lists = [
    config.tools?.alsoAllow,
    ...Object.values(config.agents?.entries ?? {}).map(
      (agent) => agent?.tools?.alsoAllow,
    ),
  ].filter((list) => Array.isArray(list) && list.includes("send_message"));
  let added = 0;
  for (const list of lists) {
    const missing = CHAT_STARTERS.filter((tool) => !list.includes(tool));
    list.splice(list.indexOf("send_message") + 1, 0, ...missing);
    added += missing.length;
  }
  if (!added) return [];
  writeFileSync(configFile, `${JSON.stringify(config, null, 2)}\n`);
  return [
    "Characters can now start chats with create_group and talk; send_message only says something.",
  ];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  for (const line of loadNewPlugins(root)) console.log(line);
  for (const line of startProviderPlugins(root)) console.log(line);
  for (const line of allowChatStarters(root)) console.log(line);
}
