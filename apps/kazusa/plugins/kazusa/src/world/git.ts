import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Running git for the world, the one way everything does: the plugin
 * (`world_update`, the Ready signal), `scripts/world.mjs` (setup's clone, the
 * check, the download), `scripts/dev.mjs` and the frontend. Node builtins only,
 * so plain Node scripts import it as it is.
 */

/** Runs git; stdout as bytes, or a thrown error carrying git's stderr. */
export type Git = (
  args: readonly string[],
  options?: { readonly input?: string | Buffer; readonly index?: string },
) => Buffer;

/** Which git, and the environment it runs in. */
export interface GitBinary {
  readonly binary: string;
  readonly env: NodeJS.ProcessEnv;
}

/**
 * What git would act on from the environment around it: an inherited one could
 * point it at another repository or wait for a person. None is passed on.
 */
const GUARDED_ENV = /^(GIT_.*|EDITOR|VISUAL|PAGER|PREFIX|SSH_ASKPASS)$/i;

const found = new Map<string, GitBinary | undefined>();

/**
 * The git beside Kazusa (`git/` under `root`, GitHub Desktop's portable build)
 * when there is one, else the system's; undefined without. Without the
 * developer tools, macOS's `/usr/bin/git` only offers to install them, so that
 * counts as none. Never a system-wide config, never a prompt.
 */
export function findGit(
  root: string,
  platform: NodeJS.Platform = process.platform,
): GitBinary | undefined {
  const key = `${platform}:${root}`;
  if (found.has(key)) return found.get(key);
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const name of Object.keys(env))
    if (GUARDED_ENV.test(name)) delete env[name];
  env.GIT_CONFIG_NOSYSTEM = "1";
  env.GIT_TERMINAL_PROMPT = "0";
  let result: GitBinary | undefined;
  const shipped = path.join(root, "git");
  if (existsSync(shipped)) {
    if (platform === "win32") {
      const pathKey =
        Object.keys(env).find((name) => name.toUpperCase() === "PATH") ??
        "PATH";
      env[pathKey] = [
        path.join(shipped, "ucrt64/bin"),
        path.join(shipped, "usr/bin"),
        env[pathKey] ?? "",
      ].join(path.delimiter);
      env.GIT_EXEC_PATH = path.join(shipped, "ucrt64/libexec/git-core");
      result = { binary: path.join(shipped, "cmd/git.exe"), env };
    } else {
      env.GIT_EXEC_PATH = path.join(shipped, "libexec/git-core");
      env.GIT_TEMPLATE_DIR = path.join(shipped, "share/git-core/templates");
      result = { binary: path.join(shipped, "bin/git"), env };
    }
  } else {
    try {
      if (platform === "darwin")
        execFileSync("xcode-select", ["-p"], { stdio: "ignore" });
      execFileSync("git", ["--version"], { env, stdio: "ignore" });
      result = { binary: "git", env };
    } catch {
      result = undefined;
    }
  }
  found.set(key, result);
  return result;
}

/** The environment that pins git to one repository: `dir`'s own. */
function pinnedTo(bin: GitBinary, dir: string): NodeJS.ProcessEnv {
  return {
    ...bin.env,
    GIT_DIR: path.join(dir, ".git"),
    GIT_WORK_TREE: dir,
    // A picture called `happy[2].webp` is a name, not a pattern.
    GIT_LITERAL_PATHSPECS: "1",
  };
}

/**
 * Git pinned to the repository in `dir`, whatever the folders around it are: a
 * half-made `dir/.git` fails rather than finding an enclosing repository.
 * `index` runs a command against a temporary index instead of the real one.
 */
export function repoGit(bin: GitBinary, dir: string): Git {
  const env = pinnedTo(bin, dir);
  return (args, options = {}) =>
    execFileSync(bin.binary, args, {
      cwd: dir,
      env: options.index ? { ...env, GIT_INDEX_FILE: options.index } : env,
      input: options.input,
      maxBuffer: 1024 * 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
    });
}

/** Git outside any repository, for what only names a URL (`ls-remote`). */
export function plainGit(bin: GitBinary): Git {
  return (args, options = {}) =>
    execFileSync(bin.binary, args, {
      cwd: tmpdir(),
      env: bin.env,
      input: options.input,
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
    });
}

/** `git …` as trimmed text. */
export const text = (
  git: Git,
  args: readonly string[],
  options?: Parameters<Git>[1],
): string => git(args, options).toString("utf8").trim();

/** A long command's progress as one bar: its stage and how far overall. */
export interface GitProgress {
  readonly stage: string;
  readonly percent: number;
}

/**
 * How much of a download each of git's `--progress` stages is: receiving the
 * objects is most of it, then resolving their deltas and writing the files. The
 * server's own counting and compressing come first and count as nothing.
 */
const STAGES: readonly (readonly [RegExp, string, number, number])[] = [
  [/^Receiving objects/, "receiving", 0, 85],
  [/^Resolving deltas/, "resolving", 85, 92],
  [/^(Updating|Checking out) files/, "updating", 92, 100],
];
const PROGRESS = /^(?:remote: )?([A-Za-z ]+):\s+(\d+)%/;

/**
 * Runs a long git command (`clone`, `fetch`) with `--progress`, reporting one
 * bar a few times a second and at each stage's end. `repo` pins it to that
 * repository; without, it runs in `cwd`. Rejects with git's error, its progress
 * lines left out.
 */
export function streamGit(
  bin: GitBinary,
  args: readonly string[],
  options: {
    readonly cwd: string;
    readonly repo?: string;
    readonly onProgress?: (progress: GitProgress) => void;
  },
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin.binary, args, {
      cwd: options.cwd,
      env: options.repo ? pinnedTo(bin, options.repo) : bin.env,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let percent = 0;
    let reported = 0;
    let pending = "";
    const messages: string[] = [];
    const line = (raw: string) => {
      const entry = raw.trim();
      if (!entry) return;
      const match = PROGRESS.exec(entry);
      if (!match) {
        if (!/^Cloning into /.test(entry)) messages.push(entry);
        return;
      }
      const stage = STAGES.find(([pattern]) => pattern.test(match[1]));
      const done = Number(match[2]);
      const next = stage
        ? Math.round(stage[2] + ((stage[3] - stage[2]) * done) / 100)
        : percent;
      // Stages restart at 0; the bar never goes back.
      percent = Math.max(percent, next);
      if (!options.onProgress) return;
      if (Date.now() - reported < 250 && done !== 100) return;
      reported = Date.now();
      options.onProgress({ stage: stage ? stage[1] : "preparing", percent });
    };
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      const parts = (pending + chunk).split(/[\r\n]/);
      pending = parts.pop() ?? "";
      parts.forEach(line);
    });
    child.once("error", reject);
    child.once("close", (code) => {
      line(pending);
      if (code === 0) resolve();
      else
        reject(
          new Error(messages.join(" ") || `git ${args[0]} failed (${code}).`),
        );
    });
  });
}
