#!/usr/bin/env node
/**
 * The frontend's world commands, each run as its own process (`runScript`):
 *
 * - `list`: the worlds `apps/kazusa/world-sources.json` offers, each peeked at
 *   for its `package.json` without downloading it.
 * - `clone <id>`: setup's download of the picked world, its newest release cloned
 *   into `apps/kazusa/world/`.
 * - `check`: whether the creator released something newer than the world stands
 *   on, nothing fetched.
 * - `download`: that release's tag fetched, once the player says so. The system
 *   agent's `world_update` merges it.
 *
 * `clone` and `download` print git's progress as JSON lines
 * (`{"progress":{stage,percent}}`); every command ends with one JSON object, `{
 * error }` when it fails. The git work itself is the plugin's
 * (`src/world/repo.ts`), which this imports as it is: Node runs TypeScript.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  findGit,
  repoGit,
  streamGit,
  text,
} from "../apps/kazusa/plugins/kazusa/src/world/git.ts";
import {
  commitOf,
  contains,
  cloneRelease,
  downloaded,
  fetchRelease,
  githubRepo,
  isClone,
  newestRemoteRelease,
  originOf,
  PLAY,
  releasePage,
  versionOf,
} from "../apps/kazusa/plugins/kazusa/src/world/repo.ts";

/** Which worlds there are and where each lives; later, providers such as OpenRP. */
export const SOURCES = "apps/kazusa/world-sources.json";
export const WORLD = "apps/kazusa/world";

const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));

/** `[{ id, provider, url }]`: the worlds this copy offers. */
export function readSources(root) {
  const file = path.join(root, SOURCES);
  return existsSync(file) ? (readJson(file).worlds ?? []) : [];
}

function gitOrFail(root) {
  const bin = findGit(root);
  if (!bin) throw new Error("git isn't installed.");
  return bin;
}

/** The URL the live world was cloned from; undefined when it isn't a clone. */
function clonedFrom(bin, world) {
  return isClone(world) ? originOf(repoGit(bin, world)) : undefined;
}

/**
 * What a world says about itself, without downloading it: a shallow clone with
 * no file contents, from which only `package.json` is read. About a second.
 */
async function peek(bin, url) {
  const scratch = mkdtempSync(path.join(tmpdir(), "kazusa-peek-"));
  try {
    const dir = path.join(scratch, "world");
    await streamGit(
      bin,
      [
        "clone",
        "--quiet",
        "--depth=1",
        "--filter=blob:none",
        "--no-checkout",
        url,
        dir,
      ],
      { cwd: scratch },
    );
    return JSON.parse(text(repoGit(bin, dir), ["show", "HEAD:package.json"]));
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/**
 * Every listed world with its `package.json`: the one cloned into `world/`
 * already reads its own, the rest are peeked at, all at once. One that can't be
 * reached says why instead.
 */
export async function listWorlds(root) {
  const bin = gitOrFail(root);
  const world = path.join(root, WORLD);
  const here = clonedFrom(bin, world);
  return Promise.all(
    readSources(root).map(async ({ id, url }) => {
      try {
        return here === url
          ? {
              id,
              url,
              downloaded: true,
              package: readJson(path.join(world, "package.json")),
            }
          : { id, url, downloaded: false, package: await peek(bin, url) };
      } catch (error) {
        return { id, url, error: error.message.trim() };
      }
    }),
  );
}

/**
 * Renames, waiting out a file another program holds for a moment: on Windows,
 * antivirus and the search indexer open what a clone just wrote.
 */
function move(from, to) {
  for (let wait = 100; ; wait *= 2) {
    try {
      renameSync(from, to);
      return;
    } catch (error) {
      if (!["EPERM", "EACCES", "EBUSY"].includes(error.code) || wait > 6400)
        throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, wait);
    }
  }
}

/** What a clone puts in `world/`; everything else there (`.state/`) is kept. */
const CLONED = [".git", "package.json", "shared", "workspaces"];

/**
 * Setup's download: the picked world cloned at its newest release into
 * `world/`, branch `play` at that commit. Cloned beside and moved in whole, so
 * a failed clone leaves nothing; only the world's own parts are replaced, so
 * what this machine already keeps there (`.state/`, the Gateway's token) stays.
 * A world already set up is never replaced; another pick that wasn't is.
 */
export async function cloneWorld(root, id, report) {
  const source = readSources(root).find((entry) => entry.id === id);
  if (!source) throw new Error(`No world ${id} is listed.`);
  const bin = gitOrFail(root);
  const world = path.join(root, WORLD);
  if (clonedFrom(bin, world) === source.url) return;
  if (existsSync(path.join(world, "openclaw.json")))
    throw new Error("A world is set up already.");
  const release = newestRemoteRelease(bin, source.url);
  const partial = `${world}.cloning`;
  rmSync(partial, { recursive: true, force: true });
  mkdirSync(path.dirname(world), { recursive: true });
  try {
    await cloneRelease(bin, source.url, release?.tag, partial, report);
  } catch (error) {
    rmSync(partial, { recursive: true, force: true });
    throw error;
  }
  mkdirSync(world, { recursive: true });
  for (const part of CLONED)
    rmSync(path.join(world, part), { recursive: true, force: true });
  for (const part of readdirSync(partial))
    move(path.join(partial, part), path.join(world, part));
  rmSync(partial, { recursive: true, force: true });
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
 * Roughly what downloading `to` costs from `from`: every file `to` has that
 * `from` lacks, by content. Commits between the two can add a little more.
 */
export function downloadSize(from, to) {
  const had = new Set([...from.values()].map(({ sha }) => sha));
  let size = 0;
  for (const { sha, size: bytes } of to.values())
    if (!had.has(sha)) {
      had.add(sha);
      size += bytes;
    }
  return size;
}

/**
 * Whether the creator released something newer than the commit the world stands
 * on, nothing fetched: the newest release by `ls-remote`, new unless it's
 * `play`'s commit or in its history. Downloaded (its tag is here, as
 * `world_update` reads it): with its notes. Not downloaded: its size from
 * GitHub's file lists, display only, absent when GitHub can't say.
 */
export async function checkLiveWorld(root) {
  const world = path.join(root, WORLD);
  const bin = findGit(root);
  const url = bin && clonedFrom(bin, world);
  if (!url) return { checked: false };
  const git = repoGit(bin, world);
  const head = commitOf(git, PLAY);
  if (!head) return { checked: false };
  const current = { commit: head, version: versionOf(git) ?? null };
  const release = newestRemoteRelease(bin, url);
  if (!release) return { checked: true, current, latest: null, newer: false };
  const newer =
    release.commit !== head &&
    !(commitOf(git, release.commit) && contains(git, head, release.commit));
  const latest = {
    commit: release.commit,
    version: release.version,
    url: releasePage(url, release.tag),
  };
  if (!newer) return { checked: true, current, latest, newer: false };
  const here = downloaded(git, release);
  if (here)
    return {
      checked: true,
      current,
      latest: { ...latest, notes: here.notes, date: here.date },
      newer: true,
      downloaded: true,
    };
  let size;
  const github = githubRepo(url);
  if (github)
    try {
      const [from, to] = await Promise.all([
        githubTree(github, head).catch(() => new Map()),
        githubTree(github, release.commit),
      ]);
      size = downloadSize(from, to);
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

/** Downloads the newest release, once the player says so. */
export async function downloadLiveWorld(root, report) {
  const world = path.join(root, WORLD);
  const bin = gitOrFail(root);
  const url = clonedFrom(bin, world);
  if (!url) throw new Error("This world isn't a clone, so it can't download.");
  const release = newestRemoteRelease(bin, url);
  if (!release) throw new Error("The creator hasn't released anything yet.");
  try {
    await fetchRelease(bin, world, url, release.tag, report);
  } catch (error) {
    throw new Error(`Couldn't download it: ${error.message}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const [command, id] = process.argv.slice(2);
  const progress = (value) =>
    process.stdout.write(`${JSON.stringify({ progress: value })}\n`);
  const commands = {
    list: async () => ({ worlds: await listWorlds(root) }),
    clone: async () => (await cloneWorld(root, id, progress), {}),
    check: () => checkLiveWorld(root),
    download: async () => (await downloadLiveWorld(root, progress), {}),
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
  else {
    console.error(`Unknown command: ${command ?? "(none)"}`);
    process.exitCode = 2;
  }
}
