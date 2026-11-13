#!/usr/bin/env node
/**
 * Worlds are git repositories (the kazusa skill's `references/worlds.md` §4.5).
 *
 * Templates: `apps/kazusa/world-sources.json` lists the worlds on offer. The
 * setup guide lists them by peeking at each one's `package.json` (`list`) and
 * clones only the one the player picks into `apps/kazusa/worlds/<id>` (`clone
 * <id>`, which brings one already there up to date), where setup and
 * `world_update` read templates. Nothing else is fetched unasked: a release can
 * be a gigabyte. The client checks the world in play for a newer release
 * (`check`: its tags, then what it changes and its size from GitHub, where
 * worlds live for now; nothing downloaded) and downloads it into the template's
 * clone when the player says so (`download`). A clone someone changed,
 * committed on or switched branch in is left alone, so a creator can edit,
 * commit and push from one.
 *
 * The live world: `world/` is its own repository, whose history starts at the
 * published commit it was made from, so updates and publishing later have the
 * right base. Rooting it there is what can't be done afterwards, so it happens
 * before the Gateway first starts on a world, new or old. Nothing is committed
 * here: commits are saves, made with the Gateway stopped.
 *
 * Starting runs from `scripts/dev.mjs` (installed copies too) and from `npm run
 * gateway`; the client runs `list`, `clone`, `check` and `download`, which
 * print JSON. Git is the one shipped beside Kazusa (`git/`, GitHub Desktop's
 * portable build), else the system's.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { simpleGit } from "simple-git";

export const WORLDS = "apps/kazusa/worlds";
/** Which worlds there are and where each lives; later, providers such as OpenRP. */
export const SOURCES = "apps/kazusa/world-sources.json";
const WORLD = "apps/kazusa/world";
/** Where a template folder from before repositories is set aside, not lost. */
const SET_ASIDE = "apps/kazusa/.worlds-before-repositories";
/** The playthrough: the world's local branch, never pushed. */
export const PLAY = "play";
const UPSTREAM = "upstream";
/** Files a world update compares as text, as `.template/` keeps them. */
const TEXT = /\.(md|json|txt)$/;
/** What a world is; everything else in `world/` is the machine's. */
const EXCLUDE = `# Written by scripts/world-repo.mjs on every start.
/*
!/package.json
!/openclaw.json
!/shared/
!/workspaces/
# The system agent's link to the app's own skills (a junction on Windows).
/workspaces/*/.agents
.DS_Store
*.tmp
`;
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
 * Where a template's download reports how far it has got, beside its clone: the
 * setup guide and Settings show it as a progress bar. Only there while a
 * download runs; the frontend ignores one that stopped being written to.
 */
export const downloadFile = (root, id) =>
  path.join(root, WORLDS, `.${id}.download.json`);

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
const WRITE_EVERY_MS = 250;
/**
 * Git says nothing while it connects and while the server counts, and can go
 * quiet mid-download: the file appears after `FIRST_WRITE_MS` regardless (a
 * fetch with nothing new is over by then) and is rewritten every
 * `HEARTBEAT_MS`, so a reader never takes a download still running for a dead
 * one.
 */
const FIRST_WRITE_MS = 2000;
const HEARTBEAT_MS = 30_000;

/** A simple-git progress handler that keeps `downloadFile` up to date. */
export function downloadTracker(root, id, kind) {
  const file = downloadFile(root, id);
  const startedAt = Date.now();
  let written = 0;
  let percent = 0;
  let stage = "preparing";
  let finished = false;
  const write = () => {
    if (finished) return;
    written = Date.now();
    const temp = `${file}.${process.pid}.tmp`;
    writeFileSync(
      temp,
      JSON.stringify({
        id,
        kind,
        stage,
        percent,
        startedAt,
        updatedAt: written,
      }),
    );
    renameSync(temp, file);
  };
  const first = setTimeout(() => written || write(), FIRST_WRITE_MS);
  const heartbeat = setInterval(write, HEARTBEAT_MS);
  first.unref?.();
  heartbeat.unref?.();
  return {
    progress({ stage: reported, progress }) {
      const share = STAGE_SHARE[reported];
      const next = share
        ? Math.round(share[0] + ((share[1] - share[0]) * progress) / 100)
        : percent;
      // Stages restart at 0; the bar never goes back.
      percent = Math.max(percent, next);
      stage = share ? reported : "preparing";
      if (Date.now() - written >= WRITE_EVERY_MS || progress === 100) write();
    },
    /** Writes now: the files are about to change, so setup waits from here. */
    now: write,
    done() {
      finished = true;
      clearTimeout(first);
      clearInterval(heartbeat);
      rmSync(file, { force: true });
    },
  };
}

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
 * Every listed world with its `package.json`: a clone's own, else a peek at its
 * repository. One that can't be reached says why instead.
 */
export async function listWorlds(root) {
  const git = findGit(root);
  if (!git) throw new Error("git isn't installed.");
  return Promise.all(
    readSources(root).map(async ({ id, url }) => {
      const manifest = path.join(root, WORLDS, id, "package.json");
      try {
        return existsSync(path.join(root, WORLDS, id, ".git"))
          ? { id, url, downloaded: true, package: readJson(manifest) }
          : { id, url, downloaded: false, package: await peek(git, url) };
      } catch (error) {
        return { id, url, error: error.message.trim() };
      }
    }),
  );
}

/**
 * Clones a listed world into `worlds/<id>`, once. A folder from before
 * repositories is set aside first, never deleted.
 */
export async function cloneWorld(root, id) {
  const source = readSources(root).find((entry) => entry.id === id);
  if (!source) throw new Error(`No world ${id} is listed.`);
  const dir = path.join(root, WORLDS, id);
  if (existsSync(path.join(dir, ".git"))) return [];
  const git = findGit(root);
  if (!git) throw new Error("git isn't installed.");
  const lines = [];
  if (existsSync(dir)) {
    const aside = path.join(root, SET_ASIDE, `${id}-${Date.now()}`);
    mkdirSync(path.dirname(aside), { recursive: true });
    renameSync(dir, aside);
    lines.push(
      `Set the old ${id} template aside in ${path.relative(root, aside)}.`,
    );
  }
  // `worlds/` holds only clones, so the first one makes it. Cloned beside and
  // moved in when complete: a world update must never read half a template.
  mkdirSync(path.join(root, WORLDS), { recursive: true });
  const partial = `.${id}.cloning`;
  rmSync(path.join(root, WORLDS, partial), { recursive: true, force: true });
  const tracker = downloadTracker(root, id, "clone");
  try {
    await gitIn(git, path.join(root, WORLDS), {}, tracker.progress).raw([
      "clone",
      "--progress",
      source.url,
      partial,
    ]);
    renameSync(path.join(root, WORLDS, partial), dir);
  } catch (error) {
    throw new Error(gitError(error));
  } finally {
    tracker.done();
  }
  return lines;
}

/** The template the live world was made from, by its `package.json`. */
function liveTemplate(root) {
  const manifest = path.join(root, WORLD, "package.json");
  if (!existsSync(manifest)) return undefined;
  try {
    const pkg = readJson(manifest);
    return { id: pkg.kazusa?.template, title: pkg.displayName ?? pkg.name };
  } catch {
    return undefined;
  }
}

/**
 * Moves a clone to `target` (a release's tag, or `origin/main`), unless someone
 * has work there: a branch other than `main`, changes, or commits not pushed.
 */
async function syncWorld(git, root, id, target = "origin/main") {
  const dir = path.join(root, WORLDS, id);
  const tracker = downloadTracker(root, id, "update");
  try {
    const repo = gitIn(git, dir, {}, tracker.progress);
    await repo.raw(["fetch", "--progress", "--prune", "--tags", "--force"]);
    const branch = (await repo.raw(["branch", "--show-current"])).trim();
    const changed = (await repo.raw(["status", "--porcelain"])).trim();
    const ahead = (
      await repo.raw(["rev-list", "--count", "origin/main..HEAD"])
    ).trim();
    if (branch !== "main" || changed || ahead !== "0")
      return [`Kept your work in worlds/${id}; it isn't updated.`];
    const behind = (
      await repo.raw(["rev-list", "--count", `HEAD..${target}`])
    ).trim();
    if (behind === "0") return [];
    tracker.now();
    await repo.raw(["merge", "--progress", "--ff-only", target]);
    return [];
  } catch (error) {
    throw new Error(`Couldn't update the ${id} world: ${gitError(error)}`);
  } finally {
    tracker.done();
  }
}

/**
 * The template a player picked in setup, downloaded or brought up to date: the
 * one fetch setup needs. Nothing else is fetched unasked.
 */
export async function fetchWorld(root, id) {
  const lines = await cloneWorld(root, id);
  if (lines.length || !existsSync(path.join(root, WORLDS, id, ".git")))
    return lines;
  const git = findGit(root);
  if (!git) return [];
  // Unreachable (offline, gone): setup goes on with the version it has.
  return syncWorld(git, root, id).catch((error) => [error.message]);
}

/** A download's record not written to for this long was left by one that died. */
const DOWNLOAD_STALE_MS = 2 * 60_000;

/**
 * Whether the system agent is between applying an update and finishing it
 * (`world_update`): the template must stay the version it applied.
 */
function midUpdate(root) {
  const report = path.join(
    root,
    WORLD,
    ".state/kazusa/world-update/report.json",
  );
  try {
    return existsSync(report) && readJson(report).stage === "applied";
  } catch {
    return false;
  }
}

function downloading(root, id) {
  try {
    return (
      Date.now() - readJson(downloadFile(root, id)).updatedAt <
      DOWNLOAD_STALE_MS
    );
  } catch {
    return false;
  }
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

/** The releases on a remote, newest first, without downloading anything. */
async function releases(git, url) {
  const listed = await gitIn(git, process.cwd()).raw([
    "ls-remote",
    "--tags",
    "--refs",
    url,
  ]);
  return listed
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [sha, ref] = line.split("\t");
      const tag = ref.replace("refs/tags/", "");
      return { sha, tag, version: tag.replace(/^v/, "") };
    })
    .filter(({ tag }) => RELEASE_TAG.test(tag))
    .sort((a, b) => compareVersions(b.version, a.version));
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

/** Every file of a release, `path → { sha, size }`, from GitHub's API. */
async function githubTree(repo, tag) {
  const response = await fetch(
    `https://api.github.com/repos/${repo}/git/trees/${encodeURIComponent(tag)}?recursive=1`,
    {
      headers: { "User-Agent": "kazusa-world-check" },
      signal: AbortSignal.timeout(20_000),
    },
  );
  if (!response.ok)
    throw new Error(`GitHub answered ${response.status} for ${tag}.`);
  const tree = await response.json();
  if (tree.truncated) throw new Error(`${tag} has too many files to list.`);
  return new Map(
    tree.tree
      .filter((entry) => entry.type === "blob")
      .map((entry) => [entry.path, { sha: entry.sha, size: entry.size ?? 0 }]),
  );
}

/**
 * What going from one release's files to another's changes in a world (its
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

/**
 * What the newest release of the world in play would bring, downloading
 * nothing: its releases from `ls-remote`, then, when one is newer than this
 * world's, its files and this world's release's from GitHub, for what it
 * changes and the download's size. A release that changes none of the world's
 * files has nothing for this game (a new chapter, say). `downloaded` says the
 * template's clone has it already, ready for the system agent.
 */
export async function checkLiveWorld(root) {
  const git = findGit(root);
  const manifest = path.join(root, WORLD, "package.json");
  if (!git || !existsSync(manifest)) return { checked: false };
  const pkg = readJson(manifest);
  const id = pkg.kazusa?.template;
  const url = worldUrl(root, pkg);
  if (!id || !url) return { checked: false };
  const current = pkg.version ?? "0";
  const all = await releases(git, url);
  const [latest] = all;
  if (!latest || compareVersions(latest.version, current) <= 0)
    return {
      checked: true,
      current,
      latest: latest?.version ?? null,
      newer: false,
    };
  const clone = path.join(root, WORLDS, id);
  // Not `merge-base --is-ancestor`: simple-git takes its silent "no" (exit
  // 1) for a yes.
  const inClone = async () => {
    const repo = gitIn(git, clone);
    const commit = (
      await repo
        .raw(["rev-parse", "--verify", "--quiet", `${latest.sha}^{commit}`])
        .catch(() => "")
    ).trim();
    const base = commit
      ? (await repo.raw(["merge-base", commit, "HEAD"]).catch(() => "")).trim()
      : "";
    return Boolean(commit) && base === commit;
  };
  const downloaded = existsSync(path.join(clone, ".git")) && (await inClone());
  // This world's own release: without one, what changes is unknown and the
  // download is the whole release.
  const base = all.find(
    ({ version }) => compareVersions(version, current) === 0,
  );
  const repo = githubRepo(url);
  let compared = { changes: null };
  if (repo)
    try {
      const [from, to] = await Promise.all([
        base ? githubTree(repo, base.tag) : new Map(),
        githubTree(repo, latest.tag),
      ]);
      compared = compareReleases(from, to);
      if (!base) compared.changes = null;
    } catch {
      // Unknown: offered all the same, without what it changes or its size.
    }
  const result = {
    checked: true,
    current,
    latest: latest.version,
    newer: true,
    downloaded,
    ...compared,
  };
  if (downloaded) delete result.size;
  return result;
}

/**
 * Downloads the newest release of the world in play into its template's clone
 * (cloning it first if this world was made before templates were repositories),
 * when the player asks. Holds off while it's downloading already, and while an
 * update is half done: the template must stay the version that update applied.
 */
export async function downloadLiveWorld(root) {
  const git = findGit(root);
  if (!git) throw new Error("git isn't installed.");
  const live = liveTemplate(root);
  if (!live?.id) throw new Error("This world wasn't made from a template.");
  if (midUpdate(root))
    throw new Error(
      "An update is half done: the system agent has to finish it first.",
    );
  if (downloading(root, live.id))
    throw new Error("This world's template is downloading already.");
  const clone = path.join(root, WORLDS, live.id);
  const had = existsSync(path.join(clone, ".git"));
  const lines = await cloneWorld(root, live.id);
  const url = worldUrl(root, readJson(path.join(root, WORLD, "package.json")));
  const [latest] = url ? await releases(git, url) : [];
  // A fresh clone is at `main`, which can be ahead of the release.
  if (!had && latest)
    await gitIn(git, clone).raw([
      "reset",
      "--quiet",
      "--hard",
      `refs/tags/${latest.tag}`,
    ]);
  lines.push(
    ...(await syncWorld(
      git,
      root,
      live.id,
      latest ? `refs/tags/${latest.tag}` : "origin/main",
    )),
  );
  return lines;
}

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
async function publishedMatch(repo, snapshot) {
  const ids = new Map(
    [...snapshot.text]
      .filter(([file]) => isContent(file))
      .map(([file, data]) => [file, blobId(data)]),
  );
  const commits = (
    await repo
      .raw(["rev-list", `refs/remotes/${UPSTREAM}/main`])
      .catch(() => "")
  )
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
 * A root commit of the snapshot's text, for a world whose template matches no
 * published commit (edited in place, or from an unmerged branch). Its binary
 * files aren't in the snapshot, so they aren't in it either.
 */
async function snapshotCommit(git, world, snapshot, title) {
  const repo = gitIn(git, world);
  const files = [...snapshot.text.keys()];
  const blobs = [];
  for (let start = 0; start < files.length; start += 200) {
    const chunk = files.slice(start, start + 200);
    const out = await repo.raw([
      "hash-object",
      "-w",
      "--",
      ...chunk.map((file) => `.template/${file}`),
    ]);
    blobs.push(...out.split("\n").filter(Boolean));
  }
  const scratch = mkdtempSync(path.join(tmpdir(), "kazusa-index-"));
  try {
    const indexed = gitIn(git, world, {
      GIT_INDEX_FILE: path.join(scratch, "index"),
    });
    for (let start = 0; start < files.length; start += 200)
      await indexed.raw([
        "update-index",
        "--add",
        ...files
          .slice(start, start + 200)
          .flatMap((file, index) => [
            "--cacheinfo",
            `100644,${blobs[start + index]},${file}`,
          ]),
      ]);
    const tree = (await indexed.raw(["write-tree"])).trim();
    return (
      await repo.raw([
        "commit-tree",
        "--no-gpg-sign",
        tree,
        "-m",
        `${title} as imported`,
      ])
    ).trim();
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** How a published root reads: its version tag, else "version". */
async function releaseName(repo, commit) {
  const [tag] = (await repo.raw(["tag", "--points-at", commit]))
    .split("\n")
    .filter(Boolean);
  return tag ? tag.replace(/^v/, "") : "version";
}

/**
 * A world rooted at a snapshot commit because its template had no clone yet
 * (made before templates were repositories) moves to the published commit its
 * snapshot matches, once the clone is there. Only while nothing was built on
 * that root: one commit, no other branch or save.
 */
async function reroot(repo, world, rooted, title) {
  const [, ...parents] = (
    await repo.raw(["rev-list", "--parents", "-n1", rooted])
  )
    .trim()
    .split(" ");
  const subject = (await repo.raw(["log", "-1", "--format=%s", rooted])).trim();
  if (parents.length || !subject.endsWith(" as imported")) return [];
  const refs = (await repo.raw(["for-each-ref", "--format=%(refname)"]))
    .split("\n")
    .filter(Boolean)
    .filter(
      (ref) =>
        ref !== `refs/heads/${PLAY}` &&
        !ref.startsWith(`refs/remotes/${UPSTREAM}/`) &&
        !ref.startsWith("refs/tags/"),
    );
  if (refs.length) return [];
  const snapshot = snapshotOf(world);
  const published = snapshot && (await publishedMatch(repo, snapshot));
  if (!published) return [];
  // Moving the index would lose what's staged; keep it, and the old root.
  if (
    (await repo.raw(["diff-index", "--cached", "--name-only", rooted])).trim()
  )
    return [];
  await repo.raw(["update-ref", `refs/heads/${PLAY}`, published, rooted]);
  await repo.raw(["read-tree", published]);
  return [
    `${title}'s history now starts at its published ${await releaseName(repo, published)} (${published.slice(0, 7)}).`,
  ];
}

/**
 * Makes `world/` a repository on its first start and keeps it set up on every
 * later one. A world's history starts at the published commit whose files and
 * text match its `.template/` (the template as imported or last updated), else
 * at a root commit of that snapshot, else (a world from before snapshots) at
 * its first save. Only the branch and the index move; the world's files are
 * never touched.
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
  const pkg = readJson(manifest);
  const title = pkg.displayName ?? pkg.name;
  const fresh = !existsSync(path.join(world, ".git"));
  if (fresh) await gitIn(git, world).raw(["init", `--initial-branch=${PLAY}`]);
  const repo = gitIn(git, world);
  for (const [key, value] of [
    ["core.autocrlf", "false"],
    ["core.quotePath", "false"],
    ["commit.gpgSign", "false"],
    ["tag.gpgSign", "false"],
    ["user.name", "Kazusa"],
    ["user.email", "kazusa@localhost"],
  ])
    await repo.raw(["config", key, value]);
  mkdirSync(path.join(world, ".git/info"), { recursive: true });
  writeFileSync(path.join(world, ".git/info/exclude"), EXCLUDE);
  writeFileSync(path.join(world, ".git/info/attributes"), ATTRIBUTES);

  // Where the world lives: its own `repository`, else the source it came from.
  const id = pkg.kazusa?.template;
  const url = worldUrl(root, pkg);
  const remotes = (await repo.raw(["remote"])).split("\n");
  if (url)
    await repo.raw(
      remotes.includes(UPSTREAM)
        ? ["remote", "set-url", UPSTREAM, url]
        : ["remote", "add", UPSTREAM, url],
    );
  // What was published, from the template's clone: no network, and the same
  // commits its remote has.
  const clone = id ? path.join(root, WORLDS, id) : undefined;
  const hasRemote = Boolean(clone && existsSync(path.join(clone, ".git")));
  if (hasRemote)
    await repo.raw([
      "fetch",
      "--quiet",
      "--prune",
      "--force",
      clone,
      `+refs/remotes/origin/*:refs/remotes/${UPSTREAM}/*`,
      "+refs/tags/*:refs/tags/*",
    ]);

  const rooted = await repo
    .raw(["rev-parse", "--verify", "--quiet", `refs/heads/${PLAY}`])
    .then((value) => value.trim())
    .catch(() => "");
  if (rooted) {
    if (hasRemote) lines.push(...(await reroot(repo, world, rooted, title)));
    return lines;
  }
  const snapshot = snapshotOf(world);
  if (!snapshot) {
    if (fresh)
      lines.push(
        `${title} has no record of the template it was made from, so its history starts at its first save.`,
      );
    return lines;
  }
  const published = hasRemote
    ? await publishedMatch(repo, snapshot)
    : undefined;
  const base = published ?? (await snapshotCommit(git, world, snapshot, title));
  await repo.raw(["update-ref", `refs/heads/${PLAY}`, base]);
  await repo.raw(["read-tree", base]);
  lines.push(
    published
      ? `${title}'s history starts at its published ${await releaseName(repo, base)} (${base.slice(0, 7)}).`
      : `${title}'s template matches no published version, so its history starts at the template as imported (${base.slice(0, 7)}).`,
  );
  return lines;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const [command, id] = process.argv.slice(2);
  const commands = {
    list: async () => ({ worlds: await listWorlds(root) }),
    clone: async () => ({ lines: await fetchWorld(root, id) }),
    check: () => checkLiveWorld(root),
    download: async () => ({ lines: await downloadLiveWorld(root) }),
  };
  if (command in commands)
    // One JSON object for the client, `{ error }` when it fails.
    try {
      process.stdout.write(JSON.stringify(await commands[command]()));
    } catch (error) {
      process.exitCode = 1;
      process.stdout.write(JSON.stringify({ error: error.message.trim() }));
    }
  // A world without history, or an old template, still plays.
  else
    try {
      for (const line of await adoptWorldRepo(root)) console.log(line);
    } catch (error) {
      console.warn(`Couldn't set up this world's history: ${error.message}`);
    }
}
