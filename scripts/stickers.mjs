#!/usr/bin/env node
/**
 * Builds a character's sticker set (`workspaces/<id>/stickers/`, see the kazusa
 * skill's `references/messaging.md`) from a MediaWiki gallery, in two steps
 * with labelling by eye in between:
 *
 * - `node scripts/stickers.mjs stage <plan.json> <dir>` downloads each set's
 *   files and writes `<dir>/<set>/<n>.webp`, a numbered contact sheet
 *   (`sheet.png`) and `<dir>/stage.json`. A plan is `{ wiki, crop: "face" |
 *   "whole", sets: [{ id, files: ["A.png"], box? }] }`. `face` is for
 *   expression portraits, where only the face changes: the crop is one square
 *   around where the set's pictures differ (`preview.png` shows it), or `box:
 *   [left, top, size]` in the source's pixels. `whole` trims and fits a picture
 *   that is a sticker already.
 * - `node scripts/stickers.mjs place <labels.json>` replaces a workspace's
 *   stickers with the chosen ones: `{ workspace, outfits?: { word: text },
 *   stickers: [{ from, name, look? }] }`.
 *
 * Uses the MediaWiki API, because Fandom refuses plain page fetches.
 */
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const SIZE = 256;
export const AGENT = "kazusa-stickers/1.0 (character sticker import)";
/** Source width for face crops: plenty for a 256 px face, a third the bytes. */
export const FACE_SOURCE_WIDTH = 1200;
export const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

async function fetchRetry(url, init = {}, tries = 4) {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url, {
        ...init,
        headers: { "User-Agent": AGENT, ...init.headers },
      });
      if (response.ok) return response;
      if (
        attempt >= tries ||
        (response.status < 500 && response.status !== 429)
      )
        throw new Error(`${response.status} for ${url}`);
    } catch (error) {
      if (attempt >= tries) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
  }
}

/**
 * File title → original size and a download URL, at most `width` wide.
 * `get(url)` fetches; it defaults to this script's own retrying fetch.
 */
export async function imageInfo(wiki, files, width, get = fetchRetry) {
  const info = new Map();
  for (let at = 0; at < files.length; at += 40) {
    const titles = files.slice(at, at + 40).map((file) => `File:${file}`);
    const query = new URLSearchParams({
      action: "query",
      titles: titles.join("|"),
      prop: "imageinfo",
      iiprop: "url|size",
      ...(width ? { iiurlwidth: String(width) } : {}),
      format: "json",
      formatversion: "2",
    });
    const data = await (
      await get(`${wiki.replace(/\/$/, "")}/api.php?${query}`)
    ).json();
    const normalized = new Map(
      (data.query?.normalized ?? []).map(({ from, to }) => [to, from]),
    );
    for (const page of data.query?.pages ?? []) {
      const title = normalized.get(page.title) ?? page.title;
      const image = page.imageinfo?.[0];
      if (!image) continue;
      const scaled = image.thumburl && image.thumbwidth < image.width;
      info.set(title.replace(/^File:/, ""), {
        width: image.width,
        height: image.height,
        url: scaled ? image.thumburl : image.url,
      });
    }
  }
  return info;
}

/** Fandom serves WebP by default; `format=original` asks for the PNG. */
export const originalFormat = (url) =>
  `${url}${url.includes("?") ? "&" : "?"}format=original`;

async function download(url) {
  return Buffer.from(
    await (await fetchRetry(originalFormat(url))).arrayBuffer(),
  );
}

/**
 * Where a set's pictures differ: the rows `ys` and columns `xs` spanned by the
 * eyes, mouth and blush of expression portraits, in the first picture's pixels,
 * or undefined when nothing differs.
 */
export async function faceFeatures(buffers) {
  const first = await sharp(buffers[0])
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = first.info;
  const rows = new Uint32Array(height);
  const cols = new Uint32Array(width);
  for (const buffer of buffers.slice(1)) {
    const other = await sharp(buffer)
      .resize(width, height, { fit: "fill" })
      .ensureAlpha()
      .raw()
      .toBuffer();
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const at = (y * width + x) * 4;
        let diff = Math.abs(first.data[at + 3] - other[at + 3]);
        for (let c = 0; c < 3; c++)
          diff = Math.max(
            diff,
            (Math.abs(first.data[at + c] - other[at + c]) *
              Math.min(first.data[at + 3], other[at + 3])) /
              255,
          );
        if (diff > 48) {
          rows[y]++;
          cols[x]++;
        }
      }
  }
  // Ignore stray pixels: a feature spans a few changed pixels per line.
  const span = (counts) => {
    const total = counts.reduce((sum, count) => sum + count, 0);
    if (total === 0) return undefined;
    let low = 0;
    let seen = 0;
    while (seen + counts[low] < total * 0.01) seen += counts[low++];
    let high = counts.length - 1;
    seen = 0;
    while (seen + counts[high] < total * 0.01) seen += counts[high--];
    return [low, high];
  };
  const ys = span(rows);
  const xs = span(cols);
  if (!ys || !xs) return undefined;
  return { xs, ys, width, height };
}

/**
 * The square around a set's features (`faceFeatures`), widened to the whole
 * head and kept on the canvas.
 */
export function boxAround({ xs, ys, width, height }) {
  const featureWidth = xs[1] - xs[0];
  const featureHeight = ys[1] - ys[0];
  // Eyes to mouth is about half a head's width; the head sits a little above.
  const side = Math.round(
    Math.min(Math.max(featureWidth * 2.4, featureHeight * 2.8), width, height),
  );
  const centerX = (xs[0] + xs[1]) / 2;
  const centerY = ys[0] + featureHeight * 0.25;
  const clamp = (value, max) => Math.round(Math.min(Math.max(value, 0), max));
  return [
    clamp(centerX - side / 2, width - side),
    clamp(centerY - side / 2, height - side),
    side,
  ];
}

/** The square around where a set's pictures differ. */
export async function faceBox(buffers) {
  const features = await faceFeatures(buffers);
  return features && boxAround(features);
}

export const toSticker = (image) =>
  image
    .resize(SIZE, SIZE, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .webp({ quality: 82, alphaQuality: 90, effort: 6 })
    .toBuffer();

/**
 * How `stage` crops a set of downloaded pictures. For `face`, `box` (in the
 * source's own pixels, `sourceWidth` wide) is scaled to the downloads, or found
 * with `faceBox` when the set has two or more pictures; `features` is what
 * `faceFeatures` found, if it ran. `scale` is download / source width.
 */
export async function cropOfSet(buffers, { face, box, sourceWidth }) {
  if (!face) return { box, scale: 1 };
  // A box is in the source's own pixels; the download may be smaller.
  const { width } = await sharp(buffers[0]).metadata();
  const scale = width / sourceWidth;
  if (box) return { box: box.map((value) => Math.round(value * scale)), scale };
  const features = buffers.length > 1 ? await faceFeatures(buffers) : undefined;
  return { box: features && boxAround(features), scale, features };
}

/**
 * One downloaded picture as `stage` stickers it: the square `box` (download
 * pixels) cut out, or with no box the whole picture trimmed.
 */
export async function stickerOf(buffer, box) {
  let image = sharp(buffer).ensureAlpha();
  if (box) {
    const meta = await sharp(buffer).metadata();
    const side = Math.min(box[2], meta.width - box[0], meta.height - box[1]);
    image = image.extract({
      left: box[0],
      top: box[1],
      width: side,
      height: side,
    });
  } else image = sharp(await image.trim().toBuffer());
  return toSticker(image);
}

/**
 * Cells on a checkerboard, so transparency and crop edges show, captioned with
 * their number or `captions`.
 */
export async function contactSheet(
  files,
  out,
  captions,
  columns = Math.min(5, files.length),
) {
  const cell = 176;
  const rows = Math.ceil(files.length / columns);
  const checker = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${columns * cell}" height="${rows * cell}">
      <defs><pattern id="c" width="16" height="16" patternUnits="userSpaceOnUse">
        <rect width="16" height="16" fill="#ddd"/><rect width="8" height="8" fill="#bbb"/>
        <rect x="8" y="8" width="8" height="8" fill="#bbb"/></pattern></defs>
      <rect width="100%" height="100%" fill="url(#c)"/></svg>`,
  );
  const layers = [];
  for (const [index, file] of files.entries()) {
    const left = (index % columns) * cell;
    const top = Math.floor(index / columns) * cell;
    const caption = captions?.[index] ?? String(index + 1);
    const width = Math.min(cell, 12 + caption.length * 9);
    layers.push({
      input: await sharp(file).resize(160, 160).toBuffer(),
      left: left + 8,
      top: top + 8,
    });
    layers.push({
      input: Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="22">
          <rect width="${width}" height="22" rx="4" fill="#000a"/>
          <text x="${width / 2}" y="16" font-family="sans-serif" font-size="14"
            fill="#fff" text-anchor="middle">${caption}</text></svg>`,
      ),
      left,
      top,
    });
  }
  await sharp(checker).composite(layers).png().toFile(out);
}

export async function stage(planFile, dir) {
  const plan = JSON.parse(readFileSync(planFile, "utf8"));
  const face = plan.crop !== "whole";
  const staged = { wiki: plan.wiki, crop: face ? "face" : "whole", sets: [] };
  for (const set of plan.sets) {
    if (!NAME.test(set.id)) throw new Error(`Set id isn't a name: ${set.id}`);
    const out = path.join(dir, set.id);
    rmSync(out, { recursive: true, force: true });
    mkdirSync(out, { recursive: true });
    const info = await imageInfo(
      plan.wiki,
      set.files,
      face ? FACE_SOURCE_WIDTH : undefined,
    );
    const files = set.files.filter((file) => {
      if (!info.has(file)) console.warn(`${set.id}: no such file, ${file}`);
      return info.has(file);
    });
    if (files.length === 0) continue;
    const buffers = [];
    for (const file of files) buffers.push(await download(info.get(file).url));
    const { box, scale } = await cropOfSet(buffers, {
      face,
      box: set.box,
      sourceWidth: info.get(files[0]).width,
    });
    if (face && !box)
      console.warn(`${set.id}: no differences to find a face; give a box`);
    const written = [];
    for (const [index, buffer] of buffers.entries()) {
      const file = path.join(out, `${index + 1}.webp`);
      writeFileSync(file, await stickerOf(buffer, face && box));
      written.push(file);
    }
    await contactSheet(written, path.join(out, "sheet.png"));
    if (face) {
      // The whole first picture with the crop drawn on, for describing the
      // outfit and checking the crop.
      const { width } = await sharp(buffers[0]).metadata();
      const base = await sharp(buffers[0])
        .flatten({ background: "#ccc" })
        .resize({ height: 640, withoutEnlargement: true })
        .toBuffer({ resolveWithObject: true });
      const k = base.info.width / width;
      const frame = box
        ? `<rect x="${box[0] * k}" y="${box[1] * k}" width="${box[2] * k}"
            height="${box[2] * k}" fill="none" stroke="#f00" stroke-width="3"/>`
        : "";
      await sharp(base.data)
        .composite([
          {
            input: Buffer.from(
              `<svg xmlns="http://www.w3.org/2000/svg" width="${base.info.width}" height="${base.info.height}">${frame}</svg>`,
            ),
          },
        ])
        .png()
        .toFile(path.join(out, "preview.png"));
    }
    staged.sets.push({
      id: set.id,
      ...(box ? { box: box.map((value) => Math.round(value / scale)) } : {}),
      stickers: files.map((file, index) => ({
        n: index + 1,
        source: file,
        file: written[index],
      })),
    });
    console.log(`${set.id}: ${written.length} staged`);
  }
  writeFileSync(
    path.join(dir, "stage.json"),
    `${JSON.stringify(staged, null, 2)}\n`,
  );
}

export function place(labelsFile) {
  const labels = JSON.parse(readFileSync(labelsFile, "utf8"));
  const outfits = labels.outfits ?? {};
  for (const word of Object.keys(outfits))
    if (!/^[a-z0-9]+$/.test(word))
      throw new Error(`An outfit is one lowercase word: ${word}`);
  const names = new Set();
  for (const { name } of labels.stickers) {
    if (!NAME.test(name)) throw new Error(`Not a sticker name: ${name}`);
    if (names.has(name)) throw new Error(`Two stickers named ${name}`);
    names.add(name);
  }
  const dir = path.join(labels.workspace, "stickers");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const manifest = { stickers: {} };
  if (Object.keys(outfits).length) manifest.outfits = outfits;
  const sorted = [...labels.stickers].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  for (const { from, name, look } of sorted) {
    copyFileSync(from, path.join(dir, `${name}${path.extname(from)}`));
    manifest.stickers[name] = look ? { look } : {};
  }
  writeFileSync(
    path.join(dir, "stickers.json"),
    `${JSON.stringify(
      manifest.outfits
        ? { outfits: manifest.outfits, stickers: manifest.stickers }
        : manifest,
      null,
      2,
    )}\n`,
  );
  console.log(`${dir}: ${sorted.length} stickers`);
}

/** A placed set's pictures captioned with their names, for checking labels. */
export async function sheet(stickersDir, out) {
  const files = readdirSync(stickersDir)
    .filter((file) => /\.(webp|png|gif|jpe?g|avif)$/.test(file))
    .sort();
  await contactSheet(
    files.map((file) => path.join(stickersDir, file)),
    out,
    files.map((file) => file.replace(/\.[^.]+$/, "")),
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, ...rest] = process.argv.slice(2);
  if (command === "stage" && rest.length === 2) await stage(rest[0], rest[1]);
  else if (command === "place" && rest.length === 1) place(rest[0]);
  else if (command === "sheet" && rest.length === 2)
    await sheet(rest[0], rest[1]);
  else {
    console.error(
      "Usage: stickers.mjs stage <plan.json> <dir> | place <labels.json> | sheet <stickers dir> <out.png>",
    );
    process.exit(1);
  }
}
