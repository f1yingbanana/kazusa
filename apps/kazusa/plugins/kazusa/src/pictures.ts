import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

/**
 * A picture's name, and a backdrop set's: lowercase words joined by `-`. A look
 * is `[<outfit>-]<mood>`, a backdrop `[<state>-]<time>`.
 */
export const PICTURE_NAME = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(64);

/** Raster formats only, as for avatars: an SVG could run script on our origin. */
const RASTER_TYPES: Readonly<Record<string, string>> = {
  webp: "image/webp",
  png: "image/png",
  gif: "image/gif",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  avif: "image/avif",
};

export interface Picture {
  readonly name: string;
  readonly file: string;
  readonly contentType: string;
  readonly modified: number;
}

export const fileMtime = (file: string): number | undefined => {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return undefined;
  }
};

/** The file's mtime in base 36: a new file is a new URL. */
export const pictureVersion = (modified: number): string =>
  Math.trunc(modified).toString(36);

/** The picture name an entry would serve under, if it is a raster picture. */
function pictureEntry(
  entry: string,
): { readonly name: string; readonly contentType: string } | undefined {
  const ext = path.extname(entry).slice(1).toLowerCase();
  const name = entry.slice(0, -(ext.length + 1));
  const contentType = RASTER_TYPES[ext];
  return contentType && PICTURE_NAME.safeParse(name).success
    ? { name, contentType }
    : undefined;
}

/** A folder's entries, sorted, or `undefined` when it can't be listed. */
function listEntries(dir: string): string[] | undefined {
  try {
    return readdirSync(dir).sort();
  } catch {
    return undefined;
  }
}

/**
 * A folder's raster pictures by name, sorted, each with its mtime (one replaced
 * in place is a new version). When two files share a name, the first by file
 * name wins. `undefined` when the folder can't be listed.
 */
export function readPictures(dir: string): Picture[] | undefined {
  const entries = listEntries(dir);
  if (!entries) return undefined;
  const seen = new Set<string>();
  return entries.flatMap((entry) => {
    const picture = pictureEntry(entry);
    if (!picture || seen.has(picture.name)) return [];
    const file = path.join(dir, entry);
    const modified = fileMtime(file);
    if (modified === undefined) return [];
    seen.add(picture.name);
    return [{ ...picture, file, modified }];
  });
}

/**
 * In a sorted listing, the picture named `preferred`, else the first picture:
 * what to show when nothing else is asked for. Chosen from names alone, so it
 * costs no `stat` per file; the same choice `readPictures` would lead to.
 */
export function defaultPicture(
  entries: readonly string[],
  preferred: string,
): { readonly entry: string; readonly name: string } | undefined {
  let first: { readonly entry: string; readonly name: string } | undefined;
  for (const entry of entries) {
    const picture = pictureEntry(entry);
    if (!picture) continue;
    if (picture.name === preferred) return { entry, name: picture.name };
    first ??= { entry, name: picture.name };
  }
  return first;
}

/**
 * Splits `<prefix>-<rest>` when the first word is a declared prefix (an outfit,
 * a place's state) and something follows it; otherwise the whole name is the
 * rest. `rest` keeps its dashes.
 */
export function splitPictureName(
  name: string,
  declared: { has(word: string): boolean },
): { readonly prefix?: string; readonly rest: string } {
  const [first, ...rest] = name.split("-");
  return rest.length > 0 && declared.has(first)
    ? { prefix: first, rest: rest.join("-") }
    : { rest: name };
}
