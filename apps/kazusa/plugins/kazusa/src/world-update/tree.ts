import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import type { Git } from "../world/git.ts";

/**
 * The two sides of a world update read the same way: the release and the base
 * from git (`commitTree`), and folders in tests (`folderTree`). Only the
 * world's own files count: `shared/`, `workspaces/` and `package.json`.
 */

const PARTS = ["shared", "workspaces"] as const;
const PACKAGE = "package.json";
/** Files read as text; the rest (pictures) are only compared and copied. */
const TEXT = /\.(md|json|txt)$/;

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
    if (WORLD_FILE.test(file) && !SKIPPED.test(file)) files.set(file, id);
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

/** World-relative paths of the files an update covers. */
export function filesOf(root: string): string[] {
  const out: string[] = [];
  const walk = (relative: string) => {
    const full = path.join(root, relative);
    for (const entry of readdirSync(full, { withFileTypes: true })) {
      const child = path.join(relative, entry.name);
      if (entry.name === ".DS_Store" || entry.name.endsWith(".tmp")) continue;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) walk(child);
      else if (entry.isFile()) out.push(child.split(path.sep).join("/"));
    }
  };
  for (const part of PARTS) if (existsSync(path.join(root, part))) walk(part);
  if (existsSync(path.join(root, PACKAGE))) out.push(PACKAGE);
  return out.sort();
}

/**
 * One side of a merge: which files it has (by blob id), each text file's text,
 * and how to copy its files into the world.
 */
export interface Tree {
  readonly ids: ReadonlyMap<string, string>;
  readonly text: (file: string) => string | undefined;
  readonly copy: (files: readonly string[], live: string) => void;
}

/** A folder as one side (tests). */
export function folderTree(dir: string): Tree {
  return {
    ids: new Map(
      filesOf(dir).map((file) => [
        file,
        blobId(readFileSync(path.join(dir, file))),
      ]),
    ),
    text: (file) =>
      existsSync(path.join(dir, file))
        ? readFileSync(path.join(dir, file), "utf8")
        : undefined,
    copy: (files, live) => {
      for (const file of files) {
        mkdirSync(path.dirname(path.join(live, file)), { recursive: true });
        writeFileSync(
          path.join(live, file),
          readFileSync(path.join(dir, file)),
        );
      }
    },
  };
}

/** A commit as one side: its text read from git in one batch, when first asked. */
export function commitTree(git: Git, commit: string): Tree {
  const ids = filesAt(git, commit);
  let texts: Map<string, Buffer> | undefined;
  return {
    ids,
    text: (file) => {
      const id = ids.get(file);
      if (!id) return undefined;
      texts ??= readBlobs(
        git,
        [...ids].filter(([name]) => TEXT.test(name)).map(([, blob]) => blob),
      );
      return (texts.get(id) ?? readBlobs(git, [id]).get(id))?.toString("utf8");
    },
    copy: (files) => copyFiles(git, commit, files),
  };
}
