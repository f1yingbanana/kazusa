import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

/** OpenClaw's file tools and where each names its paths. */
const PATH_TOOLS = new Set(["read", "write", "edit", "ls", "view_image"]);
export const FILE_TOOLS = new Set([...PATH_TOOLS, "apply_patch"]);
const PATCH_FILE = /^\*\*\* (?:(?:Add|Update|Delete) File|Move to): (.+)$/gm;
const SECRET = /^\.env(\..*)?$/;

export type GuardRefusal =
  | { readonly result: "outside-repository"; readonly path: string }
  | { readonly result: "secret-file"; readonly path: string };

function pathsOf(tool: string, params: Record<string, unknown>): string[] {
  if (tool === "apply_patch") {
    const input = typeof params.input === "string" ? params.input : "";
    return [...input.matchAll(PATCH_FILE)].map((match) => match[1].trim());
  }
  if (!PATH_TOOLS.has(tool)) return [];
  const value = params.path ?? params.file_path ?? params.filePath;
  if (typeof value !== "string" || !value.trim())
    return tool === "ls" ? ["."] : [];
  // A picture from the web isn't a file.
  if (tool === "view_image" && /^(https?|data):/i.test(value)) return [];
  return [value];
}

/** The real path, following links in whatever part of it already exists. */
function realish(full: string): string {
  const missing: string[] = [];
  let at = full;
  while (!existsSync(at)) {
    const parent = path.dirname(at);
    if (parent === at) break;
    missing.unshift(path.basename(at));
    at = parent;
  }
  return path.join(realpathSync(at), ...missing);
}

/**
 * Whether a file tool call stays inside the repository and away from secrets.
 * Paths resolve against the agent's working directory, as the tools resolve
 * them, and through links, so a link can't lead outside.
 */
export function refusal(
  tool: string,
  params: Record<string, unknown>,
  cwd: string,
  root: string,
): GuardRefusal | undefined {
  const repo = realpathSync(root);
  for (const raw of pathsOf(tool, params)) {
    const expanded =
      raw === "~" || raw.startsWith("~/")
        ? path.join(homedir(), raw.slice(1))
        : raw;
    const full = realish(path.resolve(cwd, expanded));
    const relative = path.relative(repo, full);
    if (relative.startsWith("..") || path.isAbsolute(relative))
      return { result: "outside-repository", path: raw };
    if (SECRET.test(path.basename(full)))
      return { result: "secret-file", path: raw };
  }
  return undefined;
}
