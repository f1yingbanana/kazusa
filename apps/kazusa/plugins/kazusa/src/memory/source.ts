import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import type { WikiKind, WikiSourceResponse } from "@kazusa/client";

/** Where a new page of each kind goes, in either wiki. */
export const PAGE_DIRECTORY: Readonly<Record<WikiKind, string>> = {
  person: "characters",
  concept: "concepts",
  day: "days",
};

/** Deprecated: where a world not yet upgraded keeps new pages. */
const OLDER_DIRECTORY: Readonly<Record<WikiKind, string>> = {
  person: path.join("entities", "characters"),
  concept: "concepts",
  day: "days",
};

/**
 * Where a new page goes: `characters/` or `concepts/`, or in a world not yet
 * upgraded (no `characters/`, but `entities/`), where it kept them.
 */
export function pageDirectory(
  root: string,
  kind: WikiKind,
  place = false,
): string {
  const older =
    !existsSync(path.join(root, "characters")) &&
    existsSync(path.join(root, "entities"));
  if (!older) return PAGE_DIRECTORY[kind];
  return place ? path.join("entities", "places") : OLDER_DIRECTORY[kind];
}

const hash = (text: string): string =>
  createHash("sha256").update(text).digest("hex");

/** A page's id is its file name, so the file is found by walking the root. */
function findPage(root: string, id: string): string | undefined {
  const name = `${id}.md`;
  const walk = (directory: string): string | undefined => {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return undefined;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const filename = path.join(directory, entry.name);
      if (entry.isFile() && entry.name === name) return filename;
      if (entry.isDirectory()) {
        const found = walk(filename);
        if (found) return found;
      }
    }
    return undefined;
  };
  return walk(root);
}

/** One page as written, or where it would go when it isn't yet. */
export function readSource(
  root: string,
  id: string,
  kind: WikiKind = "concept",
): WikiSourceResponse {
  const file =
    findPage(root, id) ??
    path.join(root, pageDirectory(root, kind), `${id}.md`);
  const text = existsSync(file) ? readFileSync(file, "utf8") : undefined;
  return {
    id,
    path: path.relative(root, file).split(path.sep).join("/"),
    text: text ?? "",
    exists: text !== undefined,
    hash: text === undefined ? null : hash(text),
  };
}

export class SourceConflict extends Error {
  readonly current: WikiSourceResponse;

  constructor(current: WikiSourceResponse) {
    super(
      current.exists
        ? "This page changed since you opened it."
        : "This page was removed since you opened it.",
    );
    this.current = current;
  }
}

/**
 * Writes a page by hand. With `base`, only over the version that was read: a
 * night's sleep or a character's note made meanwhile is never lost silently.
 */
export function saveSource(
  root: string,
  input: {
    readonly id: string;
    readonly kind?: WikiKind;
    readonly text: string;
    readonly base?: string | null;
  },
): WikiSourceResponse {
  const current = readSource(root, input.id, input.kind);
  if (input.base !== undefined && input.base !== current.hash)
    throw new SourceConflict(current);
  const file = path.join(root, current.path);
  const text = input.text.endsWith("\n") ? input.text : `${input.text}\n`;
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${randomUUID()}.tmp`,
  );
  writeFileSync(temporary, text, { flag: "wx" });
  renameSync(temporary, file);
  return readSource(root, input.id, input.kind);
}

/** Deletes a page for good. With `base`, only the version that was read. */
export function deleteSource(
  root: string,
  input: { readonly id: string; readonly base?: string | null },
): WikiSourceResponse {
  const current = readSource(root, input.id);
  if (
    !current.exists ||
    (input.base !== undefined && input.base !== current.hash)
  )
    throw new SourceConflict(current);
  unlinkSync(path.join(root, current.path));
  return current;
}
