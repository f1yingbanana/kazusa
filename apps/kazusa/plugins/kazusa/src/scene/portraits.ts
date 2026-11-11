import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  defaultPicture,
  pictureVersion,
  readPictures,
  splitPictureName,
} from "../pictures.ts";
import { declaredOutfits } from "../stickers/stickers.ts";

/** The look shown when nothing else is asked for, if the set has it. */
const DEFAULT_LOOK = "neutral";

/**
 * `portraits/portraits.json`: what the pictures share. Each field is only a
 * layout hint, so a bad one is dropped, never the set.
 */
const MANIFEST = z.object({
  /** Width and height the pictures are drawn at, in pixels. */
  size: z
    .tuple([z.number().positive(), z.number().positive()])
    .optional()
    .catch(undefined),
  /** The eyes' height as a fraction of the picture's, from the top. */
  eyeline: z.number().min(0).max(1).optional().catch(undefined),
});

export interface Portrait {
  /** `[<outfit>-]<mood>`, the same name as the sticker of the same look. */
  readonly name: string;
  readonly file: string;
  readonly contentType: string;
  /** The file's mtime in base 36: a new file is a new URL. */
  readonly version: string;
  /** The outfit's word, when `stickers.json` declares the name's first word. */
  readonly outfit?: string;
  /** The rest of the name, dashes kept. */
  readonly mood: string;
}

export interface PortraitSet {
  /** By name, sorted. */
  readonly portraits: ReadonlyMap<string, Portrait>;
  /** `neutral`, else the first by name; absent for an empty set. */
  readonly default?: string;
  readonly size?: readonly [number, number];
  readonly eyeline?: number;
}

const portraitsDir = (workspace: string): string =>
  path.join(workspace, "portraits");

function readManifest(file: string): z.infer<typeof MANIFEST> {
  try {
    return MANIFEST.parse(JSON.parse(readFileSync(file, "utf8")));
  } catch {
    // Missing or not an object: the pictures alone.
    return {};
  }
}

/**
 * A workspace's portraits (`<workspace>/portraits/`), whole figures named as
 * its stickers are, read from disk on every call: per scene member, never per
 * roster row. Outfits are the ones `stickers/stickers.json` declares. A broken
 * or missing manifest leaves the pictures usable.
 */
export function readPortraits(workspace: string): PortraitSet {
  const dir = portraitsDir(workspace);
  const pictures = readPictures(dir) ?? [];
  if (pictures.length === 0) return { portraits: new Map() };
  const outfits = declaredOutfits(workspace);
  const portraits = new Map<string, Portrait>();
  for (const { name, file, contentType, modified } of pictures) {
    const { prefix, rest } = splitPictureName(name, outfits);
    portraits.set(name, {
      name,
      file,
      contentType,
      version: pictureVersion(modified),
      ...(prefix === undefined ? {} : { outfit: prefix }),
      mood: rest,
    });
  }
  const { size, eyeline } = readManifest(path.join(dir, "portraits.json"));
  return {
    portraits,
    default: portraits.has(DEFAULT_LOOK) ? DEFAULT_LOOK : pictures[0].name,
    ...(size === undefined ? {} : { size }),
    ...(eyeline === undefined ? {} : { eyeline }),
  };
}

/** Browser URL of a portrait; the version keeps it cacheable forever. */
export function portraitUrl(
  agentId: string,
  portrait: { readonly name: string; readonly version: string },
): string {
  const query = new URLSearchParams({
    id: agentId,
    name: portrait.name,
    v: portrait.version,
  });
  return `/kazusa/portrait?${query}`;
}

/** The default's file per portraits folder, while the folder is unchanged. */
const defaults = new Map<
  string,
  {
    readonly folderMtime: number;
    readonly entry?: string;
    readonly name?: string;
  }
>();

/**
 * The default portrait's URL, for the roster: one `stat` of the folder for a
 * character without portraits, and one more of the picture for one with them.
 * The folder is listed again only when it changes (a picture added, removed or
 * renamed); one replaced in place changes only its own mtime, which the second
 * `stat` reads.
 */
export function defaultPortraitUrl(
  agentId: string,
  workspace: string,
): string | undefined {
  const dir = portraitsDir(workspace);
  let folderMtime: number;
  try {
    const info = statSync(dir);
    if (!info.isDirectory()) return undefined;
    folderMtime = info.mtimeMs;
  } catch {
    return undefined;
  }
  let cached = defaults.get(dir);
  if (cached?.folderMtime !== folderMtime) {
    let entries: string[];
    try {
      entries = readdirSync(dir).sort();
    } catch {
      return undefined;
    }
    const chosen = defaultPicture(entries, DEFAULT_LOOK);
    cached = { folderMtime, ...chosen };
    defaults.set(dir, cached);
  }
  if (cached.entry === undefined || cached.name === undefined) return undefined;
  try {
    const modified = statSync(path.join(dir, cached.entry)).mtimeMs;
    return portraitUrl(agentId, {
      name: cached.name,
      version: pictureVersion(modified),
    });
  } catch {
    // Gone since the listing, within the folder's mtime resolution.
    defaults.delete(dir);
    return undefined;
  }
}
