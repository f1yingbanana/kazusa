import path from "node:path";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { CONTEXT_ENGINE_CONFIG } from "../context-engine/config.ts";
import {
  clearSkillCaches,
  kazusaSkillsDir,
} from "../context-engine/skill-loader.ts";
import { currentConfig } from "../current-config.ts";
import { resolveUserPath } from "../state-dir.ts";
import { characterSkills, engineSkills } from "./character-skills.ts";
import { ALL, CHARACTER_SKILLS, SHARED_SKILLS, watchSkills } from "./watch.ts";

export interface SkillSync {
  /** What every character can read now. */
  readonly skills: readonly string[];
  readonly added: readonly string[];
  readonly removed: readonly string[];
}

/**
 * Skills reach characters two ways. Kazusa's own (the engine's instructions,
 * rubrics and wording) are read by our loaders and cached until a skill
 * changes. The rest are OpenClaw's: each session keeps a snapshot of its
 * skills, rebuilt from disk when its agent's skill list changes. So
 * `agents.defaults.skills`, which every character inherits, is kept to exactly
 * the world's shared skills; it is hot config, so writing it reloads nothing.
 *
 * One watcher for the process notices skills added, edited or removed (the
 * world's, each character's and Kazusa's) and does what `refresh_skills` does.
 * Bodies are read when used, so an edit applies from the next turn. A changed
 * description changes no list and waits for a Gateway restart.
 */
export function registerSkills(
  api: OpenClawPluginApi,
  { watch = true }: { readonly watch?: boolean } = {},
): void {
  const engine = engineSkills(
    CONTEXT_ENGINE_CONFIG.parse(api.pluginConfig?.contextEngine ?? {}),
  );

  async function sync(): Promise<SkillSync> {
    const config = currentConfig(api);
    const skills = await characterSkills(config, engine);
    const listed = config.agents?.defaults?.skills;
    const before = listed ?? [];
    const added = skills.filter((name) => !before.includes(name));
    const removed = before.filter((name) => !skills.includes(name));
    // No list at all means every skill, bundled ones included.
    if (!listed || added.length > 0 || removed.length > 0) {
      await api.runtime.config.mutateConfigFile({
        afterWrite: { mode: "auto" },
        mutate(draft) {
          draft.agents ??= {};
          draft.agents.defaults = { ...draft.agents.defaults, skills };
        },
      });
    }
    return { skills, added, removed };
  }

  // One refresh at a time: a burst of edits must not race its own writes.
  let refreshing: Promise<unknown> = Promise.resolve();
  const refresh = (): Promise<SkillSync> => {
    const run = refreshing.then(() => {
      clearSkillCaches();
      return sync();
    });
    refreshing = run.catch(() => undefined);
    return run;
  };

  // Administrative: allowlisted for the system agent only (`openclaw.json`).
  api.registerTool({
    name: "refresh_skills",
    label: "Refresh Skills",
    description:
      "Reload skills now and report what characters can read. Skills under shared/skills reload on their own within a second; use this to check, or if they didn't. Characters can read each skill there except the engine's own.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    async execute() {
      const result = await refresh();
      return {
        content: [{ type: "text" as const, text: describeSync(result) }],
        details: result,
      };
    },
  });

  // A world may arrive with skills its config doesn't list yet.
  api.on("gateway_start", async () => {
    try {
      await refresh();
    } catch (error) {
      api.logger.warn(
        `Kazusa skills: could not list character skills: ${String(error)}`,
      );
    }
  });

  if (!watch) return;
  const config = currentConfig(api);
  const workspaces = config.agents?.defaults?.workspace;
  watchSkills(
    [
      { dir: path.resolve("shared"), skills: SHARED_SKILLS },
      { dir: kazusaSkillsDir(api.rootDir), skills: ALL },
      ...(workspaces
        ? [{ dir: resolveUserPath(workspaces), skills: CHARACTER_SKILLS }]
        : []),
    ],
    () => {
      refresh().then(
        (result) => {
          api.logger.info(`Kazusa skills changed. ${describeSync(result)}`);
        },
        (error: unknown) => {
          api.logger.warn(`Kazusa skills: reload failed: ${String(error)}`);
        },
      );
    },
    (message) => {
      api.logger.warn(message);
    },
  );
}

export function describeSync({ skills, added, removed }: SkillSync): string {
  const changes = [
    added.length > 0 ? `added ${added.join(", ")}` : undefined,
    removed.length > 0 ? `removed ${removed.join(", ")}` : undefined,
  ].filter(Boolean);
  return [
    skills.length > 0
      ? `Characters can read: ${skills.join(", ")}.`
      : "Characters have no skills to read.",
    changes.length > 0
      ? `Since the last refresh: ${changes.join("; ")}.`
      : "None added or removed.",
    "Edits, the engine's own skills included, apply from each character's next turn. A changed description applies after a Gateway restart.",
  ].join(" ");
}
