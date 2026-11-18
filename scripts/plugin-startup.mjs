#!/usr/bin/env node
/**
 * A character's turn needs its model's provider plugin in the registry it
 * shares with the Gateway. OpenClaw starts a provider plugin with the Gateway
 * only when config names one of its models or the plugin has an explicit hook
 * policy, and Kazusa's model pick (its own store) is never in config. Without
 * one, each character's first turn finds the plugin missing and loads every
 * plugin again, a whole Kazusa included: about 3 s and 29 MB per character.
 * `apps/kazusa/base.json` gives each provider `hooks.allowPromptInjection:
 * true`, which is already the default behaviour and only changes startup. A
 * world's `openclaw.json` is written once, at setup, so this brings it in step
 * with a provider a later Kazusa adds. It runs before the Gateway starts, since
 * a config change while it runs reloads every plugin.
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

/**
 * The tools OpenClaw once granted for `tools.exec` and `tools.fs` being set. It
 * no longer does, but warns about it on every tool-policy check of every
 * character (#47487): six lines per turn, 40% of a long run's log.
 */
export const IMPLIED_TOOLS = ["exec", "process", "read", "write", "edit"];

/**
 * OpenClaw builds these on every turn whenever some provider can make media,
 * and the `minimal` profile only hides them afterwards. Characters never get
 * them; ARONA keeps them.
 */
export const MEDIA_GENERATION_TOOLS = [
  "image_generate",
  "video_generate",
  "music_generate",
];

/** Everything a character's own deny holds. */
export const CHARACTER_DENIED_TOOLS = [
  ...IMPLIED_TOOLS,
  ...MEDIA_GENERATION_TOOLS,
];

/**
 * The deny this script wrote before the media tools joined it, exactly. Any
 * other deny, even a narrower one, is the world's own.
 */
function isOurEarlierDeny(tools) {
  return (
    Object.keys(tools).length === 1 &&
    Array.isArray(tools.deny) &&
    tools.deny.length === IMPLIED_TOOLS.length &&
    IMPLIED_TOOLS.every((tool) => tools.deny.includes(tool))
  );
}

/**
 * Characters keep both sections, though neither grants anything to the
 * `minimal` profile now: `fs.workspaceOnly` still holds `view_image` to their
 * workspace, and `exec.applyPatch` keeps `apply_patch` off should `write` ever
 * be allowed. A deny on the character itself is what tells OpenClaw the tools
 * are meant to be missing; a global one would take ARONA's files too. It
 * removes nothing a character has. Every character entry gets it before each
 * start, so one added since the last start gets it at the next, and a deny
 * written before the media tools joined it is brought up to date. Not the
 * system agent, and not a character with tools of its own: that's the world's
 * call.
 */
export function denyImpliedTools(root) {
  const configFile = path.join(root, "apps/kazusa/world/openclaw.json");
  if (!existsSync(configFile)) return [];
  const config = JSON.parse(readFileSync(configFile, "utf8"));
  const system = config.agents?.defaults?.systemAgent?.agentId;
  const characters = Object.entries(config.agents?.entries ?? {}).filter(
    ([id, entry]) =>
      id !== system &&
      entry &&
      !entry.$include &&
      (entry.tools === undefined || isOurEarlierDeny(entry.tools)),
  );
  if (!characters.length) return [];
  for (const [, entry] of characters)
    entry.tools = { deny: [...CHARACTER_DENIED_TOOLS] };
  writeFileSync(configFile, `${JSON.stringify(config, null, 2)}\n`);
  return [
    `${characters.length} characters now deny shell, file and media-generation tools, which they never had.`,
  ];
}

/**
 * A world's `tools.alsoAllow` is the list of character tools `base.json` had
 * when it was made, so a tool a later Kazusa adds (`change_state`) is never
 * offered there. This adds the ones the world lacks, in `base.json`'s order
 * after the tool before them. A tool missing from a world is taken as newer
 * than it: to keep one from characters, put it in `tools.deny`, which this
 * respects and which wins in OpenClaw anyway. A world without the list set its
 * tools up its own way and is left alone.
 */
export function allowNewCharacterTools(root) {
  const configFile = path.join(root, "apps/kazusa/world/openclaw.json");
  if (!existsSync(configFile)) return [];
  const base = JSON.parse(
    readFileSync(path.join(root, "apps/kazusa/base.json"), "utf8"),
  );
  const wanted = base.config?.tools?.alsoAllow ?? [];
  const config = JSON.parse(readFileSync(configFile, "utf8"));
  const allowed = config.tools?.alsoAllow;
  if (!Array.isArray(allowed)) return [];
  const denied = config.tools.deny ?? [];
  const added = [];
  wanted.forEach((tool, index) => {
    if (allowed.includes(tool) || denied.includes(tool)) return;
    const before = allowed.indexOf(wanted[index - 1]);
    allowed.splice(before < 0 ? allowed.length : before + 1, 0, tool);
    added.push(tool);
  });
  if (!added.length) return [];
  writeFileSync(configFile, `${JSON.stringify(config, null, 2)}\n`);
  return [`Characters can now use new tools: ${added.join(", ")}.`];
}

/**
 * Two start-up jobs a Kazusa world never needs. `base.json` turns both off for
 * new worlds; older worlds lack the settings, so this adds them. Worktree
 * templates: a world is a git clone, so OpenClaw takes every character's
 * workspace for a repository and runs some 250 git commands, a fetch among
 * them. The webhook listener check is for Telegram, Feishu, Teams and Nextcloud
 * Talk; unmarked, it makes OpenClaw read and validate the whole config a second
 * time, about 2 s. A world that already recorded webhook pins keeps them.
 */
export function skipUnusedStartupWork(root) {
  const configFile = path.join(root, "apps/kazusa/world/openclaw.json");
  if (!existsSync(configFile)) return [];
  const config = JSON.parse(readFileSync(configFile, "utf8"));
  const migrations = ((config.meta ??= {}).migrations ??= {});
  if (
    config.worktreeAcceleration === false &&
    migrations.webhookListeners !== undefined
  )
    return [];
  config.worktreeAcceleration = false;
  migrations.webhookListeners ??= true;
  writeFileSync(configFile, `${JSON.stringify(config, null, 2)}\n`);
  return [
    "This world now skips start-up work only other OpenClaw setups need.",
  ];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  for (const line of loadNewPlugins(root)) console.log(line);
  for (const line of startProviderPlugins(root)) console.log(line);
  for (const line of denyImpliedTools(root)) console.log(line);
  for (const line of allowNewCharacterTools(root)) console.log(line);
  for (const line of skipUnusedStartupWork(root)) console.log(line);
}
