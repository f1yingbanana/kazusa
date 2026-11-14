import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import {
  findGit,
  plainGit,
  repoGit,
  streamGit,
  text,
  type Git,
  type GitBinary,
  type GitProgress,
} from "./git.ts";

/**
 * The live world is a plain git clone of its creator's repository (the kazusa
 * skill's `references/worlds.md` §4.5): `play` points at the creator's commit
 * the world stands on, and the game is the uncommitted changes on top. A
 * release is a version tag. Nothing of Kazusa's sits beside git's own pieces
 * but the saves an update makes (`refs/saves/*`).
 */
export const PLAY = "play";
/** A release is a tag named for its version: `v0.4.0` or `0.4.0`. */
export const RELEASE_TAG = /^v?\d+(\.\d+)*$/;

/** Dotted numbers, by number; a suffix such as `-beta` is ignored. */
export function compareVersions(a: string, b: string): number {
  const parts = (version: string) =>
    version
      .replace(/^v/, "")
      .split(/[-+]/)[0]
      .split(".")
      .map((part) => Number.parseInt(part, 10) || 0);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const diff = (x[i] ?? 0) - (y[i] ?? 0);
    if (diff) return Math.sign(diff);
  }
  return 0;
}

// ------------------------------------------------------------- the clone

/** Every world repository's own settings (worlds.md §4.5). */
const CONFIG: readonly (readonly [string, string])[] = [
  ["core.autocrlf", "false"],
  ["core.longpaths", "true"],
  ["core.quotePath", "false"],
  ["fetch.fsckObjects", "true"],
  ["commit.gpgSign", "false"],
  ["tag.gpgSign", "false"],
  ["user.name", "Kazusa"],
  ["user.email", "kazusa@localhost"],
];
/**
 * What the clone tracks: the creator's files. `openclaw.json` (this machine's
 * config) and `.state/` (databases) are local; a save adds them explicitly.
 */
const EXCLUDE = `# Written when the world was cloned.
/*
!/package.json
!/shared/
!/workspaces/
# The system agent's link to the app's own skills (a junction on Windows).
/workspaces/*/.agents
.DS_Store
*.tmp
`;
// No delta between SQLite versions exists to find (worlds.md §4.6).
const ATTRIBUTES = "*.sqlite binary -delta\n";

/** Kazusa's root, from the live world's folder (`apps/kazusa/world`). */
const kazusaRoot = (world: string) => path.resolve(world, "..", "..", "..");

/**
 * Whether `world` is a clone of its creator's repository, as setup makes every
 * world. An older Kazusa's world isn't, and doesn't run (worlds.md §3). Reads
 * the config file, so it needs no git.
 */
export function isClone(world: string): boolean {
  try {
    return /^\[remote "origin"\]/m.test(
      readFileSync(path.join(world, ".git/config"), "utf8"),
    );
  } catch {
    return false;
  }
}

/** Git pinned to the live world's repository; undefined without git or one. */
export function worldGit(world: string): Git | undefined {
  if (!existsSync(path.join(world, ".git"))) return undefined;
  const bin = findGit(kazusaRoot(world));
  if (!bin) return undefined;
  const git = repoGit(bin, world);
  try {
    git(["rev-parse", "--git-dir"]);
    return git;
  } catch {
    return undefined;
  }
}

/**
 * Setup's download: `url` cloned at `tag` (its newest release) into `into`,
 * `play` at that commit, with every world repository's settings. Nothing else
 * comes down: later releases arrive only through `fetchRelease`.
 */
export async function cloneRelease(
  bin: GitBinary,
  url: string,
  tag: string | undefined,
  into: string,
  onProgress?: (progress: GitProgress) => void,
): Promise<void> {
  await streamGit(
    bin,
    [
      "-c",
      "http.lowSpeedLimit=1000",
      "-c",
      "http.lowSpeedTime=60",
      "clone",
      "--progress",
      // The release and its history only: no branch, no other tag, nothing
      // the creator hasn't released.
      "--single-branch",
      "--no-tags",
      ...CONFIG.flatMap(([key, value]) => ["-c", `${key}=${value}`]),
      ...(tag ? ["--branch", tag] : []),
      url,
      path.basename(into),
    ],
    { cwd: path.dirname(into), onProgress },
  );
  const git = repoGit(bin, into);
  git(["checkout", "--quiet", "-B", PLAY]);
  for (const [key, value] of CONFIG) git(["config", key, value]);
  mkdirSync(path.join(into, ".git/info"), { recursive: true });
  writeFileSync(path.join(into, ".git/info/exclude"), EXCLUDE);
  writeFileSync(path.join(into, ".git/info/attributes"), ATTRIBUTES);
}

/**
 * Downloads a release into the world: its tag, nothing else, with a minimum
 * speed so a stalled download fails. Nothing in the world changes.
 */
export function fetchRelease(
  bin: GitBinary,
  world: string,
  url: string,
  tag: string,
  onProgress?: (progress: GitProgress) => void,
): Promise<void> {
  return streamGit(
    bin,
    [
      "-c",
      "http.lowSpeedLimit=1000",
      "-c",
      "http.lowSpeedTime=60",
      "fetch",
      "--progress",
      "--no-tags",
      url,
      `+refs/tags/${tag}:refs/tags/${tag}`,
    ],
    { cwd: world, repo: world, onProgress },
  );
}

// -------------------------------------------------------------- releases

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

/** Where the world comes from: its `origin`. */
export function originOf(git: Git): string | undefined {
  try {
    return text(git, ["remote", "get-url", "origin"]) || undefined;
  } catch {
    return undefined;
  }
}

/** `owner/name` of a repository on GitHub. */
export const githubRepo = (url: string): string | undefined =>
  /github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?\/?$/.exec(url)?.[1];

/** A release's page on GitHub, for its notes in full; null off GitHub. */
export function releasePage(url: string, tag: string): string | null {
  const repo = githubRepo(url);
  return repo
    ? `https://github.com/${repo}/releases/tag/${encodeURIComponent(tag)}`
    : null;
}

/** A version tag and the commit it names. */
export interface Release {
  readonly tag: string;
  readonly version: string;
  readonly commit: string;
}

/** A release downloaded into the world: with its notes (the tag's message). */
export interface DownloadedRelease extends Release {
  readonly notes: string | null;
  readonly date: string | null;
  /** Its page on GitHub; null off GitHub. */
  readonly url: string | null;
}

const newest = <T extends { readonly tag: string }>(
  releases: Iterable<T>,
): T | undefined =>
  [...releases].sort((a, b) => compareVersions(b.tag, a.tag))[0];

/** The newest release on a remote, by `ls-remote`: nothing downloaded. */
export function newestRemoteRelease(
  bin: GitBinary,
  url: string,
): Release | undefined {
  const tags = new Map<string, { tag: string; commit: string }>();
  for (const line of text(plainGit(bin), ["ls-remote", "--tags", url]).split(
    "\n",
  )) {
    const [sha, ref] = line.split("\t");
    const match = /^refs\/tags\/(.+?)(\^\{\})?$/.exec(ref ?? "");
    if (!sha || !match || !RELEASE_TAG.test(match[1])) continue;
    const entry = tags.get(match[1]) ?? { tag: match[1], commit: sha };
    // An annotated tag's own id first, then the commit it names.
    if (match[2]) entry.commit = sha;
    tags.set(match[1], entry);
  }
  const release = newest(tags.values());
  return release && { ...release, version: release.tag.replace(/^v/, "") };
}

/**
 * Whether `release` is downloaded: its tag is here and names its commit. The
 * one test of it, for the check and for `world_update`.
 */
export const isDownloaded = (git: Git, release: Release): boolean =>
  commitOf(git, `refs/tags/${release.tag}`) === release.commit;

/** A downloaded release's notes and date, from its tag. */
function described(git: Git, release: Release): DownloadedRelease {
  let notes: string | null = null;
  let date: string | null = null;
  try {
    const [message, created] = text(git, [
      "tag",
      "--list",
      release.tag,
      "--format=%(contents)%00%(creatordate:iso-strict)",
    ]).split("\0");
    notes = message?.trim() || null;
    date = created?.trim() || null;
  } catch {
    // A tag without a message: no notes.
  }
  const origin = originOf(git);
  return {
    ...release,
    notes,
    date,
    url: origin ? releasePage(origin, release.tag) : null,
  };
}

/** The release `release` as downloaded here, with its notes. */
export function downloaded(
  git: Git,
  release: Release,
): DownloadedRelease | undefined {
  return isDownloaded(git, release) ? described(git, release) : undefined;
}

/**
 * The newest release downloaded (Settings → Updates → World) that the world
 * hasn't taken: the highest local version tag, unless `play` already has it.
 */
export function downloadedRelease(git: Git): DownloadedRelease | undefined {
  let listed: string;
  try {
    // An annotated tag's commit is `*objectname`; a lightweight one's, its own.
    listed = text(git, [
      "for-each-ref",
      "--format=%(refname:short)%00%(objectname)%00%(*objectname)",
      "refs/tags/",
    ]);
  } catch {
    return undefined;
  }
  const releases = listed
    .split("\n")
    .map((line) => line.split("\0"))
    .filter(([tag]) => tag && RELEASE_TAG.test(tag))
    .map(([tag, own, named]) => ({
      tag: tag,
      version: tag.replace(/^v/, ""),
      commit: named || own,
    }));
  const release = newest(releases);
  const head = commitOf(git, PLAY);
  if (!release || (head && contains(git, head, release.commit)))
    return undefined;
  return described(git, release);
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

// ----------------------------------------------------------------- saves

/** Where the world is kept before taking a release: a save (worlds.md §4.6). */
export const saveRef = (version: string): string =>
  `refs/saves/before-update-${version}`;

/**
 * Saves the world as it is under `ref`: a commit of every world file (untracked
 * ones included, as git's exclude rules say) whose parent is the creator's
 * commit `play` stands on. No file is touched.
 */
export function saveWorld(
  git: Git,
  world: string,
  ref: string,
  message: string,
): string {
  const head = commitOf(git, PLAY);
  if (!head) throw new Error("This world isn't standing on a release.");
  const index = path.join(world, ".git", "kazusa-save-index");
  rmSync(index, { force: true });
  let tree: string;
  try {
    git(["read-tree", head], { index });
    git(["add", "--all"], { index });
    tree = text(git, ["write-tree"], { index });
  } finally {
    rmSync(index, { force: true });
  }
  const save = text(git, ["commit-tree", tree, "-p", head, "-m", message]);
  git(["update-ref", ref, save]);
  return save;
}

/**
 * Moves `play` to `commit` with the index there, the files untouched: what
 * differs from it is the game again.
 */
export function standOn(git: Git, commit: string): void {
  git(["update-ref", `refs/heads/${PLAY}`, commit]);
  git(["read-tree", commit]);
}

/**
 * Puts the world's files back as `ref` saved them and `play` back on the commit
 * it stood on then. Files the update brought (`taken`, the release's commit)
 * that the save lacks go; the databases in `.state/` aren't touched.
 */
export function restoreWorld(git: Git, ref: string, taken: string): void {
  const save = commitOf(git, ref);
  if (!save) throw new Error(`There's no save ${ref} to restore.`);
  // From the release's files to the save's: what only the release had goes.
  git(["read-tree", taken]);
  git(["read-tree", "-u", "--reset", save]);
  standOn(git, text(git, ["rev-parse", `${save}^`]));
}
