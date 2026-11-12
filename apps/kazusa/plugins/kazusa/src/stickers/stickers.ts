import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  fileMtime,
  pictureVersion,
  readPictures,
  splitPictureName,
} from "../pictures.ts";

/** `stickers/stickers.json`: what the files can't say. */
const MANIFEST = z.object({
  /** Every outfit but the usual clothes, by the word that prefixes its names. */
  outfits: z.record(z.string(), z.string().trim().min(1)).optional(),
  stickers: z
    .record(
      z.string(),
      z.object({ look: z.string().trim().min(1).optional() }).loose(),
    )
    .optional(),
});

export interface Sticker {
  readonly name: string;
  readonly file: string;
  readonly contentType: string;
  /** The file's mtime in base 36: a new file is a new URL. */
  readonly version: string;
  /** What it shows, mood first. */
  readonly look: string;
  /** What is worn, when it isn't the usual clothes. */
  readonly outfit?: string;
}

export interface StickerSet {
  /** By name, sorted. */
  readonly stickers: ReadonlyMap<string, Sticker>;
  /** Outfit word → what is worn, for outfits some sticker shows. */
  readonly outfits: ReadonlyMap<string, string>;
}

const EMPTY: StickerSet = { stickers: new Map(), outfits: new Map() };

/** The manifest, or none when it is missing or broken: names alone. */
function readManifest(file: string): z.infer<typeof MANIFEST> {
  try {
    return MANIFEST.parse(JSON.parse(readFileSync(file, "utf8")));
  } catch {
    return {};
  }
}

/**
 * Outfit word → what is worn, as a workspace's `stickers/stickers.json`
 * declares them, whether or not a sticker shows them. Portraits share this
 * vocabulary.
 */
export function declaredOutfits(
  workspace: string,
): ReadonlyMap<string, string> {
  return new Map(
    Object.entries(
      readManifest(path.join(workspace, "stickers", "stickers.json")).outfits ??
        {},
    ),
  );
}

const sets = new Map<
  string,
  { readonly key: string; readonly set: StickerSet }
>();

/**
 * A workspace's stickers (`<workspace>/stickers/`), read from disk on every
 * call and parsed again whenever a picture or the manifest changes, so edits
 * apply from the next turn without a restart. Synchronous, for tool factories.
 * A broken manifest leaves the pictures usable under their bare names.
 */
export function readStickers(workspace: string): StickerSet {
  const dir = path.join(workspace, "stickers");
  const manifestFile = path.join(dir, "stickers.json");
  const pictures = readPictures(dir);
  if (!pictures) return EMPTY;
  const key = JSON.stringify([
    fileMtime(manifestFile) ?? null,
    pictures.map(({ file, modified }) => [file, modified]),
  ]);
  const cached = sets.get(dir);
  if (cached?.key === key) return cached.set;

  const manifest = readManifest(manifestFile);
  const declared = new Map(Object.entries(manifest.outfits ?? {}));
  const stickers = new Map<string, Sticker>();
  const outfits = new Map<string, string>();
  for (const { name, file, contentType, modified } of pictures) {
    const { prefix: outfitWord, rest } = splitPictureName(name, declared);
    const mood = rest.replaceAll("-", " ");
    const outfit = outfitWord ? declared.get(outfitWord) : undefined;
    if (outfitWord && outfit) outfits.set(outfitWord, outfit);
    stickers.set(name, {
      name,
      file,
      contentType,
      version: pictureVersion(modified),
      look: manifest.stickers?.[name]?.look ?? mood,
      ...(outfit ? { outfit } : {}),
    });
  }
  const set = { stickers, outfits };
  sets.set(dir, { key, set });
  return set;
}

/**
 * What everyone reads for a sticker, frozen when it is sent: "Aris, laughing
 * with eyes shut, in a maid dress".
 */
export function stickerText(senderName: string, sticker: Sticker): string {
  return [
    senderName,
    sticker.look,
    ...(sticker.outfit ? [`in ${sticker.outfit}`] : []),
  ].join(", ");
}

/** Browser URL of a sent sticker; the version keeps it cacheable forever. */
export function stickerUrl(
  agentId: string,
  sticker: { readonly name: string; readonly v: string },
): string {
  const query = new URLSearchParams({
    id: agentId,
    name: sticker.name,
    v: sticker.v,
  });
  return `/kazusa/sticker?${query}`;
}
