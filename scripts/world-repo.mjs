#!/usr/bin/env node
/**
 * Each live world is its own git repository (the kazusa skill's
 * `references/worlds.md` §4.5): its history starts at the published commit it
 * was made from, so updates and publishing later have the right base. Rooting
 * it there is what can't be done afterwards, so it happens before the Gateway
 * first starts on a world, new or old, from `scripts/dev.mjs` (installed copies
 * too) and from `npm run gateway`. Nothing is committed here: commits are
 * saves, made with the Gateway stopped.
 *
 * Until the platform hosts worlds, each template's remote is a bare repository
 * in `apps/kazusa/.remotes/<name>.git`, built from this repository's own
 * history of `apps/kazusa/worlds/<id>`, so every copy gets the same commit ids.
 * Clones build it on start; installers ship it (`scripts/package.mjs`).
 *
 * Git is the one shipped beside Kazusa (`git/`, GitHub Desktop's portable
 * build), else the system's.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { simpleGit } from "simple-git";

const WORLDS = "apps/kazusa/worlds";
const WORLD = "apps/kazusa/world";
export const REMOTES = "apps/kazusa/.remotes";
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
.DS_Store
*.tmp
`;
// No delta between SQLite versions exists to find (worlds.md §4.6).
const ATTRIBUTES = "*.sqlite binary -delta\n";
// Fixed, so every build of a mock remote gives the same commit ids.
const PUBLISHER = { name: "Kazusa", email: "worlds@openrp.ai" };
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

function gitIn(git, dir, extraEnv = {}) {
  const ours = { ...git.env, ...extraEnv };
  return simpleGit({
    baseDir: dir,
    binary: git.binary,
    unsafe: git.unsafe,
    allowEnvironment: Object.keys(ours).filter((key) => GUARDED_ENV.test(key)),
  }).env({ ...baseEnv(), ...ours });
}

const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));

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

/**
 * Builds or refreshes one bare repository per template from this repository's
 * first-parent history: a commit for each commit that changed the template,
 * holding the template's tree, with the publisher, date and subject fixed by
 * that commit, and `v<version>` on the last commit of each version. Same
 * history, same ids, wherever it's built. A copy without that history (an
 * installed one, a source download, a shallow clone) builds nothing and keeps
 * what it has.
 */
export async function buildRemotes(root, out = path.join(root, REMOTES)) {
  const git = findGit(root);
  if (!git || !existsSync(path.join(root, ".git"))) return [];
  const source = gitIn(git, root);
  if (
    (await source.raw(["rev-parse", "--is-shallow-repository"])).trim() ===
    "true"
  )
    return [];
  const head = (await source.revparse(["HEAD"])).trim();
  const lines = [];
  for (const id of readdirSync(path.join(root, WORLDS)).sort()) {
    const manifest = path.join(root, WORLDS, id, "package.json");
    if (!existsSync(manifest)) continue;
    const { name } = readJson(manifest);
    const bare = path.join(out, `${name}.git`);
    if (!existsSync(bare)) {
      mkdirSync(bare, { recursive: true });
      await gitIn(git, bare).raw(["init", "--bare", "--initial-branch=main"]);
    }
    const remote = gitIn(git, bare);
    const built = await remote
      .raw(["config", "--get", "kazusa.source"])
      .catch(() => "");
    if (built.trim() === head) continue;
    const folder = `${WORLDS}/${id}`;
    const log = await source.raw([
      "log",
      "--first-parent",
      "--reverse",
      "--format=%H%x09%ct%x09%s",
      "HEAD",
      "--",
      folder,
    ]);
    let tip;
    let tree;
    const tags = new Map();
    for (const line of log.split("\n").filter(Boolean)) {
      const [sha, time, ...subject] = line.split("\t");
      const next = await source
        .revparse([`${sha}:${folder}`])
        .then((value) => value.trim())
        .catch(() => undefined);
      if (!next || next === tree) continue;
      tree = next;
      const date = `${time} +0000`;
      tip = (
        await gitIn(git, root, {
          GIT_AUTHOR_NAME: PUBLISHER.name,
          GIT_AUTHOR_EMAIL: PUBLISHER.email,
          GIT_AUTHOR_DATE: date,
          GIT_COMMITTER_NAME: PUBLISHER.name,
          GIT_COMMITTER_EMAIL: PUBLISHER.email,
          GIT_COMMITTER_DATE: date,
        }).raw([
          "commit-tree",
          "--no-gpg-sign",
          tree,
          ...(tip ? ["-p", tip] : []),
          "-m",
          subject.join("\t"),
          "-m",
          `Kazusa-Commit: ${sha}`,
        ])
      ).trim();
      const version = await source
        .show([`${sha}:${folder}/package.json`])
        .then((text) => JSON.parse(text).version)
        .catch(() => undefined);
      if (version) tags.set(`v${version}`, tip);
    }
    if (!tip) continue;
    await source.raw([
      "push",
      "--quiet",
      "--force",
      bare,
      `${tip}:refs/heads/main`,
      ...[...tags].map(([tag, commit]) => `+${commit}:refs/tags/${tag}`),
    ]);
    await remote.raw(["config", "kazusa.source", head]);
    lines.push(`Built the ${name} remote.`);
  }
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
      "This world's history is off: git isn't installed. On a Mac, install the developer tools (xcode-select --install).",
    ];
  const lines = await buildRemotes(root).catch((error) => [
    `Couldn't build the template remotes: ${error.message}`,
  ]);
  const pkg = readJson(manifest);
  const title = pkg.displayName ?? pkg.name;
  if (!existsSync(path.join(world, ".git")))
    await gitIn(git, world).raw(["init", `--initial-branch=${PLAY}`]);
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

  const remote = path.join(root, REMOTES, `${pkg.name}.git`);
  const remotes = (await repo.raw(["remote"])).split("\n");
  const hasRemote = existsSync(remote);
  if (hasRemote) {
    // Kept current: an installed copy can move.
    await repo.raw(
      remotes.includes(UPSTREAM)
        ? ["remote", "set-url", UPSTREAM, remote]
        : ["remote", "add", UPSTREAM, remote],
    );
    await repo.raw([
      "fetch",
      "--quiet",
      "--prune",
      "--tags",
      "--force",
      UPSTREAM,
    ]);
  }

  const rooted = await repo
    .raw(["rev-parse", "--verify", "--quiet", `refs/heads/${PLAY}`])
    .then((value) => value.trim())
    .catch(() => "");
  if (rooted) return lines;
  const snapshot = snapshotOf(world);
  if (!snapshot) {
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
      ? `${title}'s history starts at its published ${pkg.version ?? "version"} (${base.slice(0, 7)}).`
      : `${title}'s template matches no published version, so its history starts at the template as imported (${base.slice(0, 7)}).`,
  );
  return lines;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  try {
    const lines =
      process.argv[2] === "remotes"
        ? await buildRemotes(root, path.resolve(process.argv[3] ?? REMOTES))
        : await adoptWorldRepo(root);
    for (const line of lines) console.log(line);
  } catch (error) {
    // A world without history still plays.
    console.warn(`Couldn't set up this world's history: ${error.message}`);
  }
}
