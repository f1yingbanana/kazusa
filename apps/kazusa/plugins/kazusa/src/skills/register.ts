import path from "node:path";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { CONTEXT_ENGINE_CONFIG } from "../context-engine/config.ts";
import {
  clearSkillCaches,
  kazusaSkillsDir,
} from "../context-engine/skill-loader.ts";
import { currentConfig } from "../current-config.ts";
import { resolveUserPath } from "../state-dir.ts";
import {
  characterSkills,
  engineSkills,
  skillRevision,
} from "./character-skills.ts";
import { CHARACTER_SKILLS, skillsFolder, watchSkills } from "./watch.ts";

export interface SkillSync {
  /** What every character can read: the world's skills. */
  readonly shared: readonly string[];
  /** Characters with skills of their own: those skills. */
  readonly own: Readonly<Record<string, readonly string[]>>;
  /** Skills whose copies changed since the last refresh. */
  readonly changed: readonly string[];
}

/** Where a skill's revision goes: its own entry's free-form `config`. */
const REVISION = "kazusaRevision";

type SkillEntries = NonNullable<
  NonNullable<ReturnType<typeof currentConfig>["skills"]>["entries"]
>;

const revisionOf = (entries: SkillEntries, name: string): unknown =>
  entries[name]?.config?.[REVISION];

/**
 * Skills reach characters two ways. Kazusa's own (the engine's instructions,
 * rubrics and wording) are read by our loaders and cached until a skill
 * changes; OpenClaw never shows them (`skills.entries.<name>.enabled: false`).
 * The rest are OpenClaw's: it shows each character the world's `shared/skills`
 * and their own workspace's `skills/`, a copy there replacing the world's for
 * them alone. Bundled skills stay hidden (`skills.allowBundled`, which setup
 * writes from `base.json`).
 *
 * Each session keeps a snapshot of its skills, rebuilt from disk whenever
 * anything under `skills` in the config changes, and that config is hot. So
 * each skill characters can read gets a revision in its entry, a hash of where
 * its copies are and what they say they are: writing a new one is what makes
 * every character's next turn see a skill added, removed, copied or
 * redescribed. Bodies are read when used, so an edit to one needs nothing.
 *
 * One watcher for the process (the world's, each character's and Kazusa's
 * skills) does this within a second of a change, as `refresh_skills` does. A
 * character added later is covered if their workspace is beside the others.
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
    const skills = await characterSkills(config, engine, (agentId) =>
      api.runtime.agent.resolveAgentWorkspaceDir(config, agentId),
    );
    const revisions = new Map(
      [...skills].map(([name, copies]) => [name, skillRevision(name, copies)]),
    );
    const entries: SkillEntries = config.skills?.entries ?? {};
    const hide = [...engine].filter((name) => entries[name]?.enabled !== false);
    const changed = [...revisions]
      .filter(([name, revision]) => revisionOf(entries, name) !== revision)
      .map(([name]) => name);
    const gone = Object.keys(entries).filter(
      (name) => revisionOf(entries, name) !== undefined && !revisions.has(name),
    );
    if (hide.length > 0 || changed.length > 0 || gone.length > 0) {
      await api.runtime.config.mutateConfigFile({
        afterWrite: { mode: "auto" },
        mutate(draft) {
          const own = ((draft.skills ??= {}).entries ??= {});
          for (const name of hide) own[name] = { ...own[name], enabled: false };
          for (const name of changed)
            own[name] = {
              ...own[name],
              config: { ...own[name]?.config, [REVISION]: revisions.get(name) },
            };
          for (const name of gone) {
            const { [REVISION]: _gone, ...config } = own[name]?.config ?? {};
            const { config: _config, ...entry } = own[name] ?? {};
            const kept =
              Object.keys(config).length > 0 ? { ...entry, config } : entry;
            if (Object.keys(kept).length > 0) own[name] = kept;
            else delete own[name];
          }
        },
      });
    }
    const shared: string[] = [];
    const own: Record<string, string[]> = {};
    for (const [name, copies] of [...skills].sort(([a], [b]) =>
      a.localeCompare(b),
    ))
      for (const { owner } of copies)
        if (owner === "world") {
          if (!shared.includes(name)) shared.push(name);
        } else if (!(own[owner] ??= []).includes(name)) own[owner].push(name);
    return { shared, own, changed: [...changed, ...gone].sort() };
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
      "Reload skills now and report which skills characters can read. Skills under shared/skills or a character's workspaces/<id>/skills reload on their own within a second; use this to check, or if one didn't.",
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

  // Skills may have changed while the Gateway was stopped.
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
  // The folders `sync` reads: the world's, Kazusa's, and the folder the
  // characters' workspaces are in (one for a Kazusa world).
  const config = currentConfig(api);
  const workspaceFolders = new Set(
    Object.keys(config.agents?.entries ?? {}).map((agentId) =>
      path.dirname(
        path.resolve(
          api.runtime.agent.resolveAgentWorkspaceDir(config, agentId),
        ),
      ),
    ),
  );
  watchSkills(
    [
      ...(config.skills?.load?.extraDirs ?? []).map((dir) =>
        skillsFolder(resolveUserPath(dir)),
      ),
      skillsFolder(kazusaSkillsDir(api.rootDir)),
      ...[...workspaceFolders].map((dir) => ({
        dir,
        skills: CHARACTER_SKILLS,
      })),
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

export function describeSync({ shared, own, changed }: SkillSync): string {
  const characters = Object.entries(own).map(
    ([agentId, names]) => `${agentId}'s own: ${names.join(", ")}`,
  );
  return [
    shared.length > 0
      ? `Every character can read: ${shared.join(", ")}.`
      : "No skills every character can read.",
    ...(characters.length > 0 ? [`${characters.join("; ")}.`] : []),
    changed.length > 0
      ? `Changed since the last refresh: ${changed.join(", ")}.`
      : "Nothing changed since the last refresh.",
    "Changes apply from each character's next turn. A character's own copy of a skill replaces the world's for them.",
  ].join(" ");
}
