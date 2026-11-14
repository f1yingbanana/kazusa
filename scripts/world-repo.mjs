#!/usr/bin/env node
/**
 * A world is a plain git clone of its creator's repository (the kazusa skill's
 * `references/worlds.md` §4.5–§4.7). Git does the work; nothing of ours sits
 * beside it.
 *
 * - `list`: the worlds `apps/kazusa/world-sources.json` offers, each peeked at
 *   for its `package.json` without downloading it.
 * - `clone <id>`: setup's download of the picked world, `git clone` of its newest
 *   release straight into `apps/kazusa/world/`, branch `play` there.
 * - `check`: whether the creator released something newer than the commit the
 *   world stands on (`ls-remote`; the size alone from GitHub), nothing
 *   fetched.
 * - `download`: `git fetch` of that release, once the player says so; a world
 *   from before it was a clone is moved onto the published commit its
 *   `.template/` matches. The system agent's `world_update` merges it.
 * - No command: before the Gateway starts, keeps `world/`'s repository set up
 *   (made, for a world from before repositories), touching no file.
 *
 * `clone` and `download` print git's progress as JSON lines
 * (`{"progress":{stage,percent}}`); every command ends with one JSON object, `{
 * error }` when it fails. Git is the one shipped beside Kazusa (`git/`), else
 * the system's.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { simpleGit } from "simple-git";

/** Which worlds there are and where each lives; later, providers such as OpenRP. */
export const SOURCES = "apps/kazusa/world-sources.json";
export const WORLD = "apps/kazusa/world";
/** The playthrough: points at the creator's commit the world stands on. */
export const PLAY = "play";
const ORIGIN = "origin";
/** Files compared as text: what a `.template/` snapshot kept. */
const TEXT = /\.(md|json|txt)$/;
/**
 * What the clone tracks: the creator's files. `openclaw.json` (this machine's
 * config) and `.state/` (databases) are local; a save adds them explicitly.
 */
const EXCLUDE = `# Written by scripts/world-repo.mjs on every start.
/*
!/package.json
!/shared/
!/workspaces/
# The system agent's link to the app's own skills (a junction on Windows).
/workspaces/*/.agents
.DS_Store
*.tmp
`;
/** Every world repository's own settings (worlds.md §4.5). */
const CONFIG = [
  ["core.autocrlf", "false"],
  ["core.longpaths", "true"],
  ["core.quotePath", "false"],
  ["fetch.fsckObjects", "true"],
  ["commit.gpgSign", "false"],
  ["tag.gpgSign", "false"],
  ["user.name", "Kazusa"],
  ["user.email", "kazusa@localhost"],
];
/** A download that stalls fails instead of waiting forever. */
const SLOW = ["-c", "http.lowSpeedLimit=1000", "-c", "http.lowSpeedTime=60"];

// No delta between SQLite versions exists to find (worlds.md §4.6).
const ATTRIBUTES = "*.sqlite binary -delta\n";
// What simple-git guards: every `GIT_` variable, and these. An inherited one
// would point git elsewhere or wait for a person, so none is passed on; ours
// are named to it (`allowEnvironment`).
const GUARDED_ENV = /^(GIT_.*|EDITOR|VISUAL|PAGER|PREFIX|SSH_ASKPASS)$/i;

/** The environment around ours: everything but what git would act on. */
function baseEnv() {
  return Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !GUARDED_ENV.test(key)),
  );
}

/**
 * The git to run and how. The shipped one needs its own exec path and, outside
 * Windows, its templates; simple-git refuses both unless allowed, and they are
 * ours. Without the developer tools, macOS's `/usr/bin/git` only offers to
 * install them, so that counts as none.
 */
export function findGit(root, platform = process.platform) {
  // Our repositories are ours alone: nothing from a system-wide config.
  const env = { GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0" };
  const shipped = path.join(root, "git");
  if (existsSync(shipped)) {
    const unsafe = {
      allowUnsafeCustomBinary: true,
      allowUnsafeExec: true,
      allowUnsafeTemplateDir: true,
    };
    if (platform === "win32") {
      const base = baseEnv();
      const pathKey =
        Object.keys(base).find((key) => key.toUpperCase() === "PATH") ?? "PATH";
      env[pathKey] = [
        path.join(shipped, "ucrt64/bin"),
        path.join(shipped, "usr/bin"),
        base[pathKey] ?? "",
      ].join(path.delimiter);
      env.GIT_EXEC_PATH = path.join(shipped, "ucrt64/libexec/git-core");
      return { binary: path.join(shipped, "cmd/git.exe"), env, unsafe };
    }
    env.GIT_EXEC_PATH = path.join(shipped, "libexec/git-core");
    env.GIT_TEMPLATE_DIR = path.join(shipped, "share/git-core/templates");
    return { binary: path.join(shipped, "bin/git"), env, unsafe };
  }
  if (platform === "darwin")
    try {
      execFileSync("xcode-select", ["-p"], { stdio: "ignore" });
    } catch {
      return undefined;
    }
  try {
    execFileSync("git", ["--version"], {
      env: { ...baseEnv(), ...env },
      stdio: "ignore",
    });
  } catch {
    return undefined;
  }
  return { binary: "git", env, unsafe: {} };
}

function gitIn(git, dir, extraEnv = {}, progress = undefined) {
  const ours = { ...git.env, ...extraEnv };
  return simpleGit({
    baseDir: dir,
    binary: git.binary,
    unsafe: git.unsafe,
    allowEnvironment: Object.keys(ours).filter((key) => GUARDED_ENV.test(key)),
    ...(progress ? { progress } : {}),
  }).env({ ...baseEnv(), ...ours });
}

/**
 * How much of a download each of git's stages is (`--progress`, parsed by
 * simple-git): receiving the objects is most of it, then resolving their deltas
 * and writing the files out. The server's own counting and compressing come
 * first and count as nothing.
 */
const STAGE_SHARE = {
  receiving: [0, 85],
  resolving: [85, 92],
  updating: [92, 100],
  checking: [92, 100],
};

const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));

/** Git's error without the progress lines `--progress` puts before it. */
const gitError = (error) =>
  error.message
    .split(/[\r\n]+/)
    .map((line) => line.trim())
    .filter((line) => line && !/\d+%|^Cloning into /.test(line))
    .join(" ") || error.message.trim();

/** Git's id for a file's bytes, without asking git. */
const blobId = (data) =>
  createHash("sha1").update(`blob ${data.length}\0`).update(data).digest("hex");

/** `path → id` for every file in a commit. */
async function treeOf(repo, commit) {
  const files = new Map();
  for (const line of (
    await repo.raw(["ls-tree", "-r", "--full-tree", commit])
  ).split("\n")) {
    const match = /^\d+ blob ([0-9a-f]+)\t(.+)$/.exec(line);
    if (match) files.set(match[2], match[1]);
  }
  return files;
}

/** `[{ id, provider, url }]`: the worlds this copy offers. */
export function readSources(root) {
  const file = path.join(root, SOURCES);
  return existsSync(file) ? (readJson(file).worlds ?? []) : [];
}

/**
 * What a world says about itself, without downloading it: a shallow clone with
 * no file contents, from which only `package.json` is read. About a second.
 */
async function peek(git, url) {
  const scratch = mkdtempSync(path.join(tmpdir(), "kazusa-peek-"));
  try {
    await gitIn(git, scratch).raw([
      "clone",
      "--quiet",
      "--depth=1",
      "--filter=blob:none",
      "--no-checkout",
      url,
      "world",
    ]);
    return JSON.parse(
      await gitIn(git, path.join(scratch, "world")).show(["HEAD:package.json"]),
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/**
 * Every listed world with its `package.json`: the one cloned into `world/`
 * already reads its own, the rest are peeked at. One that can't be reached says
 * why instead.
 */
export async function listWorlds(root) {
  const git = findGit(root);
  if (!git) throw new Error("git isn't installed.");
  const here = await clonedSource(git, root);
  return Promise.all(
    readSources(root).map(async ({ id, url }) => {
      try {
        return here === url
          ? {
              id,
              url,
              downloaded: true,
              package: readJson(path.join(root, WORLD, "package.json")),
            }
          : { id, url, downloaded: false, package: await peek(git, url) };
      } catch (error) {
        return { id, url, error: error.message.trim() };
      }
    }),
  );
}

/** Where the world in play comes from: its own `repository`, else its source. */
function worldUrl(root, pkg) {
  return (
    (typeof pkg.repository === "string"
      ? pkg.repository
      : pkg.repository?.url) ??
    readSources(root).find((source) => source.id === pkg.kazusa?.template)?.url
  );
}

/** A file's kind, with a character's id as a star: `workspaces/*\/portraits`. */
function areaOf(file) {
  const parts = file.split("/");
  return parts[0] === "workspaces"
    ? `workspaces/*/${parts[2] ?? ""}`
    : parts.slice(0, 2).join("/");
}

/** `owner/name` of a world on GitHub. Worlds are all on GitHub for now. */
function githubRepo(url) {
  return /github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?\/?$/.exec(url)?.[1];
}

/** GitHub's API, for a world there (all of them, for now). */
async function github(repo, endpoint) {
  const response = await fetch(
    `https://api.github.com/repos/${repo}${endpoint}`,
    {
      headers: { "User-Agent": "kazusa-world-check" },
      signal: AbortSignal.timeout(20_000),
    },
  );
  if (!response.ok) throw new Error(`GitHub answered ${response.status}.`);
  return response.json();
}

/** Every file of a commit, `path → { sha, size }`, from GitHub's API. */
async function githubTree(repo, commit) {
  const response = await fetch(
    `https://api.github.com/repos/${repo}/git/trees/${commit}?recursive=1`,
    {
      headers: { "User-Agent": "kazusa-world-check" },
      signal: AbortSignal.timeout(20_000),
    },
  );
  if (!response.ok)
    throw new Error(`GitHub answered ${response.status} for ${commit}.`);
  const tree = await response.json();
  if (tree.truncated) throw new Error(`${commit} has too many files to list.`);
  return new Map(
    tree.tree
      .filter((entry) => entry.type === "blob")
      .map((entry) => [entry.path, { sha: entry.sha, size: entry.size ?? 0 }]),
  );
}

/**
 * What going from one commit's files to another's changes in a world (its
 * `shared/` and `workspaces/`, by kind), and roughly what downloading it costs:
 * every file `to` has that `from` lacks, by content. Commits between the two
 * can add a little more.
 */
export function compareReleases(from, to) {
  const had = new Set([...from.values()].map(({ sha }) => sha));
  let size = 0;
  for (const { sha, size: bytes } of to.values())
    if (!had.has(sha)) {
      had.add(sha);
      size += bytes;
    }
  const changed = [...new Set([...from.keys(), ...to.keys()])].filter(
    (file) =>
      /^(shared|workspaces)\//.test(file) &&
      from.get(file)?.sha !== to.get(file)?.sha,
  );
  const areas = new Map();
  for (const file of changed)
    areas.set(areaOf(file), (areas.get(areaOf(file)) ?? 0) + 1);
  return {
    changes: {
      files: changed.length,
      areas: [...areas]
        .map(([area, count]) => ({ area, count }))
        .sort((a, b) => b.count - a.count),
    },
    size,
  };
}

/** Dotted numbers, by number; a suffix such as `-beta` is ignored. */
export function compareVersions(a, b) {
  const parts = (version) =>
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

/** A release is a tag named for its version (`v0.4.0` or `0.4.0`). */
const RELEASE_TAG = /^v?\d+(\.\d+)*$/;

/** Content, not manifests: `package.json` (once `world.json`) changes alone. */
const isContent = (file) =>
  file.startsWith("shared/") || file.startsWith("workspaces/");

/** The template as `.template/` recorded it: its content paths, text as bytes. */
function snapshotOf(world) {
  const dir = path.join(world, ".template");
  const file = path.join(dir, "manifest.json");
  if (!existsSync(file)) return undefined;
  const all = Object.keys(readJson(file).files ?? {});
  const text = new Map();
  for (const relative of all.filter((entry) => TEXT.test(entry))) {
    const source = path.join(dir, relative);
    if (existsSync(source)) text.set(relative, readFileSync(source));
  }
  return { paths: all.filter(isContent), text };
}

/**
 * The newest published commit with exactly the snapshot's content: the same
 * files, the same text. Newest, because commits that differ only in their
 * manifest are the same world, and the newest is closest to the live one.
 */
async function publishedMatch(repo, snapshot, release) {
  const ids = new Map(
    [...snapshot.text]
      .filter(([file]) => isContent(file))
      .map(([file, data]) => [file, blobId(data)]),
  );
  const commits = (await repo.raw(["rev-list", release]).catch(() => ""))
    .split("\n")
    .filter(Boolean);
  for (const commit of commits) {
    const files = new Map(
      [...(await treeOf(repo, commit))].filter(([file]) => isContent(file)),
    );
    if (files.size !== snapshot.paths.length) continue;
    if (!snapshot.paths.every((file) => files.has(file))) continue;
    if ([...ids].every(([file, id]) => files.get(file) === id)) return commit;
  }
  return undefined;
}

/**
 * A simple-git progress handler that turns git's stages into one bar and hands
 * it on: a few times a second, and at each stage's end.
 */
function progressOf(report) {
  if (!report) return undefined;
  let percent = 0;
  let written = 0;
  return ({ stage, progress }) => {
    const share = STAGE_SHARE[stage];
    const next = share
      ? Math.round(share[0] + ((share[1] - share[0]) * progress) / 100)
      : percent;
    // Stages restart at 0; the bar never goes back.
    percent = Math.max(percent, next);
    if (Date.now() - written < 250 && progress !== 100) return;
    written = Date.now();
    report({ stage: share ? stage : "preparing", percent });
  };
}

/** The URL `world/`'s `origin` points at, if it's a clone. */
async function clonedSource(git, root) {
  const world = path.join(root, WORLD);
  if (!existsSync(path.join(world, ".git"))) return undefined;
  return gitIn(git, world)
    .raw(["remote", "get-url", ORIGIN])
    .then((url) => url.trim() || undefined)
    .catch(() => undefined);
}

/** Whether `world/` is a world that's been set up: setup finished writing it. */
function setUp(world) {
  if (existsSync(path.join(world, "openclaw.json"))) return true;
  if (existsSync(path.join(world, "world.json"))) return true;
  try {
    return Boolean(readJson(path.join(world, "package.json")).kazusa?.template);
  } catch {
    return false;
  }
}

/** Every world repository's settings, exclude rules and attributes. */
async function configure(repo, world) {
  for (const [key, value] of CONFIG) await repo.raw(["config", key, value]);
  mkdirSync(path.join(world, ".git/info"), { recursive: true });
  writeFileSync(path.join(world, ".git/info/exclude"), EXCLUDE);
  writeFileSync(path.join(world, ".git/info/attributes"), ATTRIBUTES);
}

async function commitOf(repo, ref) {
  return repo
    .raw(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`])
    .then((sha) => sha.trim() || undefined)
    .catch(() => undefined);
}

/**
 * Whether `ancestor` is in `of`'s history. Not `merge-base --is-ancestor`:
 * simple-git takes its silent "no" (exit 1) for a yes.
 */
async function isAncestor(repo, ancestor, of) {
  const [a, base] = await Promise.all([
    commitOf(repo, ancestor),
    repo
      .raw(["merge-base", ancestor, of])
      .then((sha) => sha.trim())
      .catch(() => ""),
  ]);
  return Boolean(a) && a === base;
}

/**
 * The newest release on a remote: the highest version tag (`v0.4.0` or
 * `0.4.0`), with the commit it names. One `ls-remote`, nothing downloaded.
 */
async function newestRelease(git, url) {
  const listed = await gitIn(git, process.cwd()).raw([
    "ls-remote",
    "--tags",
    url,
  ]);
  const tags = new Map();
  for (const line of listed.split("\n").filter(Boolean)) {
    const [sha, ref] = line.split("\t");
    const tag = /^refs\/tags\/(.+?)(\^\{\})?$/.exec(ref);
    if (!tag || !RELEASE_TAG.test(tag[1])) continue;
    const entry = tags.get(tag[1]) ?? { tag: tag[1], commit: sha };
    if (tag[2]) entry.commit = sha;
    tags.set(tag[1], entry);
  }
  const [release] = [...tags.values()].sort((a, b) =>
    compareVersions(b.tag, a.tag),
  );
  return release && { ...release, version: release.tag.replace(/^v/, "") };
}

/** A release's page on GitHub, for its notes; undefined off GitHub. */
function releaseUrl(url, tag) {
  const repo = githubRepo(url);
  return repo
    ? `https://github.com/${repo}/releases/tag/${encodeURIComponent(tag)}`
    : undefined;
}

/** What a clone puts in `world/`; everything else there (`.state/`) is kept. */
const CLONED = [".git", "package.json", "shared", "workspaces"];

/**
 * Setup's download: the picked world cloned at its newest release into
 * `world/`, branch `play` at that commit. Cloned beside and moved in whole, so
 * a failed clone leaves nothing; only the world's own parts are replaced, so
 * what this machine already keeps there (`.state/`, an older Kazusa's keys)
 * stays. A world already set up is never replaced; another pick that wasn't
 * is.
 */
export async function cloneWorld(root, id, report) {
  const source = readSources(root).find((entry) => entry.id === id);
  if (!source) throw new Error(`No world ${id} is listed.`);
  const git = findGit(root);
  if (!git) throw new Error("git isn't installed.");
  const world = path.join(root, WORLD);
  if ((await clonedSource(git, root)) === source.url) return [];
  if (existsSync(world) && setUp(world))
    throw new Error("A world is set up already.");
  const release = await newestRelease(git, source.url);
  const partial = `${world}.cloning`;
  rmSync(partial, { recursive: true, force: true });
  mkdirSync(path.dirname(world), { recursive: true });
  try {
    await gitIn(git, path.dirname(world), {}, progressOf(report)).raw([
      ...SLOW,
      "clone",
      "--progress",
      ...CONFIG.flatMap(([key, value]) => ["-c", `${key}=${value}`]),
      ...(release ? ["--branch", release.tag] : []),
      source.url,
      path.basename(partial),
    ]);
    const repo = gitIn(git, partial);
    await repo.raw(["checkout", "--quiet", "-B", PLAY]);
    await configure(repo, partial);
  } catch (error) {
    rmSync(partial, { recursive: true, force: true });
    throw new Error(gitError(error));
  }
  mkdirSync(world, { recursive: true });
  for (const part of CLONED)
    rmSync(path.join(world, part), { recursive: true, force: true });
  for (const part of readdirSync(partial))
    renameSync(path.join(partial, part), path.join(world, part));
  rmSync(partial, { recursive: true, force: true });
  return [];
}

/** A world's version: the release tag its `play` is on, else its manifest's. */
async function versionOf(repo, world) {
  const tag = await repo
    .raw(["describe", "--tags", "--exact-match", PLAY])
    .then((value) => value.trim())
    .catch(() => "");
  if (RELEASE_TAG.test(tag)) return tag.replace(/^v/, "");
  try {
    return readJson(path.join(world, "package.json")).version ?? null;
  } catch {
    return null;
  }
}

/**
 * Whether the creator released something newer than the commit the world stands
 * on, nothing fetched: the newest release by `ls-remote`, new unless it's
 * `play`'s commit or in its history (a world without history compares
 * versions). `downloaded`: its tag is fetched already, ready for the system
 * agent, with its notes (the tag's message). Not downloaded: its size from
 * GitHub's file lists, display only, absent when GitHub can't say.
 */
export async function checkLiveWorld(root) {
  const git = findGit(root);
  const world = path.join(root, WORLD);
  if (!git || !existsSync(path.join(world, ".git"))) return { checked: false };
  const repo = gitIn(git, world);
  const url = await clonedSource(git, root);
  if (!url) return { checked: false };
  const head = await commitOf(repo, PLAY);
  const current = {
    commit: head ?? null,
    version: await versionOf(repo, world),
  };
  const release = await newestRelease(git, url);
  if (!release) return { checked: true, current, latest: null, newer: false };
  const have = Boolean(await commitOf(repo, release.commit));
  const newer = head
    ? release.commit !== head &&
      !(have && (await isAncestor(repo, release.commit, head)))
    : !current.version || compareVersions(release.version, current.version) > 0;
  const latest = {
    commit: release.commit,
    version: release.version,
    url: releaseUrl(url, release.tag) ?? null,
  };
  if (!newer) return { checked: true, current, latest, newer: false };
  if (have) {
    const [notes, date] = (
      await repo
        .raw([
          "tag",
          "--list",
          release.tag,
          "--format=%(contents)%00%(creatordate:iso-strict)",
        ])
        .catch(() => "")
    ).split("\0");
    return {
      checked: true,
      current,
      latest: {
        ...latest,
        notes: notes?.trim() || null,
        date: date?.trim() || null,
      },
      newer: true,
      downloaded: true,
    };
  }
  let size;
  const github = githubRepo(url);
  if (github)
    try {
      const [from, to] = await Promise.all([
        head ? githubTree(github, head).catch(() => new Map()) : new Map(),
        githubTree(github, release.commit),
      ]);
      size = compareReleases(from, to).size;
    } catch {
      // Shown without its size.
    }
  return {
    checked: true,
    current,
    latest,
    newer: true,
    downloaded: false,
    ...(size === undefined ? {} : { size }),
  };
}

/**
 * Downloads the newest release (its tag, nothing else), once the player says
 * so. A world from before it was a clone is then moved onto the published
 * commit its `.template/` snapshot matches, as long as nothing of its own was
 * ever committed (nothing is, until saves): only `play` and the index move,
 * never a file. The snapshot and old update backups then go.
 */
export async function downloadLiveWorld(root, report) {
  const git = findGit(root);
  if (!git) throw new Error("git isn't installed.");
  const world = path.join(root, WORLD);
  const url = await clonedSource(git, root);
  if (!url) throw new Error("This world has no history yet: restart Kazusa.");
  const release = await newestRelease(git, url);
  if (!release) throw new Error("The creator hasn't released anything yet.");
  try {
    await gitIn(git, world, {}, progressOf(report)).raw([
      ...SLOW,
      "fetch",
      "--progress",
      "--no-tags",
      url,
      `+refs/tags/${release.tag}:refs/tags/${release.tag}`,
    ]);
  } catch (error) {
    throw new Error(`Couldn't download it: ${gitError(error)}`);
  }
  const lines = [];
  const snapshot = snapshotOf(world);
  if (snapshot) {
    const repo = gitIn(git, world);
    const match = await publishedMatch(repo, snapshot, release.commit);
    const head = await commitOf(repo, PLAY);
    const own = head
      ? (await repo.raw(["log", "--format=%ae", head])).includes(
          "kazusa@localhost",
        ) &&
        !(await repo.raw(["log", "-1", "--format=%s", head]))
          .trim()
          .endsWith(" as imported")
      : false;
    if (match && match !== head && !own) {
      await repo.raw(["update-ref", `refs/heads/${PLAY}`, match]);
      await repo.raw(["read-tree", match]);
      lines.push(
        `This world now stands on the creator's commit it was made from (${match.slice(0, 7)}).`,
      );
    }
    if (match || head)
      rmSync(path.join(world, ".template"), { recursive: true, force: true });
    rmSync(path.join(world, ".state/kazusa/world-update/backups"), {
      recursive: true,
      force: true,
    });
  }
  return lines;
}

/**
 * Before the Gateway starts: `world/`'s repository set up, made for a world
 * from before repositories (no commit: its first update finds its base), and
 * `origin` pointing where the world lives. No file is touched, nothing
 * fetched.
 */
export async function adoptWorldRepo(root) {
  const world = path.join(root, WORLD);
  const manifest = path.join(world, "package.json");
  if (!existsSync(manifest)) return [];
  const git = findGit(root);
  if (!git)
    return [
      process.platform === "darwin"
        ? "This world's history is off: git isn't installed. Install the developer tools (xcode-select --install) to turn it on."
        : "This world's history is off: git isn't installed.",
    ];
  const lines = [];
  if (!existsSync(path.join(world, ".git"))) {
    await gitIn(git, world).raw(["init", `--initial-branch=${PLAY}`]);
    lines.push(
      "This world's history is on: its next update finds where it came from.",
    );
  }
  const repo = gitIn(git, world);
  await configure(repo, world);
  const url = worldUrl(root, readJson(manifest));
  const remotes = (await repo.raw(["remote"])).split("\n");
  if (url)
    await repo.raw(
      remotes.includes(ORIGIN)
        ? ["remote", "set-url", ORIGIN, url]
        : ["remote", "add", ORIGIN, url],
    );
  // Before worlds were clones the remote was `upstream`, and Kazusa kept refs
  // of its own; neither is used now.
  if (remotes.includes("upstream"))
    await repo.raw(["remote", "remove", "upstream"]);
  for (const ref of (
    await repo.raw(["for-each-ref", "--format=%(refname)", "refs/kazusa/"])
  )
    .split("\n")
    .filter(Boolean))
    await repo.raw(["update-ref", "-d", ref]);
  return lines;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const [command, id] = process.argv.slice(2);
  const progress = (value) =>
    process.stdout.write(`${JSON.stringify({ progress: value })}\n`);
  const commands = {
    list: async () => ({ worlds: await listWorlds(root) }),
    clone: async () => ({ lines: await cloneWorld(root, id, progress) }),
    check: () => checkLiveWorld(root),
    download: async () => ({ lines: await downloadLiveWorld(root, progress) }),
  };
  if (command in commands)
    try {
      process.stdout.write(`${JSON.stringify(await commands[command]())}\n`);
    } catch (error) {
      process.exitCode = 1;
      process.stdout.write(
        `${JSON.stringify({ error: error.message.trim() })}\n`,
      );
    }
  else
    try {
      for (const line of await adoptWorldRepo(root)) console.log(line);
    } catch (error) {
      console.warn(`Couldn't set up this world's history: ${error.message}`);
    }
}
