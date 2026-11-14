import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";

/**
 * The live world is a plain git clone of its creator's repository (the kazusa
 * skill's `references/worlds.md` §4.5): `play` points at the creator's commit
 * the world stands on, and the game is the uncommitted changes on top. A world
 * update reads the release it takes and that commit (the base) from git, keeps
 * the game as it was in git's stash, merges, and moves `play` to the release.
 */
export const PLAY = "play";
/** A release is a version tag (`v0.4.0` or `0.4.0`). */
const RELEASE_TAG = /^v?\d+(\.\d+)*$/;

/** Runs git in the world; stdout as bytes, or a thrown error with stderr. */
export type Git = (
  args: readonly string[],
  options?: { readonly input?: string | Buffer; readonly index?: string },
) => Buffer;

/**
 * What git would act on from the environment around it, as
 * `scripts/world-repo.mjs` guards it: an inherited one could point git at
 * another repository or wait for a person.
 */
const GUARDED_ENV = /^(GIT_.*|EDITOR|VISUAL|PAGER|PREFIX|SSH_ASKPASS)$/i;

/**
 * Git as `scripts/world-repo.mjs` runs it (`findGit`): the one shipped beside
 * Kazusa when there is one, else the system's; never a system-wide config;
 * pinned to the world's own repository; paths taken literally (a picture called
 * `happy[2].webp` is a name, not a pattern). Undefined without git or a
 * repository.
 */
export function gitIn(live: string): Git | undefined {
  if (!existsSync(path.join(live, ".git"))) return undefined;
  const root = path.resolve(live, "..", "..", "..");
  const shipped = path.join(root, "git");
  const env: NodeJS.ProcessEnv = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !GUARDED_ENV.test(key)),
  );
  Object.assign(env, {
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    GIT_DIR: path.join(live, ".git"),
    GIT_WORK_TREE: live,
    GIT_LITERAL_PATHSPECS: "1",
  });
  let binary = "git";
  if (existsSync(shipped)) {
    if (process.platform === "win32") {
      const key =
        Object.keys(env).find((name) => name.toUpperCase() === "PATH") ??
        "PATH";
      env[key] = [
        path.join(shipped, "ucrt64/bin"),
        path.join(shipped, "usr/bin"),
        env[key] ?? "",
      ].join(path.delimiter);
      env.GIT_EXEC_PATH = path.join(shipped, "ucrt64/libexec/git-core");
      binary = path.join(shipped, "cmd/git.exe");
    } else {
      env.GIT_EXEC_PATH = path.join(shipped, "libexec/git-core");
      env.GIT_TEMPLATE_DIR = path.join(shipped, "share/git-core/templates");
      binary = path.join(shipped, "bin/git");
    }
  }
  const git: Git = (args, options = {}) =>
    execFileSync(binary, args, {
      cwd: live,
      env: options.index ? { ...env, GIT_INDEX_FILE: options.index } : env,
      input: options.input,
      maxBuffer: 1024 * 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
    });
  try {
    git(["rev-parse", "--git-dir"]);
    return git;
  } catch {
    return undefined;
  }
}

/** `git …` as trimmed text. */
export const text = (git: Git, args: readonly string[]): string =>
  git(args).toString("utf8").trim();

/** The commit `ref` names, or undefined when there's none. */
export function commitOf(git: Git, ref: string): string | undefined {
  try {
    return text(git, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
  } catch {
    return undefined;
  }
}

/** Whether `ancestor` is in `of`'s history (or is it). */
export function contains(git: Git, of: string, ancestor: string): boolean {
  try {
    git(["merge-base", "--is-ancestor", ancestor, of]);
    return true;
  } catch {
    return false;
  }
}

/** A version tag's release: its commit, notes (its message) and date. */
export interface Release {
  readonly tag: string;
  readonly version: string;
  readonly commit: string;
  readonly notes: string | null;
  readonly date: string | null;
  /** Its page on GitHub, for the notes in full; null off GitHub. */
  readonly url: string | null;
}

function releaseUrl(git: Git, tag: string): string | null {
  let url = "";
  try {
    url = text(git, ["remote", "get-url", "origin"]);
  } catch {
    return null;
  }
  const repo = /github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?\/?$/.exec(url)?.[1];
  return repo
    ? `https://github.com/${repo}/releases/tag/${encodeURIComponent(tag)}`
    : null;
}

/** Positive when version tag `a` is newer than `b`, by number. */
function compareTags(a: string, b: string): number {
  const parts = (tag: string) =>
    tag
      .replace(/^v/, "")
      .split(".")
      .map((part) => Number.parseInt(part, 10) || 0);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const diff = (x[i] ?? 0) - (y[i] ?? 0);
    if (diff) return diff;
  }
  return 0;
}

/**
 * The newest release downloaded (Settings → Updates → World) that the world
 * hasn't taken: the highest local version tag, unless `play` already has it.
 */
export function downloadedRelease(git: Git): Release | undefined {
  let listed = "";
  try {
    listed = text(git, [
      "for-each-ref",
      "--format=%(refname:short)%00%(creatordate:iso-strict)",
      "refs/tags/",
    ]);
  } catch {
    return undefined;
  }
  const [newest] = listed
    .split("\n")
    .map((line) => line.split("\0") as [string, string?])
    .filter(([tag]) => RELEASE_TAG.test(tag))
    .sort(([a], [b]) => compareTags(b, a));
  if (!newest) return undefined;
  const [tag, date] = newest;
  const commit = commitOf(git, `refs/tags/${tag}`);
  const head = commitOf(git, PLAY);
  if (!commit || (head && contains(git, head, commit))) return undefined;
  let notes: string | null = null;
  try {
    notes = text(git, ["tag", "--list", tag, "--format=%(contents)"]) || null;
  } catch {
    // A tag without a message: no notes.
  }
  return {
    tag,
    version: tag.replace(/^v/, ""),
    commit,
    notes,
    date: date || null,
    url: releaseUrl(git, tag),
  };
}

/** The world's version: the release tag `play` is on, if it's on one. */
export function versionOf(git: Git): string | undefined {
  try {
    const tag = text(git, ["describe", "--tags", "--exact-match", PLAY]);
    return RELEASE_TAG.test(tag) ? tag.replace(/^v/, "") : undefined;
  } catch {
    return undefined;
  }
}

const WORLD_FILE = /^(shared|workspaces)\/|^package\.json$/;
const SKIPPED = /(^|\/)\.DS_Store$|\.tmp$/;

/**
 * A commit's world files (`shared/`, `workspaces/`, `package.json`), each with
 * its blob id. Links and submodules aren't files a world update touches, and a
 * path that climbs out of the world (`..`) is refused.
 */
export function filesAt(git: Git, commit: string): Map<string, string> {
  const files = new Map<string, string>();
  for (const entry of git(["ls-tree", "-r", "-z", "--full-tree", commit])
    .toString("utf8")
    .split("\0")) {
    const tab = entry.indexOf("\t");
    if (tab < 0) continue;
    const [mode, type, id] = entry.slice(0, tab).split(" ");
    const file = entry.slice(tab + 1);
    if (type !== "blob" || mode === "120000") continue;
    if (file.split("/").includes("..")) continue;
    if (WORLD_FILE.test(file) && !SKIPPED.test(file)) files.set(file, id!);
  }
  return files;
}

/** Git's id for a file's bytes, so a file on disk compares with a commit's. */
export const blobId = (data: Buffer): string =>
  createHash("sha1").update(`blob ${data.length}\0`).update(data).digest("hex");

/** The bytes of many blobs at once (`cat-file --batch`), by id. */
export function readBlobs(
  git: Git,
  ids: readonly string[],
): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  const unique = [...new Set(ids)];
  for (let start = 0; start < unique.length; start += 2000) {
    const chunk = unique.slice(start, start + 2000);
    const batch = git(["cat-file", "--batch"], {
      input: `${chunk.join("\n")}\n`,
    });
    let at = 0;
    for (const id of chunk) {
      const header = batch.indexOf(0x0a, at);
      const size = Number(batch.subarray(at, header).toString().split(" ")[2]);
      out.set(id, batch.subarray(header + 1, header + 1 + size));
      at = header + 1 + size + 1;
    }
  }
  return out;
}

/** Copies `files` from a commit into the world, as they are there. */
export function copyFiles(
  git: Git,
  commit: string,
  files: readonly string[],
): void {
  if (!files.length) return;
  git(
    [
      "restore",
      `--source=${commit}`,
      "--worktree",
      "--pathspec-from-file=-",
      "--pathspec-file-nul",
    ],
    { input: files.join("\0") },
  );
}

/**
 * Keeps the world as it is in git's stash, before an update changes it: the
 * recovery point (`git stash list`, `git stash apply`), with no file touched.
 * Every world file goes in, untracked ones included, as git's exclude rules
 * say. `onto` is what it's kept against when the world has no history yet (the
 * release it's about to take).
 */
export function keepInStash(
  git: Git,
  live: string,
  message: string,
  onto: string,
): string {
  const head = commitOf(git, PLAY) ?? onto;
  const index = path.join(live, ".git", "kazusa-stash-index");
  rmSync(index, { force: true });
  let world: string;
  try {
    git(["read-tree", head], { index });
    git(["add", "--all"], { index });
    world = git(["write-tree"], { index }).toString("utf8").trim();
  } finally {
    rmSync(index, { force: true });
  }
  // Git's own stash shape: the world, with `play` and an index commit as
  // parents, so `git stash` lists, shows and applies it.
  const indexCommit = text(git, [
    "commit-tree",
    `${head}^{tree}`,
    "-p",
    head,
    "-m",
    `index on ${PLAY}`,
  ]);
  const stash = text(git, [
    "commit-tree",
    world,
    "-p",
    head,
    "-p",
    indexCommit,
    "-m",
    message,
  ]);
  git(["stash", "store", "-m", message, stash]);
  return stash;
}

/**
 * Moves `play` to `commit` with the index there, the files untouched: what
 * differs from it is the game again.
 */
export function standOn(git: Git, commit: string): void {
  git(["update-ref", `refs/heads/${PLAY}`, commit]);
  git(["read-tree", commit]);
}
