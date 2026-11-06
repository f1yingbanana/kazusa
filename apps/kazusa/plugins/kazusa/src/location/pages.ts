import { randomUUID } from "node:crypto";
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
import { z } from "zod";
import { readFrontmatter } from "../markdown/frontmatter.ts";

/**
 * Editing place pages so the map stays whole: a rename follows the place into
 * every page and card that names it, and a removal hands its areas and homes up
 * to the place it was in. Text is changed line by line, never re-serialized, so
 * what a person or a world's author wrote keeps its shape.
 */

export const PLACE_ID = /^[a-z0-9][a-z0-9_-]*$/u;

const OPENING = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A page's text with place ids renamed: its id, references to it, links. */
export function renamedText(
  text: string,
  renames: Record<string, string>,
): string {
  let next = text;
  for (const [from, to] of Object.entries(renames)) {
    next = next
      .replace(
        new RegExp(
          `^(\\s*(?:-\\s+)?(?:place_id|parent|home|to):\\s*)"?${escape(from)}"?[ \\t]*$`,
          "gm",
        ),
        `$1${to}`,
      )
      .replace(
        new RegExp(`(\\{\\s*to:\\s*)"?${escape(from)}"?(\\s*,)`, "g"),
        `$1${to}$2`,
      )
      .replace(
        new RegExp(`\\bentity\\.place\\.${escape(from)}\\b`, "g"),
        `entity.place.${to}`,
      )
      .replace(
        new RegExp(`\\[\\[${escape(from)}(\\s*(?:\\|[^\\]]*)?\\]\\])`, "g"),
        `[[${to}$1`,
      );
  }
  return next;
}

/**
 * A page's text once the place `id` is gone: an area it held is in `parent`
 * instead (top level when it had none), a home there moves to `parent`,
 * connections to it go, and links to it become plain text.
 */
export function withoutPlace(
  text: string,
  removed: {
    readonly id: string;
    readonly name: string;
    readonly parent?: string;
  },
): string {
  const { id, name, parent } = removed;
  const opening = OPENING.exec(text);
  const unlinked = (body: string) =>
    body.replace(
      new RegExp(`\\[\\[${escape(id)}\\s*(?:\\|([^\\]]*))?\\]\\]`, "g"),
      (_match, label: string | undefined) => label?.trim() || name,
    );
  if (!opening) return unlinked(text);
  const newline = opening[0].includes("\r\n") ? "\r\n" : "\n";
  const lines = opening[1].split(/\r?\n/u);
  const value = `"?${escape(id)}"?[ \\t]*$`;
  const out: string[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const key = new RegExp(`^(parent|home):\\s*${value}`).exec(line);
    if (key) {
      if (parent !== undefined) out.push(`${key[1]}: ${parent}`);
      // Without an area above it a home stays named, for lint to report.
      else if (key[1] === "home") out.push(line);
      continue;
    }
    if (new RegExp(`^\\s*-\\s*\\{\\s*to:\\s*"?${escape(id)}"?\\s*,`).test(line))
      continue;
    const item = new RegExp(`^(\\s*)-\\s+to:\\s*${value}`).exec(line);
    if (item) {
      // The rest of the item is indented further than its dash.
      const indent = item[1].length;
      while (
        index + 1 < lines.length &&
        /^\s*\S/u.test(lines[index + 1]) &&
        /^\s*/u.exec(lines[index + 1])![0].length > indent
      )
        index++;
      continue;
    }
    out.push(line);
  }
  // `connections:` with every item gone would read as null.
  const listed = out.findIndex((line) => /^connections:\s*$/u.test(line));
  if (listed !== -1 && !/^\s*-/u.test(out[listed + 1] ?? ""))
    out[listed] = "connections: []";
  return `---${newline}${out.join(newline)}${newline}---${newline}${unlinked(text.slice(opening[0].length))}`;
}

/** Writes a page whole or not at all. */
function writeAtomic(file: string, text: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${randomUUID()}.tmp`,
  );
  writeFileSync(temporary, text, { flag: "wx" });
  renameSync(temporary, file);
}

/** Every Markdown file under a wiki, hidden folders (trash, temp) skipped. */
function markdownUnder(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile() && entry.name.endsWith(".md")) found.push(file);
    }
  };
  walk(root);
  return found.sort();
}

/** Rewrites each page `change` changes; returns those, relative to `base`. */
function rewriteAll(
  files: readonly string[],
  base: string,
  change: (text: string) => string,
): string[] {
  const changed: string[] = [];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    const next = change(text);
    if (next === text) continue;
    writeAtomic(file, next);
    changed.push(path.relative(base, file).split(path.sep).join("/"));
  }
  return changed;
}

const PLACE_FIELDS = z.object({
  place_id: z.string().optional(),
  name: z.string().optional(),
  parent: z.string().optional(),
});

/** The page holding a place: `<id>.md`, else whichever says `place_id: <id>`. */
export function placeFile(wikiDir: string, id: string): string | undefined {
  const dir = path.join(wikiDir, "entities", "places");
  const named = path.join(dir, `${id}.md`);
  const fields = (file: string) => {
    try {
      return readFrontmatter(readFileSync(file, "utf8"), PLACE_FIELDS).data;
    } catch {
      return {};
    }
  };
  if (existsSync(named) && (fields(named).place_id ?? id) === id) return named;
  return markdownUnder(dir).find((file) => fields(file).place_id === id);
}

/**
 * Renames a place everywhere it is written: its page (moved to `<to>.md`),
 * every World Wiki page that names it, and in each wiki under `workspaces`, the
 * character's card and their links. Returns the pages rewritten besides its
 * own, relative to the Gateway's working directory.
 */
export function renamePlacePages(params: {
  readonly wikiDir: string;
  readonly workspaces: readonly string[];
  readonly from: string;
  readonly to: string;
  readonly cwd: string;
}): string[] {
  const { wikiDir, from, to, cwd } = params;
  if (!PLACE_ID.test(to))
    throw new Error(
      `"${to}" can't be a place id: use lowercase letters, digits, _ or -.`,
    );
  const source = placeFile(wikiDir, from);
  if (!source) throw new Error(`No place page for ${from}.`);
  const target = path.join(wikiDir, "entities", "places", `${to}.md`);
  if (placeFile(wikiDir, to) || existsSync(target))
    throw new Error(`There is already a place called ${to}.`);
  // Characters, places and concepts share one namespace of ids.
  const taken = markdownUnder(wikiDir).find(
    (file) => path.basename(file) === `${to}.md`,
  );
  if (taken)
    throw new Error(
      `There is already a page called ${to} (${path.relative(wikiDir, taken)}).`,
    );
  const renames = { [from]: to };
  // The new page first: there is never a moment with neither.
  writeAtomic(target, renamedText(readFileSync(source, "utf8"), renames));
  unlinkSync(source);
  const change = (text: string) => renamedText(text, renames);
  const changed = rewriteAll(
    markdownUnder(wikiDir).filter((file) => file !== target),
    cwd,
    change,
  );
  for (const workspace of params.workspaces) {
    const root = path.join(workspace, "wiki");
    const card = path.join(root, "entities", "places", `${from}.md`);
    const moved = path.join(root, "entities", "places", `${to}.md`);
    if (existsSync(card) && !existsSync(moved)) {
      writeAtomic(moved, change(readFileSync(card, "utf8")));
      unlinkSync(card);
      changed.push(path.relative(cwd, moved).split(path.sep).join("/"));
    }
    changed.push(...rewriteAll(markdownUnder(root), cwd, change));
  }
  return changed;
}

/**
 * Removes a place page into `trashDir` and mends the World Wiki around it.
 * Characters' own cards stay: they remember a place that's gone. `file` picks
 * one page when two say the same `place_id`; while another still does, the
 * place stays and nothing else changes. Returns the pages rewritten, relative
 * to the Gateway's working directory.
 */
export function removePlacePages(params: {
  readonly wikiDir: string;
  readonly id: string;
  readonly file?: string;
  readonly trashDir: string;
  readonly cwd: string;
}): { readonly parent?: string; readonly changed: string[] } {
  const { wikiDir, id, cwd } = params;
  const source = params.file ?? placeFile(wikiDir, id);
  if (!source || !existsSync(source))
    throw new Error(`No place page for ${id}.`);
  const text = readFileSync(source, "utf8");
  let fields: z.infer<typeof PLACE_FIELDS> = {};
  try {
    fields = readFrontmatter(text, PLACE_FIELDS).data;
  } catch {
    // A page that doesn't parse held nothing the map used.
  }
  const parent = fields.parent === id ? undefined : fields.parent;
  writeAtomic(path.join(params.trashDir, path.relative(wikiDir, source)), text);
  unlinkSync(source);
  if (placeFile(wikiDir, id)) return { changed: [] };
  const changed = rewriteAll(markdownUnder(wikiDir), cwd, (page) =>
    withoutPlace(page, {
      id,
      name: fields.name ?? id,
      ...(parent === undefined ? {} : { parent }),
    }),
  );
  return { ...(parent === undefined ? {} : { parent }), changed };
}
