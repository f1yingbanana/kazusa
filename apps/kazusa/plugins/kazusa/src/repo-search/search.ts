import { existsSync, readFileSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

/**
 * Never searched: dependencies, history and build output; the client's asset
 * cache and update backups (copies of the world); and a world update's text of
 * both versions (`world-update`, and `.template` from before), copies of every
 * page, unless asked for by `path`. Runtime state in `.state` is searched, but
 * its databases are binary and so skipped.
 */
const SKIP_DIRS = new Set([
  ".template",
  "world-update",
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "coverage",
  ".turbo",
  ".cache",
  "control-ui-assets",
  "backups",
]);
/** Never searched: secrets, databases, logs. */
const SKIP_FILE =
  /^\.env(\..*)?$|\.(pem|key|p12|sqlite\d?|sqlite-(wal|shm)|db|log|lock)$|^\.DS_Store$/;
const MAX_FILE_BYTES = 2_000_000;
const MAX_LINE_CHARS = 240;
const BATCH = 64;

export interface GrepOptions {
  /** A regular expression; literal text when it isn't a valid one. */
  readonly pattern: string;
  readonly ignoreCase?: boolean;
  /** A folder or file to search, relative to `from`; defaults to `from` itself. */
  readonly path?: string;
  /**
   * Which files: a name glob (`*.md`, `SKILL.md`), or a path glob where `**`
   * spans folders.
   */
  readonly glob?: string;
  readonly maxResults?: number;
}

export interface GrepMatch {
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

export interface GrepResult {
  readonly matches: readonly GrepMatch[];
  /** Every matching line, including those past `maxResults`. */
  readonly total: number;
  readonly files: number;
}

/** The checkout's root: the nearest folder above whose package is `kazusa`. */
export function findRepoRoot(start: string): string | undefined {
  for (let dir = path.resolve(start); ; dir = path.dirname(dir)) {
    const file = path.join(dir, "package.json");
    if (existsSync(file)) {
      try {
        if (
          (JSON.parse(readFileSync(file, "utf8")) as { name?: unknown })
            .name === "kazusa"
        )
          return dir;
      } catch {
        // Not ours; keep climbing.
      }
    }
    if (path.dirname(dir) === dir) return undefined;
  }
}

function globToRegExp(glob: string): RegExp {
  let source = "";
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i];
    if (char === "*" && glob[i + 1] === "*") {
      source += ".*";
      i++;
      if (glob[i + 1] === "/") i++;
    } else if (char === "*") source += "[^/]*";
    else if (char === "?") source += "[^/]";
    else source += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${source}$`);
}

async function filesUnder(base: string, start: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) await walk(full);
      } else if (entry.isFile() && !SKIP_FILE.test(entry.name)) {
        out.push(path.relative(base, full).split(path.sep).join("/"));
      }
    }
  };
  const info = await stat(start);
  if (info.isFile()) {
    if (!SKIP_FILE.test(path.basename(start)))
      out.push(path.relative(base, start).split(path.sep).join("/"));
  } else await walk(start);
  return out.sort();
}

/**
 * Searches text files line by line. Read-only, confined to `root` (the
 * repository), and blind to secrets, runtime state and dependencies. Paths in
 * and out are relative to `from`, where the caller's other file tools start.
 */
export async function grepRepo(
  root: string,
  from: string,
  options: GrepOptions,
): Promise<GrepResult> {
  const start = path.resolve(from, options.path ?? ".");
  const relative = path.relative(root, start);
  if (relative.startsWith("..") || path.isAbsolute(relative))
    throw new Error("path must stay inside the Kazusa repository.");
  if (!existsSync(start)) throw new Error(`Nothing at ${options.path}.`);
  const flags = options.ignoreCase === false ? "" : "i";
  let pattern: RegExp;
  try {
    pattern = new RegExp(options.pattern, flags);
  } catch {
    pattern = new RegExp(
      options.pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      flags,
    );
  }
  const glob = options.glob ? globToRegExp(options.glob) : undefined;
  const wanted = (file: string) =>
    !glob ||
    glob.test(options.glob!.includes("/") ? file : path.posix.basename(file));
  const limit = Math.min(Math.max(options.maxResults ?? 100, 1), 500);

  const files = (await filesUnder(from, start)).filter(wanted);
  const matches: GrepMatch[] = [];
  let total = 0;
  for (let i = 0; i < files.length; i += BATCH) {
    const batch = files.slice(i, i + BATCH);
    const texts = await Promise.all(
      batch.map(async (file) => {
        const full = path.resolve(from, file);
        if ((await stat(full)).size > MAX_FILE_BYTES) return undefined;
        const data = await readFile(full);
        return data.subarray(0, 8000).includes(0)
          ? undefined
          : data.toString("utf8");
      }),
    );
    batch.forEach((file, index) => {
      const text = texts[index];
      if (text === undefined) return;
      text.split(/\r?\n/).forEach((line, number) => {
        if (!pattern.test(line.slice(0, 2000))) return;
        total++;
        if (matches.length < limit)
          matches.push({
            file,
            line: number + 1,
            text: line.trim().slice(0, MAX_LINE_CHARS),
          });
      });
    });
  }
  return { matches, total, files: files.length };
}
