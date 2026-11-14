import path from "node:path";
import { fileURLToPath } from "node:url";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { z } from "zod";
import { pluginSkillText } from "../skill-text.ts";
import { currentConfig } from "../current-config.ts";
import { FILE_TOOLS, refusal } from "./guard.ts";
import { findRepoRoot, grepRepo } from "./search.ts";

const PARAMS = z.object({
  pattern: z.string().min(1),
  ignoreCase: z.boolean().optional(),
  path: z.string().min(1).optional(),
  glob: z.string().min(1).optional(),
  maxResults: z.number().int().min(1).max(500).optional(),
});

/**
 * `grep`: search the Kazusa repository's text files. Administrative,
 * allowlisted for the system agent only, read-only, and never outside the
 * repository. And the same boundary for OpenClaw's own file tools, which
 * otherwise reach as far as the Gateway process can: every agent's `read`,
 * `write`, `edit`, `ls`, `view_image` and `apply_patch` stay inside the
 * repository and away from `.env` files.
 */
const pathsUnchecked = (tool: string): boolean => FILE_TOOLS.has(tool);

export function registerRepoSearch(api: OpenClawPluginApi): void {
  const root = () => {
    const found =
      findRepoRoot(process.cwd()) ??
      findRepoRoot(path.dirname(fileURLToPath(import.meta.url)));
    if (!found) throw new Error("Can't find the Kazusa repository to search.");
    return found;
  };
  const text = pluginSkillText(api);
  /** Where an agent's file tools start: its `cwd`, else its workspace. */
  const cwdOf = (agentId: string | undefined): string => {
    const config = currentConfig(api);
    const entry = agentId ? config.agents?.entries?.[agentId] : undefined;
    const configured = entry?.cwd ?? config.agents?.defaults?.cwd;
    if (configured) return path.resolve(configured);
    return agentId
      ? api.runtime.agent.resolveAgentWorkspaceDir(config, agentId)
      : process.cwd();
  };
  api.on("before_tool_call", (event, ctx) => {
    const params: Record<string, unknown> = event.params ?? {};
    let refused: ReturnType<typeof refusal>;
    try {
      refused = refusal(event.toolName, params, cwdOf(ctx.agentId), root());
    } catch {
      // No repository to measure against: refuse rather than reach anywhere.
      refused = pathsUnchecked(event.toolName)
        ? {
            result: "outside-repository",
            path: typeof params.path === "string" ? params.path : "that path",
          }
        : undefined;
    }
    if (!refused) return;
    return {
      block: true,
      blockReason: text(
        `kazusa-results#${refused.result}`,
        { path: refused.path },
        ctx.agentId ? { agentId: ctx.agentId } : {},
      ),
    };
  });
  api.registerTool({
    name: "grep",
    label: "Grep",
    description:
      "Search text files for a word or pattern, line by line. Starts in this world; `path` searches elsewhere in the Kazusa repository (`.` for this world, `../../..` for Kazusa's own code and guides, never outside the repository). `glob` limits which files (`*.md`, or a path glob where `**` spans folders). `pattern` is a regular expression (`a|b`, `\\bword\\b`), or literal text when it isn't a valid one; case-insensitive unless `ignoreCase` is false. Skips secrets, databases, dependencies and worlds set aside in `old-worlds`. Paths come back as your other file tools take them.",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string" },
        ignoreCase: { type: "boolean" },
        path: { type: "string" },
        glob: { type: "string" },
        maxResults: { type: "integer", minimum: 1, maximum: 500 },
      },
      required: ["pattern"],
      additionalProperties: false,
    },
    async execute(_id: string, input: unknown) {
      const options = PARAMS.parse(input);
      const result = await grepRepo(root(), process.cwd(), options);
      const lines = result.matches.map(
        ({ file, line, text }) => `${file}:${line}: ${text}`,
      );
      const more = result.total - result.matches.length;
      const text = [
        `${result.total} matching lines in ${result.files} files searched.`,
        ...lines,
        ...(more > 0 ? [`…and ${more} more; narrow with path or glob.`] : []),
      ].join("\n");
      return { content: [{ type: "text" as const, text }], details: result };
    },
  });
}
