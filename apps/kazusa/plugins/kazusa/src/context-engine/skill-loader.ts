import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import YAML from "yaml";
import { z } from "zod";
import { currentConfig } from "../current-config.ts";

/**
 * Zod schema for validating and strongly typing SKILL.md frontmatter based on
 * the AgentSkills / OpenClaw skill specification.
 */
export const SkillFrontmatterSchema = z
  .object({
    name: z.string().optional(),
    description: z.string().optional(),
    "user-invocable": z.boolean().optional(),
    "disable-model-invocation": z.boolean().optional(),
    "command-dispatch": z.enum(["tool"]).optional(),
    "command-tool": z.string().optional(),
    "command-arg-mode": z.enum(["raw"]).optional(),
    homepage: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

export type SkillFrontmatter = z.infer<typeof SkillFrontmatterSchema>;

export interface ParsedSkillDocument {
  readonly frontmatter: SkillFrontmatter | null;
  readonly body: string;
}

const FRONTMATTER_REGEX =
  /^\s*---[^\S\n]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[^\S\n]*(?:\r?\n|$)/u;

/**
 * Parse a SKILL.md document into its typed YAML frontmatter (validated via
 * SkillFrontmatterSchema) and Markdown body.
 */
export function parseSkillMarkdown(content: string): ParsedSkillDocument {
  const normalized = content.replace(/^\uFEFF/u, "");
  const match = FRONTMATTER_REGEX.exec(normalized);
  if (!match) {
    return { frontmatter: null, body: normalized.trim() };
  }

  const rawYaml = match[1];
  const body = normalized.slice(match[0].length).trim();

  try {
    const rawParsed: unknown = YAML.parse(rawYaml);
    const result = SkillFrontmatterSchema.safeParse(rawParsed);
    return {
      frontmatter: result.success ? result.data : null,
      body,
    };
  } catch {
    return { frontmatter: null, body };
  }
}

/** A parsed `SKILL.md`; `sections` is filled by whoever first needs them. */
export interface SkillFile {
  readonly document: ParsedSkillDocument;
  sections?: ReadonlyMap<string, string>;
}

const FILES = Symbol.for("kazusa.skillFiles");

/**
 * Every `SKILL.md` read in this process, or `null` where there is none. One
 * cache for every registration: they all read the same few files.
 */
function files(): Map<string, SkillFile | null> {
  const cell = globalThis as { [FILES]?: Map<string, SkillFile | null> };
  return (cell[FILES] ??= new Map<string, SkillFile | null>());
}

/** The parsed file, read once until `clearSkillCaches`; `null` if missing. */
export function readSkillFile(file: string): SkillFile | null {
  const cache = files();
  if (!cache.has(file)) {
    let read: SkillFile | null = null;
    try {
      read = { document: parseSkillMarkdown(readFileSync(file, "utf8")) };
    } catch {
      // Not here: the next place may have it.
    }
    cache.set(file, read);
  }
  return cache.get(file) ?? null;
}

/**
 * Forget every file read, so the next lookup reads disk. The skills watcher
 * calls this when a skill changes, and so does `refresh_skills`.
 */
export function clearSkillCaches(): void {
  files().clear();
}

/** Kazusa's own skills, `apps/kazusa/shared/skills`. */
export function kazusaSkillsDir(pluginRootDir?: string): string {
  return pluginRootDir
    ? path.resolve(pluginRootDir, "..", "..", "shared", "skills")
    : fileURLToPath(new URL("../../../../shared/skills", import.meta.url));
}

export interface SkillResolutionContext {
  readonly agentId?: string;
  readonly workspaceDir?: string;
}

export interface SkillLoaderOptions {
  /** A world's skills: `shared/skills` under the Gateway's cwd by default. */
  readonly worldDir?: string;
  /** Kazusa's defaults: `kazusaSkillsDir()` by default. */
  readonly defaultsDir?: string;
  /** A character's workspace, when the context names only the character. */
  readonly workspaceOf?: (agentId: string) => string | undefined;
}

export interface SkillLoader {
  /** Where a skill may be for this character, the first found winning. */
  readonly getCandidateRoots: (
    context?: SkillResolutionContext,
  ) => readonly string[];
  /** The skill's body, without frontmatter. Rejects when no place has it. */
  readonly loadSkill: (
    name: string,
    context?: SkillResolutionContext,
  ) => Promise<string>;
  readonly loadSkillDocument: (
    name: string,
    context?: SkillResolutionContext,
  ) => Promise<ParsedSkillDocument>;
}

/**
 * Kazusa's own skills: what the engine injects (`context-conventions`,
 * `task-lifecycle`, …), its rubrics (`perception`, `location-judgment`) and its
 * wording (`kazusa-tools`, `kazusa-results`, `kazusa-deliveries`). OpenClaw
 * loads every other skill itself. Each is `<place>/<name>/SKILL.md` in one of
 * three places, the first found winning:
 *
 * 1. `<character workspace>/skills`: one character's own version;
 * 2. `<world>/shared/skills`: the world's;
 * 3. `apps/kazusa/shared/skills`: Kazusa's defaults.
 */
export function createSkillLoader(
  options: SkillLoaderOptions = {},
): SkillLoader {
  const worldDir = options.worldDir ?? path.resolve("shared", "skills");
  const defaultsDir = options.defaultsDir ?? kazusaSkillsDir();

  function getCandidateRoots(
    context?: SkillResolutionContext,
  ): readonly string[] {
    const workspace =
      context?.workspaceDir ??
      (context?.agentId ? options.workspaceOf?.(context.agentId) : undefined);
    return [
      ...new Set([
        ...(workspace ? [path.join(workspace, "skills")] : []),
        worldDir,
        defaultsDir,
      ]),
    ];
  }

  function find(name: string, context?: SkillResolutionContext): SkillFile {
    const roots = getCandidateRoots(context);
    for (const root of roots) {
      const file = readSkillFile(path.join(root, name, "SKILL.md"));
      if (file) return file;
    }
    throw new Error(
      `Kazusa skill "${name}" is in none of:\n  ${roots.join("\n  ")}`,
    );
  }

  return {
    getCandidateRoots,
    loadSkill: (name, context) =>
      new Promise((resolve) => resolve(find(name, context).document.body)),
    loadSkillDocument: (name, context) =>
      new Promise((resolve) => resolve(find(name, context).document)),
  };
}

/** This Gateway's loader: the world is its cwd, Kazusa beside the plugin. */
export function pluginSkillLoader(api: OpenClawPluginApi): SkillLoader {
  return createSkillLoader({
    defaultsDir: kazusaSkillsDir(api.rootDir),
    workspaceOf: (agentId) =>
      api.runtime.agent.resolveAgentWorkspaceDir(currentConfig(api), agentId),
  });
}
