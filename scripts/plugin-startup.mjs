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

/**
 * The tools OpenClaw once granted for `tools.exec` and `tools.fs` being set. It
 * no longer does, but warns about it on every tool-policy check of every
 * character (#47487): six lines per turn, 40% of a long run's log.
 */
export const IMPLIED_TOOLS = ["exec", "process", "read", "write", "edit"];

/**
 * Characters keep both sections, though neither grants anything to the
 * `minimal` profile now: `fs.workspaceOnly` still holds `view_image` to their
 * workspace, and `exec.applyPatch` keeps `apply_patch` off should `write` ever
 * be allowed. A deny on the character itself is what tells OpenClaw the tools
 * are meant to be missing; a global one would take ARONA's files too. It
 * removes nothing a character has. Every character entry gets it before each
 * start, so one added since the last start gets it at the next. Not the system
 * agent, and not a character with tools of its own: that's the world's call.
 */
export function denyImpliedTools(root) {
  const configFile = path.join(root, "apps/kazusa/world/openclaw.json");
  if (!existsSync(configFile)) return [];
  const config = JSON.parse(readFileSync(configFile, "utf8"));
  const system = config.agents?.defaults?.systemAgent?.agentId;
  const characters = Object.entries(config.agents?.entries ?? {}).filter(
    ([id, entry]) =>
      id !== system && entry && !entry.$include && entry.tools === undefined,
  );
  if (!characters.length) return [];
  for (const [, entry] of characters)
    entry.tools = { deny: [...IMPLIED_TOOLS] };
  writeFileSync(configFile, `${JSON.stringify(config, null, 2)}\n`);
  return [
    `${characters.length} characters now deny shell and file tools outright, which they never had.`,
  ];
}

/**
 * A skill name no bundled skill has. OpenClaw reads an empty `allowBundled` as
 * "every bundled skill", so the only way to allow none is a list that matches
 * none: this is that list's one entry, not a skill.
 */
export const NO_BUNDLED_SKILLS = "kazusa:no-bundled-skills";

/**
 * Characters' skills come from OpenClaw, which shows each one the world's
 * `shared/skills` and their own workspace's `skills/`. A world made before this
 * listed the world's skills in `agents.defaults.skills`, which hid a
 * character's own; that list goes, and OpenClaw's bundled skills (GitHub,
 * weather, …) stay hidden through `skills.allowBundled` instead. Kazusa's own
 * skills are hidden at runtime (`skills.entries.<name>.enabled: false`), since
 * a world can rename them. An `allowBundled` the world set itself is kept.
 */
export function scopeCharacterSkills(root) {
  const configFile = path.join(root, "apps/kazusa/world/openclaw.json");
  if (!existsSync(configFile)) return [];
  const config = JSON.parse(readFileSync(configFile, "utf8"));
  const defaults = config.agents?.defaults;
  const listed = defaults && "skills" in defaults;
  if (listed) delete defaults.skills;
  const skills = (config.skills ??= {});
  const hiding = skills.allowBundled === undefined;
  if (hiding) skills.allowBundled = [NO_BUNDLED_SKILLS];
  if (!listed && !hiding) return [];
  writeFileSync(configFile, `${JSON.stringify(config, null, 2)}\n`);
  return [
    "Characters can now have skills of their own, in their workspace's skills/ folder.",
  ];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  for (const line of loadNewPlugins(root)) console.log(line);
  for (const line of startProviderPlugins(root)) console.log(line);
  for (const line of allowChatStarters(root)) console.log(line);
  for (const line of denyImpliedTools(root)) console.log(line);
  for (const line of scopeCharacterSkills(root)) console.log(line);
}
