#!/usr/bin/env node
/**
 * Moves this copy of Kazusa to the latest release or to the latest `main`,
 * keeping the player's world. Copies differ in what they can update with:
 *
 * - **git**: a clone, with git installed. Fetches from GitHub and checks out.
 * - **packaged**: the installer's copy, running on its own Node. Swaps in the
 *   archive the release workflow builds for this system, so only releases:
 *   nothing here can build `main`.
 * - **source**: anything else, such as GitHub's source zip. Swaps in GitHub's
 *   source archive and reinstalls dependencies.
 *
 * Nothing changes while Kazusa runs. `stage` only downloads and leaves
 * `.update/pending.json`; `scripts/dev.mjs` sees it, stops the Gateway and the
 * frontend, applies it and starts the new version.
 *
 * `node scripts/update.mjs check | stage <release|development>` prints JSON,
 * for the frontend's `/update` route.
 */
import { execFileSync } from "node:child_process";
import {
  cpSync,
  createWriteStream,
  existsSync,
  lstatSync,
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
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO = "f1yingbanana/kazusa";
const API = `https://api.github.com/repos/${REPO}`;
const WORLD = "apps/kazusa/world";
/** `scripts/package.mjs` targets, by `${process.platform}-${process.arch}`. */
const PACKAGE_TARGETS = {
  "darwin-arm64": "darwin-arm64",
  "win32-x64": "win-x64",
};
// Git for Windows puts a GNU tar on the PATH that reads `C:` as a remote host.
const TAR =
  process.platform === "win32"
    ? path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe")
    : "tar";
/** How a compare of current against target reads, from the target's side. */
const STANDING = {
  ahead: "newer",
  diverged: "newer",
  identical: "current",
  behind: "older",
};

export function updatePaths(root) {
  const dir = path.join(root, ".update");
  return {
    dir,
    pending: path.join(dir, "pending.json"),
    failed: path.join(dir, "failed.json"),
    /** Left when an update's `npm ci` failed, for `scripts/dev.mjs` to redo. */
    reinstall: path.join(dir, "reinstall"),
  };
}

function messageOf(error) {
  const stderr = error?.stderr?.toString().trim();
  return stderr || (error instanceof Error ? error.message : String(error));
}

function git(root, args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    // A checkout across many versions can say a lot.
    maxBuffer: 64 * 1024 * 1024,
  }).trim();
}

function tryGit(root, args) {
  try {
    return git(root, args);
  } catch {
    return undefined;
  }
}

function readOptional(file) {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
}

function writeJson(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(`${file}.tmp`, JSON.stringify(value, null, 2));
  renameSync(`${file}.tmp`, file);
}

export function installKind(root) {
  if (path.dirname(process.execPath) === path.join(root, "node"))
    return "packaged";
  if (existsSync(path.join(root, ".git")) && tryGit(root, ["--version"]))
    return "git";
  return "source";
}

/**
 * What GitHub can compare a version against: the commit in a `git describe`
 * name (`0.1.3-2-gef08f9b`), else the name itself, which is a release tag.
 */
export function refOf(version) {
  return /-g([0-9a-f]{7,40})$/.exec(version)?.[1] ?? version;
}

function current(root, kind) {
  if (kind === "git")
    return {
      version: git(root, [
        "describe",
        "--tags",
        "--always",
        "--abbrev=7",
        "--match",
        "[0-9]*",
        "--match",
        "v[0-9]*",
      ]),
      ref: git(root, ["rev-parse", "HEAD"]),
      branch: tryGit(root, ["symbolic-ref", "--short", "-q", "HEAD"]) || null,
      dirty:
        git(root, ["status", "--porcelain", "--untracked-files=no"]) !== "",
    };
  const version = readOptional(path.join(root, "VERSION"))?.trim() || null;
  return {
    version,
    ref: version && refOf(version),
    branch: null,
    dirty: false,
  };
}

/** Why this copy can't update itself, if it can't. */
function blockedReason(here) {
  if (here.dirty)
    return "This copy has changes of its own. Commit or stash them, then update.";
  // Only `scripts/dev.mjs` can stop everything, apply the update and restart.
  if (!process.env.KAZUSA_SUPERVISED)
    return "Kazusa wasn't started with npm run dev or its app, so it can't restart itself to update.";
  return null;
}

async function github(pathname) {
  let response;
  try {
    response = await fetch(`${API}${pathname}`, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "kazusa-updater",
      },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error("Couldn't reach GitHub.");
  }
  if (response.status === 404) return undefined;
  if (response.status === 403 || response.status === 429)
    throw new Error(
      "GitHub is limiting update checks. Try again in a few minutes.",
    );
  if (!response.ok) throw new Error(`GitHub answered ${response.status}.`);
  return response.json();
}

function packagedArchive(release) {
  const target = PACKAGE_TARGETS[`${process.platform}-${process.arch}`];
  const asset = release.assets?.find((entry) =>
    entry.name.endsWith(`-${target}.tar.gz`),
  );
  return asset?.browser_download_url ?? null;
}

function sourceArchive(ref) {
  return `https://codeload.github.com/${REPO}/tar.gz/${ref}`;
}

async function latestRelease(kind) {
  const release = await github("/releases/latest");
  if (!release) return null;
  return {
    version: release.tag_name,
    ref: release.tag_name,
    date: release.published_at,
    url: release.html_url,
    archive:
      kind === "packaged"
        ? packagedArchive(release)
        : sourceArchive(release.tag_name),
  };
}

/** A packaged copy can see how far `main` is ahead, but not install it. */
async function latestDevelopment(kind) {
  const commit = await github("/commits/main");
  return {
    version: commit.sha.slice(0, 7),
    ref: commit.sha,
    date: commit.commit.committer.date,
    url: commit.html_url,
    archive: kind === "packaged" ? null : sourceArchive(commit.sha),
  };
}

/** Where `target` stands against `base`, and how many commits it adds. */
async function standing(base, target) {
  if (!base) return { status: "unknown", changes: null };
  if (base === target) return { status: "current", changes: 0 };
  const compare = await github(
    `/compare/${encodeURIComponent(base)}...${encodeURIComponent(target)}?per_page=1`,
  );
  // GitHub doesn't know a commit that was never pushed.
  if (!compare) return { status: "unknown", changes: null };
  return {
    status: STANDING[compare.status] ?? "unknown",
    changes: compare.ahead_by,
  };
}

async function describeTarget(here, target) {
  if (!target) return null;
  return {
    version: target.version,
    date: target.date,
    url: target.url,
    installable: target.archive !== null,
    ...(await standing(here.ref, target.ref)),
  };
}

export async function check(root) {
  const kind = installKind(root);
  const here = current(root, kind);
  const failed = readOptional(updatePaths(root).failed);
  const status = {
    current: { version: here.version, branch: here.branch },
    release: null,
    development: null,
    blocked: blockedReason(here),
    failed: failed ? JSON.parse(failed) : null,
    error: null,
  };
  try {
    const [release, development] = await Promise.all([
      latestRelease(kind),
      latestDevelopment(kind),
    ]);
    status.release = await describeTarget(here, release);
    status.development = await describeTarget(here, development);
  } catch (error) {
    status.error = messageOf(error);
  }
  return status;
}

/** A name for an archive of `main`, as `git describe` would give it. */
async function describeCommit(sha) {
  const release = await github("/releases/latest");
  if (!release) return sha.slice(0, 7);
  const { changes } = await standing(release.tag_name, sha);
  return changes
    ? `${release.tag_name}-${changes}-g${sha.slice(0, 7)}`
    : release.tag_name;
}

/** Extracts into the system's temp folder, whose short path Windows needs. */
async function download(url, stripComponents) {
  const work = mkdtempSync(path.join(tmpdir(), "kz-"));
  const archive = path.join(work, "download.tar.gz");
  let response;
  try {
    response = await fetch(url, {
      headers: { "User-Agent": "kazusa-updater" },
      signal: AbortSignal.timeout(30 * 60_000),
    });
  } catch {
    throw new Error("Couldn't reach GitHub to download the update.");
  }
  if (!response.ok || !response.body)
    throw new Error(`The download failed (HTTP ${response.status}).`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(archive));
  const tree = path.join(work, "t");
  mkdirSync(tree);
  execFileSync(
    TAR,
    ["-xzf", archive, "-C", tree, `--strip-components=${stripComponents}`],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  rmSync(archive);
  return tree;
}

/**
 * Gets the update ready without touching this copy, and leaves it for
 * `scripts/dev.mjs` to apply.
 */
export async function stage(root, to) {
  const kind = installKind(root);
  const here = current(root, kind);
  const blocked = blockedReason(here);
  if (blocked) throw new Error(blocked);
  if (kind === "packaged" && to === "development")
    throw new Error(
      "Development builds need a copy installed with git and Node.js.",
    );
  const target =
    to === "release"
      ? await latestRelease(kind)
      : await latestDevelopment(kind);
  if (!target) throw new Error("There's no release yet.");
  let pending;
  if (kind === "git") {
    const ref =
      to === "release" ? `refs/tags/${target.ref}` : "refs/heads/main";
    try {
      git(root, [
        "fetch",
        "--tags",
        "--force",
        `https://github.com/${REPO}.git`,
        ref,
      ]);
    } catch (error) {
      throw new Error(`Couldn't fetch the update: ${messageOf(error)}`, {
        cause: error,
      });
    }
    const commit = git(root, ["rev-parse", "FETCH_HEAD^{commit}"]);
    if (
      to === "development" &&
      tryGit(root, ["rev-parse", "--verify", "-q", "refs/heads/main"]) &&
      tryGit(root, ["merge-base", "--is-ancestor", "main", commit]) ===
        undefined
    )
      throw new Error(
        "Your main branch has commits of its own, so it can't move to the latest. Update it with git.",
      );
    pending = { kind, to, version: target.version, commit };
  } else {
    if (!target.archive)
      throw new Error("This build has no download for this system.");
    const packaged = kind === "packaged";
    pending = {
      kind,
      to,
      version:
        to === "development"
          ? await describeCommit(target.ref)
          : target.version,
      // GitHub's source archives hold one folder named for the commit.
      dir: await download(target.archive, packaged ? 0 : 1),
    };
  }
  writeJson(updatePaths(root).pending, pending);
  return { version: pending.version };
}

function move(from, to) {
  mkdirSync(path.dirname(to), { recursive: true });
  try {
    renameSync(from, to);
  } catch (error) {
    // The temp folder can be on another drive.
    if (error.code !== "EXDEV") throw error;
    cpSync(from, to, { recursive: true, verbatimSymlinks: true });
    rmSync(from, { recursive: true, force: true });
  }
}

function exists(file) {
  try {
    lstatSync(file);
    return true;
  } catch {
    return false;
  }
}

/**
 * Moves each entry of `from` over the same entry in `to`, setting the old one
 * aside in `trash`. Folders in `within` are merged entry by entry instead, so
 * `keep` and anything only `to` has inside them stay. A failure puts every
 * entry back as it was.
 */
export function replaceTree(from, to, { keep = [], within = [], trash }) {
  const done = [];
  const visit = (relative) => {
    for (const entry of readdirSync(path.join(from, relative), {
      withFileTypes: true,
    })) {
      const child = relative ? `${relative}/${entry.name}` : entry.name;
      if (keep.includes(child)) continue;
      const target = path.join(to, child);
      if (within.includes(child) && entry.isDirectory()) {
        mkdirSync(target, { recursive: true });
        visit(child);
        continue;
      }
      const old = exists(target) ? path.join(trash, child) : null;
      if (old) move(target, old);
      done.push({ source: path.join(from, child), target, old });
      move(path.join(from, child), target);
    }
  };
  try {
    visit("");
  } catch (error) {
    for (const { source, target, old } of done.reverse()) {
      if (exists(target)) move(target, source);
      if (old && exists(old)) move(old, target);
    }
    throw error;
  }
}

/**
 * Best effort: on Windows, the Node that ran the last update can still be
 * running, and can't be deleted until it stops.
 */
export function clearTrash(root) {
  const { dir } = updatePaths(root);
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir).filter((entry) =>
    entry.startsWith("old-"),
  ))
    try {
      rmSync(path.join(dir, name), { recursive: true, force: true });
    } catch {
      // Next time.
    }
}

function checkout(root, { to, commit }) {
  if (to === "release") {
    git(root, ["checkout", "--quiet", "--detach", commit]);
    return;
  }
  if (!tryGit(root, ["rev-parse", "--verify", "-q", "refs/heads/main"])) {
    git(root, ["checkout", "--quiet", "-b", "main", commit]);
    return;
  }
  git(root, ["checkout", "--quiet", "main"]);
  git(root, ["merge", "--quiet", "--ff-only", commit]);
}

function npmCi(root) {
  console.log("Installing dependencies.");
  execFileSync("npm", ["ci", "--no-audit", "--no-fund"], {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
}

/**
 * Applies a staged update. Only while nothing else runs from this copy. Returns
 * undefined when nothing is staged. A failure while changing files puts them
 * back; one in `npm ci` after is `applied`, and the next start installs again.
 */
export function applyPending(root) {
  const paths = updatePaths(root);
  const saved = readOptional(paths.pending);
  if (!saved) return undefined;
  const plan = JSON.parse(saved);
  // Once, even if it fails: a broken update shouldn't retry on every start.
  rmSync(paths.pending);
  clearTrash(root);
  const lockfile = path.join(root, "package-lock.json");
  const lockBefore = readOptional(lockfile);
  try {
    if (plan.kind === "git") checkout(root, plan);
    else {
      if (!existsSync(plan.dir))
        throw new Error("The download is gone. Try updating again.");
      replaceTree(plan.dir, root, {
        keep: [WORLD],
        // `node` holds the Node running this, which Windows can only move aside.
        within:
          plan.kind === "packaged"
            ? ["apps", "apps/kazusa", "node"]
            : ["apps", "apps/kazusa"],
        trash: path.join(paths.dir, `old-${Date.now()}`),
      });
      if (plan.kind === "source")
        writeFileSync(path.join(root, "VERSION"), `${plan.version}\n`);
    }
    rmSync(paths.failed, { force: true });
  } catch (error) {
    const failure = { version: plan.version, error: messageOf(error) };
    writeJson(paths.failed, failure);
    return { ok: false, applied: false, ...failure };
  } finally {
    if (plan.dir)
      rmSync(path.dirname(plan.dir), { recursive: true, force: true });
  }
  // A source swap also drops the workspaces' own `node_modules`.
  if (
    plan.kind === "source" ||
    (plan.kind === "git" && readOptional(lockfile) !== lockBefore)
  )
    try {
      npmCi(root);
    } catch (error) {
      writeFileSync(paths.reinstall, "");
      return {
        ok: false,
        applied: true,
        version: plan.version,
        error: messageOf(error),
      };
    }
  return { ok: true, version: plan.version };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [command, to] = process.argv.slice(2);
  try {
    let result;
    if (command === "check") result = await check(ROOT);
    else if (command === "stage" && (to === "release" || to === "development"))
      result = await stage(ROOT, to);
    else throw new Error("Use: update.mjs check | stage <release|development>");
    process.stdout.write(JSON.stringify(result));
  } catch (error) {
    process.stdout.write(JSON.stringify({ error: messageOf(error) }));
    process.exitCode = 1;
  }
}
