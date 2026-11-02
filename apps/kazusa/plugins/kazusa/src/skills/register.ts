import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { CONTEXT_ENGINE_CONFIG } from "../context-engine/config.ts";
import { clearSkillCaches } from "../context-engine/skill-loader.ts";
import { currentConfig } from "../current-config.ts";
import { characterSkills, engineSkills } from "./character-skills.ts";

export interface SkillSync {
  /** What characters can read now. */
  readonly skills: readonly string[];
  readonly added: readonly string[];
  readonly removed: readonly string[];
}

/**
 * Skills reach characters two ways, and neither watches the disk
 * (`skills.load.watch` is off with a large cast). The engine's own are read and
 * cached by our loaders. The rest are OpenClaw's: each session keeps a snapshot
 * of the list, which it rebuilds from disk when its agent's skill allowlist
 * changes. So `agents.defaults.skills`, which every character inherits, is kept
 * to exactly the world's shared skills, and writing it is the refresh. Bodies
 * are read when used, so an edit needs no rebuild; only a new description waits
 * for the next one.
 */
export function registerSkills(api: OpenClawPluginApi): void {
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

  // Administrative: allowlisted for the system agent only (`openclaw.json`).
  api.registerTool({
    name: "refresh_skills",
    label: "Refresh Skills",
    description:
      "Reload skills after you add, edit or remove one under shared/skills, so every character's next turn uses them. Characters can read each skill there except the engine's own.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    async execute() {
      clearSkillCaches();
      const result = await sync();
      return {
        content: [{ type: "text" as const, text: describeSync(result) }],
        details: result,
      };
    },
  });

  // A world may arrive with skills its config doesn't list yet.
  api.on("gateway_start", async () => {
    try {
      await sync();
    } catch (error) {
      api.logger.warn(
        `Kazusa skills: could not list character skills: ${String(error)}`,
      );
    }
  });
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
    "Edits, the engine's own skills included, apply from each character's next turn. A changed description shows in their skill list once a skill is next added or removed, or after a Gateway restart.",
  ].join(" ");
}
