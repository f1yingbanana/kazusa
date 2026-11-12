import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  fileMtime,
  pictureEntry,
  pictureVersion,
  readPictures,
  splitPictureName,
} from "../pictures.ts";
import { declaredOutfits } from "../stickers/stickers.ts";

/** The moods a figure rests in when nothing else is asked for, best first. */
const RESTING_MOODS = ["neutral", "calm", "content", "happy"];

/** How a picture is stood in a scene; every field has a default. */
const PLACEMENT = z.object({
  /** Where the figure is across the picture: 0 its left edge, 1 its right. */
  centre: z.number().min(0).max(1).optional().catch(undefined),
  /** Where it stands down the picture: 0 its top edge, 1 its bottom. */
  floor: z.number().gt(0).max(1).optional().catch(undefined),
  /** Where its eyes are down the picture, the same way. */
  eyes: z.number().min(0).max(1).optional().catch(undefined),
  /** Drawn this many times its size, about that point on the floor. */
  scale: z.number().positive().optional().catch(undefined),
  /** Moved `[right, down]`, in the picture's own pixels. */
  offset: z.tuple([z.number(), z.number()]).optional().catch(undefined),
});
export type PortraitPlacement = z.infer<typeof PLACEMENT>;

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
  /**
   * Placement by outfit word (`""` for pictures without one), or by one
   * picture's name, which wins. The importer writes `centre`, `floor`, `eyes`
   * and, from the character's height, `scale`; any can be corrected by hand, as
   * `offset` always is.
   */
  placement: z
    .record(z.string(), PLACEMENT.catch({}))
    .optional()
    .catch(undefined),
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
  /** From `portraits.json`, when it says anything for this picture. */
  readonly placement?: PortraitPlacement;
}

export interface PortraitSet {
  /** By name, sorted. */
  readonly portraits: ReadonlyMap<string, Portrait>;
  /**
   * What the figure rests in (`restingPortrait`); absent when no picture is in
   * the usual clothes, and such a character isn't drawn.
   */
  readonly default?: string;
  readonly size?: readonly [number, number];
  readonly eyeline?: number;
}

/**
 * The picture a figure rests in: in the usual clothes, since nobody changes
 * outfit yet (§6.4), in the first of `RESTING_MOODS` there is, else the first
 * usual picture by name. None when every picture is of an outfit.
 */
function restingPortrait<
  P extends { readonly outfit?: string; readonly mood: string },
>(pictures: readonly P[]): P | undefined {
  const usual = pictures.filter(({ outfit }) => outfit === undefined);
  for (const resting of RESTING_MOODS) {
    const found = usual.find(({ mood }) => mood === resting);
    if (found) return found;
  }
  return usual[0];
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

/** A placement's set fields, or nothing when it has none. */
function definedOf(
  placement: PortraitPlacement | undefined,
): PortraitPlacement | undefined {
  if (placement === undefined) return undefined;
  const { centre, floor, eyes, scale, offset } = placement;
  const set = {
    ...(centre === undefined ? {} : { centre }),
    ...(floor === undefined ? {} : { floor }),
    ...(eyes === undefined ? {} : { eyes }),
    ...(scale === undefined ? {} : { scale }),
    ...(offset === undefined ? {} : { offset }),
  };
  return Object.keys(set).length > 0 ? set : undefined;
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
  const { size, eyeline, placement } = readManifest(
    path.join(dir, "portraits.json"),
  );
  const portraits = new Map<string, Portrait>();
  for (const { name, file, contentType, modified } of pictures) {
    const { prefix, rest } = splitPictureName(name, outfits);
    const placed = definedOf(placement?.[name] ?? placement?.[prefix ?? ""]);
    portraits.set(name, {
      name,
      file,
      contentType,
      version: pictureVersion(modified),
      ...(prefix === undefined ? {} : { outfit: prefix }),
      mood: rest,
      ...(placed === undefined ? {} : { placement: placed }),
    });
  }
  const resting = restingPortrait([...portraits.values()]);
  return {
    portraits,
    ...(resting === undefined ? {} : { default: resting.name }),
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

/**
 * The default's file per portraits folder, while the folder and the outfits it
 * was chosen by are unchanged.
 */
const defaults = new Map<
  string,
  {
    readonly key: string;
    readonly entry?: string;
    readonly name?: string;
  }
>();

/**
 * The default portrait's URL, for the roster, and absent for a character who
 * isn't drawn: one `stat` of the folder for a character without portraits, and
 * one more of the picture for one with them. The folder is listed again only
 * when it changes (a picture added, removed or renamed); one replaced in place
 * changes only its own mtime, which the second `stat` reads. A third, of
 * `stickers/stickers.json`, notices outfits declared or dropped: they decide
 * which pictures count as the usual clothes.
 */
export function defaultPortraitUrl(
  agentId: string,
  workspace: string,
): string | undefined {
  const dir = portraitsDir(workspace);
  let key: string;
  try {
    const info = statSync(dir);
    if (!info.isDirectory()) return undefined;
    const outfitsMtime = fileMtime(
      path.join(workspace, "stickers", "stickers.json"),
    );
    key = `${info.mtimeMs}:${outfitsMtime ?? "none"}`;
  } catch {
    return undefined;
  }
  let cached = defaults.get(dir);
  if (cached?.key !== key) {
    let entries: string[];
    try {
      entries = readdirSync(dir).sort();
    } catch {
      return undefined;
    }
    const outfits = declaredOutfits(workspace);
    const pictures = entries.flatMap((entry) => {
      const picture = pictureEntry(entry);
      if (!picture) return [];
      const { prefix, rest } = splitPictureName(picture.name, outfits);
      return [
        {
          entry,
          name: picture.name,
          mood: rest,
          ...(prefix === undefined ? {} : { outfit: prefix }),
        },
      ];
    });
    const resting = restingPortrait(pictures);
    cached = {
      key,
      ...(resting ? { entry: resting.entry, name: resting.name } : {}),
    };
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
