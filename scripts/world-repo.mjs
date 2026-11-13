#!/usr/bin/env node
/**
 * Worlds are git repositories (the kazusa skill's `references/worlds.md` §4.5).
 *
 * Templates: `apps/kazusa/world-sources.json` lists the worlds on offer. The
 * setup guide lists them by peeking at each one's `package.json` (`list`) and
 * clones only the one the player picks into `apps/kazusa/worlds/<id>` (`clone
 * <id>`), where setup and `world_update` read templates as before. Every start
 * fetches the clones there are and fast-forwards them when nobody has changed
 * them, so a creator can edit, commit and push from one.
 *
 * The live world: `world/` is its own repository, whose history starts at the
 * published commit it was made from, so updates and publishing later have the
 * right base. Rooting it there is what can't be done afterwards, so it happens
 * before the Gateway first starts on a world, new or old. Nothing is committed
 * here: commits are saves, made with the Gateway stopped.
 *
 * Starting runs from `scripts/dev.mjs` (installed copies too) and from `npm run
 * gateway`; the setup guide runs `list` and `clone`, which print JSON. Git is
 * the one shipped beside Kazusa (`git/`, GitHub Desktop's portable build), else
 * the system's.
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
 * Fetches each world cloned here and moves it to what was published, unless
 * someone has work there: a branch other than `main`, changes, or commits not
 * pushed. One that can't be reached (offline, gone) keeps what it had.
 */
export async function syncWorlds(root) {
  const git = findGit(root);
  if (!git) return [];
  const lines = [];
  // The world in play needs its template's clone for updates. One made before
  // templates were repositories has none: Kazusa's own update deleted the
  // folder it was copied from, or left it as it was then.
  const live = liveTemplate(root);
  if (
    live?.id &&
    readSources(root).some(({ id }) => id === live.id) &&
    !existsSync(path.join(root, WORLDS, live.id, ".git"))
  )
    try {
      lines.push(...(await cloneWorld(root, live.id)));
      lines.push(
        `Downloaded ${live.title}'s template, so this world can take its updates.`,
      );
    } catch (error) {
      lines.push(
        `Couldn't download ${live.title}'s template: ${error.message.trim()}`,
      );
    }
  // All at once: each is mostly waiting on the network.
  const results = await Promise.all(
    readSources(root)
      .filter(({ id }) => existsSync(path.join(root, WORLDS, id, ".git")))
      .map(({ id }) => syncWorld(git, root, id)),
  );
  return [...lines, ...results.flat()];
}

async function syncWorld(git, root, id) {
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
      await repo.raw(["rev-list", "--count", "HEAD..origin/main"])
    ).trim();
    if (behind === "0") return [];
    tracker.now();
    await repo.raw(["merge", "--progress", "--ff-only", "origin/main"]);
    return [];
  } catch (error) {
    return [`Couldn't update the ${id} world: ${gitError(error)}`];
  } finally {
    tracker.done();
  }
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
  const url =
    (typeof pkg.repository === "string"
      ? pkg.repository
      : pkg.repository?.url) ??
    readSources(root).find((source) => source.id === id)?.url;
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
  if (command === "list" || command === "clone")
    // One JSON object for the setup guide, `{ error }` when it fails.
    try {
      process.stdout.write(
        JSON.stringify(
          command === "list"
            ? { worlds: await listWorlds(root) }
            : { lines: await cloneWorld(root, id) },
        ),
      );
    } catch (error) {
      process.exitCode = 1;
      process.stdout.write(JSON.stringify({ error: error.message.trim() }));
    }
  // A world without history, or an old template, still plays.
  else
    for (const [what, step] of [
      ["the worlds", syncWorlds],
      ["this world's history", adoptWorldRepo],
    ])
      try {
        for (const line of await step(root)) console.log(line);
      } catch (error) {
        console.warn(`Couldn't set up ${what}: ${error.message}`);
      }
}
