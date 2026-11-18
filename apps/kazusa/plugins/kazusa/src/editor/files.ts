import { createHash, randomUUID } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import type { EditedText } from "@kazusa/client";

/*
 * The files the Wiki writes beside pages, kept apart from its routes so each rule is
 * tested on its own: a text is written only over the version that was read,
 * and a picture only when its bytes are a raster picture.
 */

const hashOf = (text: string): string =>
  createHash("sha256").update(text).digest("hex");

/** A text file as it is now; a missing one is empty, with no hash. */
export function readText(file: string): EditedText {
  try {
    const text = readFileSync(file, "utf8");
    return { text, hash: hashOf(text) };
  } catch {
    return { text: "", hash: null };
  }
}

/** A save made over a version that is no longer there. */
export class EditConflict extends Error {
  constructor(readonly current: unknown) {
    super(
      "This changed since you opened it, perhaps in a night's sleep. Your words are kept here; copy what you need and reload.",
    );
  }
}

/** Writes a whole file through a temporary one, so it is never half written. */
export function writeWhole(file: string, data: string | Buffer): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${randomUUID()}.tmp`,
  );
  writeFileSync(temporary, data, { flag: "wx" });
  renameSync(temporary, file);
}

/** Writes `text` only over the version whose hash is `base`. */
export function writeTextOver(
  file: string,
  text: string,
  base: string | null,
): EditedText {
  const current = readText(file);
  if (current.hash !== base) throw new EditConflict(current);
  writeWhole(file, text.endsWith("\n") ? text : `${text}\n`);
  return readText(file);
}

/** Raster types the Wiki takes, by what their first bytes say. */
const SIGNATURES: readonly {
  readonly type: string;
  readonly ext: string;
  readonly test: (bytes: Buffer) => boolean;
}[] = [
  {
    type: "image/png",
    ext: "png",
    test: (b) =>
      b.length > 8 &&
      b.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")),
  },
  {
    type: "image/jpeg",
    ext: "jpg",
    test: (b) =>
      b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    type: "image/webp",
    ext: "webp",
    test: (b) =>
      b.length > 12 &&
      b.toString("latin1", 0, 4) === "RIFF" &&
      b.toString("latin1", 8, 12) === "WEBP",
  },
  {
    type: "image/gif",
    ext: "gif",
    test: (b) => b.length > 6 && b.toString("latin1", 0, 4) === "GIF8",
  },
  {
    type: "image/avif",
    ext: "avif",
    test: (b) =>
      b.length > 12 &&
      b.toString("latin1", 4, 8) === "ftyp" &&
      ["avif", "avis"].includes(b.toString("latin1", 8, 12)),
  },
];

/**
 * What a picture is, by its bytes, when they match the type it was sent as: an
 * SVG or anything else named a picture is refused.
 */
export function pictureType(
  bytes: Buffer,
  claimed: string | undefined,
): { readonly type: string; readonly ext: string } | undefined {
  const found = SIGNATURES.find(({ test }) => test(bytes));
  if (!found) return undefined;
  const sent = claimed?.split(";")[0]?.trim().toLowerCase();
  return sent === undefined || sent === found.type
    ? { type: found.type, ext: found.ext }
    : undefined;
}

const RASTER_EXT = new Set(["webp", "png", "jpg", "jpeg", "gif", "avif"]);

/** The pictures in `dir` named `stem`, whatever their type. */
function sameStem(dir: string, stem: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries.filter((entry) => {
    const ext = path.extname(entry);
    return (
      entry.slice(0, -ext.length) === stem &&
      RASTER_EXT.has(ext.slice(1).toLowerCase())
    );
  });
}

/**
 * Puts a picture in `dir` as `<stem>.<ext>`. A picture of that name in another
 * type is deleted once it is written, so the name means one picture. Returns
 * the file's whole name.
 */
export function putPicture(
  dir: string,
  stem: string,
  bytes: Buffer,
  ext: string,
): string {
  const entry = `${stem}.${ext}`;
  // The new one first: a failed write never leaves the name with nothing.
  writeWhole(path.join(dir, entry), bytes);
  for (const other of sameStem(dir, stem))
    if (other !== entry) rmSync(path.join(dir, other), { force: true });
  return entry;
}

/** Deletes every picture named `stem` in `dir`; how many. */
export function removePicture(dir: string, stem: string): number {
  const found = sameStem(dir, stem);
  for (const entry of found) rmSync(path.join(dir, entry), { force: true });
  return found.length;
}
