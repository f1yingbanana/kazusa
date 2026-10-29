import { existsSync, readFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { OpenClawConfig } from "openclaw/plugin-sdk/core";
import YAML from "yaml";
import { z } from "zod";
import { sharedDir } from "../shared-dir.ts";

export const MAX_GROUPED_SKILL_SCAN_DEPTH = 6;

export interface SkillResolutionContext {
  readonly agentId?: string;
  readonly workspaceDir?: string;
  readonly executionWorkspaceDir?: string;
  readonly cwd?: string;
}

export interface SkillLoaderOptions {
  readonly config?: OpenClawConfig;
  readonly agentId?: string;
  readonly workspaceDir?: string;
  readonly executionWorkspaceDir?: string;
  readonly pluginRootDir?: string;
  readonly cwd?: string;
  readonly fallbackDirs?: readonly string[];
  readonly env?: NodeJS.ProcessEnv;
}

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

export interface SkillLoader {
  readonly loadSkill: (
    name: string,
    context?: SkillResolutionContext,
  ) => Promise<string>;
  readonly loadSkillDocument: (
    name: string,
    context?: SkillResolutionContext,
  ) => Promise<ParsedSkillDocument>;
  readonly resolveSkillPath: (
    name: string,
    context?: SkillResolutionContext,
  ) => Promise<string | null>;
  readonly getCandidateRoots: (
    context?: SkillResolutionContext,
  ) => readonly string[];
  readonly clearCache: () => void;
}

/**
 * Check if the environment uses the default home-scoped state directory
 * (~/.openclaw).
 */
export function isDefaultStateDir(
  env: NodeJS.ProcessEnv = process.env,
  homedir: string = os.homedir(),
): boolean {
  const custom = env.OPENCLAW_STATE_DIR?.trim();
  if (!custom) return true;
  const defaultState = path.join(homedir, ".openclaw");
  return path.resolve(custom) === path.resolve(defaultState);
}

/**
 * Resolve the effective OpenClaw state directory (~/.openclaw or
 * OPENCLAW_STATE_DIR).
 */
export function resolveStateDir(
  env: NodeJS.ProcessEnv = process.env,
  homedir: string = os.homedir(),
): string {
  const custom = env.OPENCLAW_STATE_DIR?.trim();
  if (custom) return resolveUserPath(custom, process.cwd(), env);
  return path.join(homedir, ".openclaw");
}

/** Expand leading `~` or `~/` to the user's home directory. */
export function expandUserPath(
  rawPath: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const trimmed = rawPath.trim();
  if (!trimmed.startsWith("~")) return trimmed;
  const home = env.HOME ?? env.USERPROFILE ?? os.homedir();
  return trimmed.replace(/^~(?=$|[\\/])/u, () => home);
}

/** Expand home directory and resolve relative paths against the provided base. */
export function resolveUserPath(
  rawPath: string,
  baseDir: string = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): string {
  const expanded = expandUserPath(rawPath, env);
  return path.resolve(baseDir, expanded);
}

/**
 * Normalize skill names for lenient comparison (kebab-case, lowercase,
 * underscores to hyphens).
 */
export function normalizeSkillName(raw: string): string {
  return raw.trim().toLowerCase().replace(/_/g, "-");
}

/** Check if a file or directory exists on disk. */
function pathExists(filePath: string): boolean {
  try {
    return existsSync(filePath);
  } catch {
    return false;
  }
}

/** Resolve OpenClaw's shipped bundled skills directory. */
export function resolveOpenClawBundledSkillsDir(
  baseDir: string = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const override = env.OPENCLAW_BUNDLED_SKILLS_DIR?.trim();
  if (override) {
    const resolved = resolveUserPath(override, baseDir, env);
    if (pathExists(resolved)) return resolved;
  }

  const candidateFromBase = path.join(
    baseDir,
    "node_modules",
    "openclaw",
    "skills",
  );
  if (pathExists(candidateFromBase)) return candidateFromBase;

  try {
    const candidateFromModule = fileURLToPath(
      new URL("../../../../../node_modules/openclaw/skills", import.meta.url),
    );
    if (pathExists(candidateFromModule)) return candidateFromModule;
  } catch {
    // ignore URL resolution errors
  }

  return null;
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

/** Strip YAML frontmatter delimiters and headers from SKILL.md content. */
export function stripFrontmatter(content: string): string {
  return parseSkillMarkdown(content).body;
}

/**
 * Create a dedicated skill loader matching OpenClaw's official skill resolution
 * hierarchy (https://docs.openclaw.ai/tools/skills):
 *
 * Priority 1 (highest): Workspace skills (<workspace>/skills) Priority 2:
 * Project agent skills (<workspace>/.agents/skills) Priority 3: Personal agent
 * skills (~/.agents/skills) [default state only] Priority 4: Managed / local
 * skills (<state-dir>/skills) Priority 5: Workshop skills
 * (<state-dir>/agents/<agentId>/agent/workshop-skills) Priority 6: Bundled
 * skills (Kazusa packaged shared/skills + OpenClaw shipped skills) Priority 7
 * (lowest): Extra directories (skills.load.extraDirs) + Plugin skills
 * (openclaw.plugin.json skills) Followed by execution workspace skills (if
 * different from agent workspace) and explicit fallbacks.
 */
export function createSkillLoader(
  options: SkillLoaderOptions = {},
): SkillLoader {
  const contentCache = new Map<string, string>();
  const pathCache = new Map<string, string | null>();

  function collectCandidateRoots(
    context?: SkillResolutionContext,
  ): readonly string[] {
    const baseCwd = context?.cwd ?? options.cwd ?? process.cwd();
    const config = options.config;
    const agentId = context?.agentId ?? options.agentId;
    const env = options.env ?? process.env;
    const home = env.HOME ?? env.USERPROFILE ?? os.homedir();
    const roots: string[] = [];

    // Priority 1 & 2: Workspace skills (highest precedence)
    // 1. <workspace>/skills
    // 2. <workspace>/.agents/skills
    let workspaceDir = context?.workspaceDir ?? options.workspaceDir;
    if (!workspaceDir && agentId && config?.agents?.entries) {
      const configured = config.agents.entries[agentId]?.workspace;
      if (typeof configured === "string" && configured.trim().length > 0) {
        workspaceDir = resolveUserPath(configured, baseCwd, env);
      }
    }
    if (!workspaceDir && config?.agents?.defaults?.workspace) {
      const defaultWorkspace = resolveUserPath(
        config.agents.defaults.workspace,
        baseCwd,
        env,
      );
      workspaceDir = agentId
        ? path.join(defaultWorkspace, agentId)
        : defaultWorkspace;
    }
    if (workspaceDir) {
      roots.push(path.join(workspaceDir, "skills"));
      roots.push(path.join(workspaceDir, ".agents", "skills"));
    }

    // Priority 3: Personal agent skills (~/.agents/skills)
    // In OpenClaw, home-scoped personal skills are only admitted when using default state dir
    if (isDefaultStateDir(env, home)) {
      roots.push(path.join(home, ".agents", "skills"));
    }

    // Priority 4: Managed / local skills (<state-dir>/skills)
    const stateDir = resolveStateDir(env, home);
    roots.push(path.join(stateDir, "skills"));

    // Priority 5: Workshop skills (<state-dir>/agents/<agentId>/agent/workshop-skills)
    if (agentId) {
      roots.push(
        path.join(stateDir, "agents", agentId, "agent", "workshop-skills"),
      );
    }

    // Priority 6: Bundled skills (shipped with install)
    // 6a. Kazusa packaged shared skills (context-conventions, task-lifecycle, etc.)
    roots.push(sharedDir("skills"));

    // 6b. OpenClaw bundled skills
    const openclawBundledDir = resolveOpenClawBundledSkillsDir(baseCwd, env);
    if (openclawBundledDir) {
      roots.push(openclawBundledDir);
    }

    // Priority 7 (lowest): Extra directories & Plugin skills
    // 7a. Extra directories from openclaw.json (skills.load.extraDirs)
    const extraDirs = config?.skills?.load?.extraDirs ?? [];
    for (const dir of extraDirs) {
      if (typeof dir === "string" && dir.trim().length > 0) {
        roots.push(resolveUserPath(dir, baseCwd, env));
      }
    }

    // 7b. Plugin paths (plugins.load.paths & pluginRootDir)
    const pluginPaths: string[] = [];
    const configuredPlugins = config?.plugins?.load?.paths ?? [];
    for (const p of configuredPlugins) {
      if (typeof p === "string" && p.trim().length > 0) {
        pluginPaths.push(resolveUserPath(p, baseCwd, env));
      }
    }
    if (options.pluginRootDir) {
      pluginPaths.push(resolveUserPath(options.pluginRootDir, baseCwd, env));
    }

    for (const pluginDir of pluginPaths) {
      const manifestPath = path.join(pluginDir, "openclaw.plugin.json");
      let foundCustomSkills = false;
      if (existsSync(manifestPath)) {
        try {
          const raw = readFileSync(manifestPath, "utf8");
          const parsed = JSON.parse(raw) as { readonly skills?: unknown };
          if (Array.isArray(parsed.skills)) {
            for (const rel of parsed.skills) {
              if (typeof rel === "string" && rel.trim().length > 0) {
                roots.push(path.resolve(pluginDir, rel));
                foundCustomSkills = true;
              }
            }
          }
        } catch {
          // ignore corrupted manifest and fallback to default skills dir
        }
      }
      if (!foundCustomSkills) {
        roots.push(path.join(pluginDir, "skills"));
      }
    }

    // Execution workspace skills (if different from agent workspace):
    // In OpenClaw, execution workspace skills follow the entire agent catalog in precedence;
    // within the execution workspace, skills/ wins over .agents/skills/
    const executionWorkspaceDir =
      context?.executionWorkspaceDir ?? options.executionWorkspaceDir;
    if (executionWorkspaceDir && executionWorkspaceDir !== workspaceDir) {
      const resolvedExec = resolveUserPath(executionWorkspaceDir, baseCwd, env);
      roots.push(path.join(resolvedExec, "skills"));
      roots.push(path.join(resolvedExec, ".agents", "skills"));
    }

    // User-provided explicit fallback directories (lowest priority)
    if (options.fallbackDirs) {
      for (const fallback of options.fallbackDirs) {
        roots.push(resolveUserPath(fallback, baseCwd, env));
      }
    }

    // Deduplicate while preserving order
    const seen = new Set<string>();
    const deduplicated: string[] = [];
    for (const root of roots) {
      const normalized = path.normalize(root);
      if (!seen.has(normalized)) {
        seen.add(normalized);
        deduplicated.push(normalized);
      }
    }
    return deduplicated;
  }

  async function resolveSkillPath(
    name: string,
    context?: SkillResolutionContext,
  ): Promise<string | null> {
    const roots = collectCandidateRoots(context);
    const cacheKey = `${name}::${roots.join(";")}`;
    if (pathCache.has(cacheKey)) {
      return pathCache.get(cacheKey) ?? null;
    }

    const targetNormalized = normalizeSkillName(name);
    const candidateNames = [
      ...new Set([name, name.replace(/_/g, "-"), name.replace(/-/g, "_")]),
    ];

    for (const root of roots) {
      if (!pathExists(root)) continue;

      // 1. Fast path: Direct subdirectory match (<root>/<candidateName>/SKILL.md)
      for (const candidateName of candidateNames) {
        const directPath = path.join(root, candidateName, "SKILL.md");
        if (pathExists(directPath)) {
          try {
            const raw = await fs.readFile(directPath, "utf8");
            const doc = parseSkillMarkdown(raw);
            const resolvedName = doc.frontmatter?.name
              ? normalizeSkillName(doc.frontmatter.name)
              : normalizeSkillName(candidateName);
            if (resolvedName === targetNormalized) {
              pathCache.set(cacheKey, directPath);
              return directPath;
            }
          } catch {
            // If file cannot be read, continue search
          }
        }
      }

      // 2. Direct root match: <root>/SKILL.md (root itself is the skill)
      const rootSkillPath = path.join(root, "SKILL.md");
      if (pathExists(rootSkillPath)) {
        try {
          const raw = await fs.readFile(rootSkillPath, "utf8");
          const doc = parseSkillMarkdown(raw);
          const resolvedName = doc.frontmatter?.name
            ? normalizeSkillName(doc.frontmatter.name)
            : normalizeSkillName(path.basename(root));
          if (resolvedName === targetNormalized) {
            pathCache.set(cacheKey, rootSkillPath);
            return rootSkillPath;
          }
        } catch {
          // If file cannot be read, continue search
        }
      }

      // 3. Grouped layout: search up to MAX_GROUPED_SKILL_SCAN_DEPTH (6) levels deep.
      // In OpenClaw: "finding SKILL.md ends traversal below that directory".
      try {
        const queue: Array<{ readonly dir: string; readonly depth: number }> = [
          { dir: root, depth: 0 },
        ];

        while (queue.length > 0) {
          const current = queue.shift()!;
          let entries: import("node:fs").Dirent[] = [];
          try {
            entries = await fs.readdir(current.dir, { withFileTypes: true });
          } catch {
            continue;
          }

          // Sort alphabetically for deterministic ordering matching OpenClaw
          entries.sort((a, b) => a.name.localeCompare(b.name, "en"));

          for (const entry of entries) {
            if (
              !entry.isDirectory() ||
              entry.name.startsWith(".") ||
              entry.name === "node_modules"
            ) {
              continue;
            }

            const childDir = path.join(current.dir, entry.name);
            const childSkillPath = path.join(childDir, "SKILL.md");

            if (pathExists(childSkillPath)) {
              // Found SKILL.md: ends traversal below this directory
              try {
                const raw = await fs.readFile(childSkillPath, "utf8");
                const doc = parseSkillMarkdown(raw);
                const resolvedName = doc.frontmatter?.name
                  ? normalizeSkillName(doc.frontmatter.name)
                  : normalizeSkillName(entry.name);
                if (resolvedName === targetNormalized) {
                  pathCache.set(cacheKey, childSkillPath);
                  return childSkillPath;
                }
              } catch {
                // If invalid or unreadable, continue siblings
              }
            } else if (current.depth + 1 < MAX_GROUPED_SKILL_SCAN_DEPTH) {
              queue.push({ dir: childDir, depth: current.depth + 1 });
            }
          }
        }
      } catch {
        // Skip unreadable roots
      }
    }

    pathCache.set(cacheKey, null);
    return null;
  }

  async function loadSkill(
    name: string,
    context?: SkillResolutionContext,
  ): Promise<string> {
    const resolvedPath = await resolveSkillPath(name, context);
    if (!resolvedPath) {
      const roots = collectCandidateRoots(context);
      throw new Error(
        `Kazusa skill "${name}" could not be resolved from candidate roots:\n  ${roots.join("\n  ")}`,
      );
    }

    if (contentCache.has(resolvedPath)) {
      return contentCache.get(resolvedPath)!;
    }

    const raw = await fs.readFile(resolvedPath, "utf8");
    const stripped = stripFrontmatter(raw);
    contentCache.set(resolvedPath, stripped);
    return stripped;
  }

  async function loadSkillDocument(
    name: string,
    context?: SkillResolutionContext,
  ): Promise<ParsedSkillDocument> {
    const resolvedPath = await resolveSkillPath(name, context);
    if (!resolvedPath) {
      const roots = collectCandidateRoots(context);
      throw new Error(
        `Kazusa skill "${name}" could not be resolved from candidate roots:\n  ${roots.join("\n  ")}`,
      );
    }
    const raw = await fs.readFile(resolvedPath, "utf8");
    return parseSkillMarkdown(raw);
  }

  function clearCache(): void {
    contentCache.clear();
    pathCache.clear();
  }

  return {
    loadSkill,
    loadSkillDocument,
    resolveSkillPath,
    getCandidateRoots: (ctx) => collectCandidateRoots(ctx),
    clearCache,
  };
}
