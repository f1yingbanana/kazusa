import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

/** `<outfit>-<mood>` or `<mood>`: lowercase words joined by `-`. */
export const STICKER_NAME = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(64);

/** Raster formats only, as for avatars: an SVG could run script on our origin. */
const STICKER_TYPES: Readonly<Record<string, string>> = {
  webp: "image/webp",
  png: "image/png",
  gif: "image/gif",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  avif: "image/avif",
};

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

const mtime = (file: string): number | undefined => {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return undefined;
  }
};

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
  let entries: string[];
  try {
    entries = readdirSync(dir).sort();
  } catch {
    return EMPTY;
  }
  // Each picture by its mtime: one replaced in place is a new version.
  const pictures = entries.flatMap((entry) => {
    const ext = path.extname(entry).slice(1).toLowerCase();
    const name = entry.slice(0, -(ext.length + 1));
    const contentType = STICKER_TYPES[ext];
    if (!contentType || !STICKER_NAME.safeParse(name).success) return [];
    const file = path.join(dir, entry);
    const modified = mtime(file);
    return modified === undefined
      ? []
      : [{ name, file, contentType, modified }];
  });
  const key = JSON.stringify([
    mtime(manifestFile) ?? null,
    pictures.map(({ file, modified }) => [file, modified]),
  ]);
  const cached = sets.get(dir);
  if (cached?.key === key) return cached.set;

  let manifest: z.infer<typeof MANIFEST> = {};
  try {
    manifest = MANIFEST.parse(JSON.parse(readFileSync(manifestFile, "utf8")));
  } catch {
    // No or unreadable manifest: names alone.
  }
  const declared = new Map(Object.entries(manifest.outfits ?? {}));
  const stickers = new Map<string, Sticker>();
  const outfits = new Map<string, string>();
  for (const { name, file, contentType, modified } of pictures) {
    if (stickers.has(name)) continue;
    const [first, ...rest] = name.split("-");
    const outfitWord = rest.length && declared.has(first) ? first : undefined;
    const mood = (outfitWord ? rest : [first, ...rest]).join(" ");
    const outfit = outfitWord ? declared.get(outfitWord) : undefined;
    if (outfitWord && outfit) outfits.set(outfitWord, outfit);
    stickers.set(name, {
      name,
      file,
      contentType,
      version: Math.trunc(modified).toString(36),
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
