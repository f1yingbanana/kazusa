#!/usr/bin/env node
/**
 * Builds a character's whole-figure portraits (`workspaces/<id>/portraits/`,
 * same names as the stickers) from the MediaWiki expression portraits their
 * stickers were cut from, in two steps:
 *
 * - `stage <plan.json> <workspace> <dir>` fetches each set's originals, trims the
 *   set by the union of its opaque areas so every look stays aligned, caps the
 *   height and writes `<dir>/<set>/<n>.webp`. It names each picture by cutting
 *   the sticker `stickers.mjs stage` would have cut from it and matching that
 *   against `<workspace>/stickers/`. `<dir>/stage.json` reports every match;
 *   `matched.png` and `unmatched.png` per set show them. The plan is the
 *   sticker plan: `{ id?, wiki, crop?, sets: [{ id, files, box? }] }`.
 * - `place <dir>/stage.json` writes each picture that has a `name` (a match, or
 *   one filled in by hand) to `<workspace>/portraits/<name>.webp`, and
 *   `portraits.json` with the size and eyeline. It writes nothing else.
 *
 * Originals are kept in `.cache/art/<wiki host>/<File>` (git-ignored, or
 * `--cache`). A re-run reads them and fetches only what is missing.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import {
  FACE_SOURCE_WIDTH,
  NAME,
  contactSheet,
  cropOfSet,
  faceFeatures,
  imageInfo,
  originalFormat,
  stickerOf,
} from "./stickers.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULTS = {
  cache: path.join(ROOT, ".cache", "art"),
  maxHeight: 1600,
  /** Between downloads, not between cache reads. */
  delay: 500,
  /** Longest a request may take, body included, in ms. */
  timeout: 120_000,
  /** Sent with every request; generic, so it names no project or person. */
  userAgent: "art-importer/1.0",
  /**
   * Largest accepted distance to the nearest sticker (see `faceDistance`): the
   * mean over the face, 0–255.
   */
  maxDistance: 4.5,
  /** …and the largest for the worst 8×8 cell of the face. */
  maxWorst: 24,
  /**
   * How much nearer the best sticker must be than every other one, where the
   * two differ (see `advantage`): 1 is "exactly it", 0 "halfway between".
   */
  minAdvantage: 0.3,
  /** The largest common difference taken off a set (see `commonOffset`). */
  maxOffset: 8,
};
/** Matching works on 128 px stickers, lightly blurred against resampling. */
const FINE = 128;
const FINE_BLUR = 0.8;
/** A pixel is face where the stickers, or the pictures, spread this much. */
const SPREAD = 32;
/** Two stickers differ where a channel differs by more than this… */
const EDGE = 12;
/** …and are twins, told apart by no one, when fewer channels do. */
const MIN_CHANNELS = 40;
/** Lossy colour that keeps flat shading and line art; lossless alpha. */
export const PORTRAIT_WEBP = {
  quality: 88,
  alphaQuality: 100,
  smartSubsample: true,
  preset: "drawing",
  effort: 4,
};
/** Opacity at or below this is margin, not figure. */
const ALPHA_MIN = 8;
/**
 * The eyes, as a fraction of the way down the rows where a set's pictures
 * differ: from the brows to the mouth, the eyes sit in the upper third.
 */
const EYE_AT = 0.3;
const SIGNATURE = 64;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Seconds a Retry-After header asks for (seconds or a date), else 5. */
export function retryAfter(header, now = Date.now()) {
  if (header === null || header === undefined || header.trim() === "") return 5;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(seconds, 0);
  const at = Date.parse(header);
  return Number.isNaN(at) ? 5 : Math.max((at - now) / 1000, 0);
}

/**
 * One request, given up after `timeout` ms; a 429 or 503 is tried once more
 * after the server's Retry-After (at most 30 s). Anything else that fails stops
 * the run with what failed.
 */
export async function politeGet(
  url,
  fetchImpl = fetch,
  userAgent = DEFAULTS.userAgent,
  timeout = DEFAULTS.timeout,
) {
  for (let attempt = 1; ; attempt++) {
    let response;
    try {
      // The timeout covers reading the body too: a stalled download fails.
      response = await fetchImpl(url, {
        headers: { "User-Agent": userAgent },
        signal: AbortSignal.timeout(timeout),
      });
    } catch (error) {
      throw new Error(`Couldn't fetch ${url}: ${error.message}`, {
        cause: error,
      });
    }
    if (response.ok) return response;
    if (attempt === 1 && (response.status === 429 || response.status === 503)) {
      const wait = retryAfter(response.headers.get("retry-after"));
      await sleep(Math.min(wait, 30) * 1000);
      continue;
    }
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
}

const safe = (name) => name.replace(/[/\\:*?"<>|]/g, "_");

/**
 * `.cache/art/<this>`: the wiki's host. A wiki's file names are unique, so one
 * folder per wiki means a file shared by two sets or plans, or a renamed set,
 * is never fetched twice.
 */
export const cacheKey = (plan) => safe(new URL(plan.wiki).host);

/**
 * A set's originals, from the cache or else the wiki, in the plan's order.
 * Files the wiki doesn't have are skipped with a warning.
 */
async function originals(plan, set, dir, { delay, get, run }) {
  mkdirSync(dir, { recursive: true });
  const cached = (file) => path.join(dir, safe(file));
  const missing = set.files.filter((file) => !existsSync(cached(file)));
  if (missing.length) {
    const info = await imageInfo(plan.wiki, missing, undefined, get);
    for (const file of missing) {
      if (!info.has(file)) {
        console.warn(`${set.id}: no such file, ${file}`);
        continue;
      }
      if (run.downloads++) await sleep(delay);
      const url = originalFormat(info.get(file).url);
      let body;
      try {
        body = Buffer.from(await (await get(url)).arrayBuffer());
      } catch (error) {
        throw new Error(
          `${set.id}: ${file}: ${error.message}. Files already fetched stay in ${dir}; run again to resume.`,
          { cause: error },
        );
      }
      writeFileSync(`${cached(file)}.part`, body);
      renameSync(`${cached(file)}.part`, cached(file));
    }
  }
  return set.files
    .filter((file) => existsSync(cached(file)))
    .map((file) => ({ file, buffer: readFileSync(cached(file)) }));
}

/** Left, top, width and height around every picture's opaque pixels. */
export async function unionBox(buffers) {
  let left = Infinity;
  let top = Infinity;
  let right = -1;
  let bottom = -1;
  for (const buffer of buffers) {
    const { data, info } = await sharp(buffer)
      .ensureAlpha()
      .extractChannel(3)
      .raw()
      .toBuffer({ resolveWithObject: true });
    for (let y = 0; y < info.height; y++)
      for (let x = 0; x < info.width; x++)
        if (data[y * info.width + x] > ALPHA_MIN) {
          if (x < left) left = x;
          if (x > right) right = x;
          if (y < top) top = y;
          if (y > bottom) bottom = y;
        }
  }
  if (right < 0) return undefined;
  return { left, top, width: right - left + 1, height: bottom - top + 1 };
}

/**
 * The set's pictures cut to `box` and scaled to at most `maxHeight`, as WebP.
 * Every picture gets the same box and scale, so they stay pixel-aligned.
 */
export async function normalize(buffer, box, maxHeight) {
  let image = sharp(buffer).ensureAlpha().extract(box);
  if (box.height > maxHeight)
    image = image.resize(
      Math.max(1, Math.round((box.width * maxHeight) / box.height)),
      maxHeight,
      { fit: "fill" },
    );
  return image.webp(PORTRAIT_WEBP).toBuffer();
}

/** The picture `stickers.mjs stage` worked from: the wiki's 1200 px thumbnail. */
async function faceSource(buffer) {
  const { width, height } = await sharp(buffer).metadata();
  if (width <= FACE_SOURCE_WIDTH) return buffer;
  return sharp(buffer)
    .resize(
      FACE_SOURCE_WIDTH,
      Math.round((height * FACE_SOURCE_WIDTH) / width),
      { fit: "fill" },
    )
    .png({ compressionLevel: 1 })
    .toBuffer();
}

/**
 * A sticker (a file, buffer or `sharp` pipeline) shrunk to 64 px, colour
 * premultiplied by alpha.
 */
export async function signature(input) {
  const image = typeof input?.raw === "function" ? input : sharp(input);
  const data = await image
    .ensureAlpha()
    .resize(SIGNATURE, SIGNATURE, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .raw()
    .toBuffer();
  const out = new Float32Array(data.length);
  for (let at = 0; at < data.length; at += 4) {
    const alpha = data[at + 3];
    for (let c = 0; c < 3; c++) out[at + c] = (data[at + c] * alpha) / 255;
    out[at + 3] = alpha;
  }
  return out;
}

/**
 * A sticker at 128 px for matching: colour premultiplied by alpha, then blurred
 * a little, so a sticker cut by another resizer from another copy of the same
 * picture comes out the same.
 */
export async function fineSignature(input, side = FINE, blur = FINE_BLUR) {
  const image = typeof input?.raw === "function" ? input : sharp(input);
  const data = await image
    .ensureAlpha()
    .resize(side, side, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .raw()
    .toBuffer();
  for (let at = 0; at < data.length; at += 4)
    for (let c = 0; c < 3; c++)
      data[at + c] = Math.round((data[at + c] * data[at + 3]) / 255);
  if (!blur) return Float32Array.from(data);
  return Float32Array.from(
    await sharp(data, { raw: { width: side, height: side, channels: 4 } })
      .blur(blur)
      .raw()
      .toBuffer(),
  );
}

/** A sticker at its full 256 px, unblurred: the second look (`matchPictures`). */
export const fullSignature = (input) => fineSignature(input, 256, 0);

/**
 * The face: pixels where `stickers` (one outfit's) or `pictures` (one set's
 * would-be stickers) spread apart. Everything else is the same in every one of
 * them, so it can only add the two sources' common differences (a box a pixel
 * off, another resizer), never tell two looks apart. All pixels when nothing
 * spreads.
 */
export function faceMask(stickers, pictures) {
  const pixels = FINE * FINE;
  const mask = [];
  const spreads = (group, at) => {
    if (group.length < 2) return false;
    for (let c = 0; c < 4; c++) {
      let low = Infinity;
      let high = -Infinity;
      for (const one of group) {
        low = Math.min(low, one[at * 4 + c]);
        high = Math.max(high, one[at * 4 + c]);
      }
      if (high - low > SPREAD) return true;
    }
    return false;
  };
  for (let at = 0; at < pixels; at++)
    if (spreads(stickers, at) || spreads(pictures, at)) mask.push(at);
  return mask.length >= 64
    ? mask
    : Array.from({ length: pixels }, (_, at) => at);
}

/**
 * Two fine signatures compared over `mask`: the mean absolute difference, and
 * the worst 8×8 cell's (cells with at least 16 face pixels), both 0–255. The
 * mean is steady; the worst cell catches one feature changed, like a sweat
 * drop, that the mean would dilute.
 */
export function faceDistance(a, b, mask) {
  const cell = 8;
  const cells = new Map();
  let sum = 0;
  for (const at of mask) {
    let diff = 0;
    for (let c = 0; c < 4; c++) diff += Math.abs(a[at * 4 + c] - b[at * 4 + c]);
    sum += diff;
    const key =
      Math.floor(Math.floor(at / FINE) / cell) * (FINE / cell) +
      Math.floor((at % FINE) / cell);
    const [cellSum, count] = cells.get(key) ?? [0, 0];
    cells.set(key, [cellSum + diff, count + 1]);
  }
  let worst = 0;
  for (const [cellSum, count] of cells.values())
    if (count >= 16) worst = Math.max(worst, cellSum / (count * 4));
  return { mean: sum / (mask.length * 4), worst };
}

/**
 * How much nearer `picture` is to sticker `a` than to sticker `b`, judged only
 * where `a` and `b` differ: 1 when it is `a` there, -1 when it is `b`, 0
 * halfway. Undefined when `a` and `b` are twins (see `MIN_CHANNELS`).
 */
export function advantage(picture, a, b, minChannels = MIN_CHANNELS) {
  let gained = 0;
  let total = 0;
  let channels = 0;
  for (let at = 0; at < a.length; at++) {
    const apart = Math.abs(a[at] - b[at]);
    if (apart <= EDGE) continue;
    channels++;
    gained += Math.abs(picture[at] - b[at]) - Math.abs(picture[at] - a[at]);
    total += apart;
  }
  return channels < minChannels ? undefined : gained / total;
}

/** The mean absolute difference of two signatures, 0–255. */
export function meanDistance(a, b) {
  let sum = 0;
  for (let at = 0; at < a.length; at++) sum += Math.abs(a[at] - b[at]);
  return sum / a.length;
}

const COARSE = 32;

/** A 64 px signature averaged down to 32 px. */
function coarseOf(signature) {
  const out = new Float32Array(COARSE * COARSE * 4);
  for (let y = 0; y < COARSE; y++)
    for (let x = 0; x < COARSE; x++)
      for (let c = 0; c < 4; c++) {
        let sum = 0;
        for (const [dy, dx] of [
          [0, 0],
          [0, 1],
          [1, 0],
          [1, 1],
        ])
          sum += signature[((2 * y + dy) * SIGNATURE + 2 * x + dx) * 4 + c];
        out[(y * COARSE + x) * 4 + c] = sum / 4;
      }
  return out;
}

/**
 * Where the stickers were cut, searched widely: the box's side from 0.6 to 1.6
 * times `box`'s and its centre anywhere within half a side, on up to four
 * pictures shrunk so the box is about 64 px, compared at 32 px. The face box
 * found from a set's differences can be far off the one the stickers were cut
 * with: a set whose pictures differ only in the mouth gives a small box, a prop
 * that changes between pictures a large one, and the old run may have used
 * another set of the same outfit. Returns a box in `sources`' pixels.
 */
export async function searchBox(sources, box, targets) {
  if (targets.length === 0) return box;
  const k = Math.min(1, 64 / box[2]);
  const shrunk = [];
  const step = Math.max(1, Math.floor(sources.length / 4));
  for (let at = 0; at < sources.length && shrunk.length < 4; at += step) {
    const meta = await sharp(sources[at]).metadata();
    const width = Math.max(1, Math.round(meta.width * k));
    const height = Math.max(1, Math.round(meta.height * k));
    const data = await sharp(sources[at])
      .ensureAlpha()
      .resize(width, height, { fit: "fill" })
      .raw()
      .toBuffer();
    const pre = new Float32Array(data.length);
    for (let i = 0; i < data.length; i += 4) {
      for (let c = 0; c < 3; c++)
        pre[i + c] = (data[i + c] * data[i + 3]) / 255;
      pre[i + 3] = data[i + 3];
    }
    shrunk.push({ data: pre, width, height });
  }
  const wanted = targets.map(coarseOf);
  const cell = new Float32Array(COARSE * COARSE * 4);
  // A crop sampled at 32×32 points, each the mean of a 2×2 of samples; past
  // the canvas is transparent, as `stickerOf` pads by fitting.
  const sample = ({ data, width, height }, left, top, side) => {
    const unit = side / COARSE;
    for (let y = 0; y < COARSE; y++)
      for (let x = 0; x < COARSE; x++) {
        const at = (y * COARSE + x) * 4;
        cell.fill(0, at, at + 4);
        for (const oy of [0.25, 0.75])
          for (const ox of [0.25, 0.75]) {
            const sx = Math.floor(left + (x + ox) * unit);
            const sy = Math.floor(top + (y + oy) * unit);
            if (sx < 0 || sy < 0 || sx >= width || sy >= height) continue;
            const from = (sy * width + sx) * 4;
            for (let c = 0; c < 4; c++) cell[at + c] += data[from + c] / 4;
          }
      }
    return cell;
  };
  const side0 = box[2] * k;
  const centre = [(box[0] + box[2] / 2) * k, (box[1] + box[2] / 2) * k];
  let best;
  for (let scale = 0.6; scale <= 1.61; scale *= 1.04) {
    const side = side0 * scale;
    const stride = Math.max(1, side / 12);
    for (let dy = -side0 / 2; dy <= side0 / 2; dy += stride)
      for (let dx = -side0 / 2; dx <= side0 / 2; dx += stride) {
        const left = centre[0] + dx - side / 2;
        const top = centre[1] + dy - side / 2;
        let total = 0;
        for (const picture of shrunk) {
          const own = sample(picture, left, top, side);
          let nearest = Infinity;
          for (const target of wanted) {
            let sum = 0;
            for (let i = 0; i < own.length; i++)
              sum += Math.abs(own[i] - target[i]);
            nearest = Math.min(nearest, sum);
          }
          total += nearest;
          if (best && total >= best.total) break;
        }
        if (!best || total < best.total) best = { total, left, top, side };
      }
  }
  const meta = await sharp(sources[0]).metadata();
  const side = Math.min(Math.round(best.side / k), meta.width, meta.height);
  return [
    Math.min(Math.max(Math.round(best.left / k), 0), meta.width - side),
    Math.min(Math.max(Math.round(best.top / k), 0), meta.height - side),
    side,
  ];
}

/**
 * `box` moved and resized to where the set's pictures best fit `targets`, the
 * stickers' signatures. The wiki's thumbnailer and ours differ, so the box
 * found again can be a few pixels off the one the stickers were cut with, and
 * one pixel already moves every edge (`distance` 8 on test art). The fit is the
 * sum over pictures of the mean distance to their nearest sticker, which falls
 * smoothly towards the right box; the search halves its step from 16 px to 1 px
 * and stays within a tenth of the box's side of where it started.
 */
export async function alignBox(sources, box, targets) {
  if (targets.length === 0) return box;
  const raws = [];
  for (const source of sources)
    raws.push(
      await sharp(source)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true }),
    );
  const { width, height } = raws[0].info;
  const limit = Math.max(2, Math.round(box[2] / 10));
  const allowed = ([left, top, side]) =>
    left >= 0 &&
    top >= 0 &&
    left < width - 16 &&
    top < height - 16 &&
    side >= 16 &&
    side <= Math.min(width, height) &&
    Math.abs(left - box[0]) <= limit &&
    Math.abs(top - box[1]) <= limit &&
    Math.abs(side - box[2]) <= limit;
  const seen = new Map();
  const fit = async ([left, top, wanted]) => {
    const key = `${left},${top},${wanted}`;
    if (!seen.has(key)) {
      let total = 0;
      for (const { data, info } of raws) {
        const side = Math.min(wanted, info.width - left, info.height - top);
        const own = await signature(
          sharp(data, { raw: info }).extract({
            left,
            top,
            width: side,
            height: side,
          }),
        );
        total += Math.min(
          ...targets.map((target) => meanDistance(own, target)),
        );
      }
      seen.set(key, total);
    }
    return seen.get(key);
  };
  let best = box;
  let bestFit = await fit(box);
  for (const step of [16, 8, 4, 2, 1])
    for (let moved = true; moved;) {
      moved = false;
      // Growing around the centre moves the corner by half as much.
      const half = Math.max(1, Math.floor(step / 2));
      for (const [dx, dy, ds] of [
        [step, 0, 0],
        [-step, 0, 0],
        [0, step, 0],
        [0, -step, 0],
        [-half, -half, 2 * half],
        [half, half, -2 * half],
        [0, 0, step],
        [0, 0, -step],
      ]) {
        const candidate = [best[0] + dx, best[1] + dy, best[2] + ds];
        if (!allowed(candidate)) continue;
        const candidateFit = await fit(candidate);
        if (candidateFit < bestFit) {
          best = candidate;
          bestFit = candidateFit;
          moved = true;
        }
      }
    }
  return best;
}

const round = (value, places = 1) =>
  value === undefined ? undefined : Number(value.toFixed(places));

/**
 * What a set's pictures have in common against their nearest stickers: per
 * channel, the median over pictures of picture minus nearest sticker. When the
 * stickers were cut from another copy of the same pictures (another wiki,
 * another export, a glow or a colour rendered differently), every picture
 * carries this same difference, while a picture's own look differs from its
 * nearest sticker only where its face is not that sticker's. Zero with fewer
 * than three pictures.
 */
export function commonOffset(pictures, stickers, mask) {
  if (pictures.length < 3 || stickers.length === 0)
    return new Float32Array(pictures[0]?.length ?? 0);
  return medianOffset(pictures, stickers, nearestOf(pictures, stickers, mask));
}

/** Each picture's nearest sticker over `mask`, by index. */
function nearestOf(pictures, stickers, mask) {
  return pictures.map((picture) => {
    let best;
    for (const [index, sticker] of stickers.entries()) {
      const { mean } = faceDistance(picture, sticker, mask);
      if (!best || mean < best.mean) best = { mean, index };
    }
    return best.index;
  });
}

/** Per channel, the median over pictures of picture minus `nearest` sticker. */
function medianOffset(pictures, stickers, nearest) {
  const offset = new Float32Array(pictures[0]?.length ?? 0);
  if (pictures.length < 3) return offset;
  const values = new Float32Array(pictures.length);
  for (let at = 0; at < offset.length; at++) {
    for (const [index, picture] of pictures.entries())
      values[index] = picture[at] - stickers[nearest[index]][at];
    values.sort();
    const middle = values.length >> 1;
    offset[at] =
      values.length % 2
        ? values[middle]
        : (values[middle - 1] + values[middle]) / 2;
  }
  return offset;
}

/**
 * Names for a set's pictures (`pictures`, fine signatures of their would-be
 * stickers) from one outfit's `stickers` and `names`.
 *
 * - The set's common difference to the stickers (`commonOffset`) is taken off
 *   every picture first, when it is small (`maxOffset`, mean over the face): a
 *   rendering difference, not another outfit.
 * - A picture takes its nearest sticker's name only when it is near over the face
 *   (`maxDistance`, `maxWorst`) and nearer than every other sticker where the
 *   two differ (`minAdvantage`); otherwise it is `unmatched` or `ambiguous`.
 * - Stickers that are twins (the same picture under two names in the sticker set)
 *   are one look: a picture that is that look takes every name of it (`match`
 *   and `also`).
 * - When pictures take the same name, the one the sticker is clearly nearer to
 *   keeps it (judged where the pictures differ), or the nearest when the others
 *   are its twins (`duplicate`: the same look twice on the wiki); else none
 *   does (`conflict`).
 *
 * Returns `{ results, offset }`, `offset` being the mean taken off, or 0.
 */
export function matchPictures(
  pictures,
  stickers,
  names,
  rule = DEFAULTS,
  full = undefined,
) {
  const mask = faceMask(stickers, pictures);
  const nearest =
    pictures.length >= 3 && stickers.length
      ? nearestOf(pictures, stickers, mask)
      : undefined;
  const common = nearest
    ? medianOffset(pictures, stickers, nearest)
    : new Float32Array(pictures[0]?.length ?? 0);
  let size = 0;
  for (const at of mask)
    for (let c = 0; c < 4; c++) size += Math.abs(common[at * 4 + c]);
  size /= Math.max(mask.length * 4, 1);
  const correct = size > 0 && size <= rule.maxOffset;
  const corrected = correct
    ? pictures.map((picture) => picture.map((value, at) => value - common[at]))
    : pictures;
  // The second look, at full size: small features (a sweat drop, an eyelid)
  // that the blur of the first look spreads too thin to decide on.
  let closerLook;
  if (full) {
    const fullCommon = correct
      ? medianOffset(full.pictures, full.stickers, nearest)
      : undefined;
    const fullPictures = fullCommon
      ? full.pictures.map((picture) =>
          picture.map((value, at) => value - fullCommon[at]),
        )
      : full.pictures;
    closerLook = (picture, a, b) =>
      advantage(fullPictures[picture], a, b, MIN_CHANNELS * 4);
    closerLook.picture = (index) => fullPictures[index];
  }
  const twinsOf = (index) =>
    stickers
      .map((_, other) => other)
      .filter(
        (other) =>
          other !== index &&
          advantage(stickers[index], stickers[index], stickers[other]) ===
            undefined,
      );
  const results = corrected.map((picture, pictureIndex) => {
    const order = stickers
      .map((sticker, index) => ({
        index,
        ...faceDistance(picture, sticker, mask),
      }))
      .sort((a, b) => a.mean - b.mean);
    const [best, second] = order;
    const result = {
      match: null,
      status: "unmatched",
      nearest: best ? names[best.index] : null,
      distance: round(best?.mean),
      worst: round(best?.worst),
      runnerUp: second ? names[second.index] : null,
      runnerUpDistance: round(second?.mean),
    };
    if (!best || best.mean > rule.maxDistance || best.worst > rule.maxWorst)
      return result;
    const twins = new Set(twinsOf(best.index));
    // The least the best wins by, over every other sticker but its twins.
    let least = Infinity;
    let rival;
    let looked = false;
    for (const other of order.slice(1)) {
      if (twins.has(other.index)) continue;
      let value =
        advantage(picture, stickers[best.index], stickers[other.index]) ??
        -Infinity;
      if (value < rule.minAdvantage && closerLook) {
        const closer = closerLook(
          pictureIndex,
          full.stickers[best.index],
          full.stickers[other.index],
        );
        if (closer !== undefined) {
          value = closer;
          looked = true;
        }
      }
      if (value < least) {
        least = value;
        rival = other.index;
      }
    }
    if (least === Infinity) least = 1;
    const judged = {
      ...result,
      advantage: Number.isFinite(least) ? round(least, 2) : null,
      ...(looked ? { secondLook: true } : {}),
      ...(rival === undefined ? {} : { rival: names[rival] }),
    };
    if (least < rule.minAdvantage) return { ...judged, status: "ambiguous" };
    return {
      ...judged,
      status: "matched",
      match: names[best.index],
      ...(twins.size
        ? { also: [...twins].map((index) => names[index]).sort() }
        : {}),
    };
  });
  // A look is claimed by its name and its twins' names together.
  const takers = new Map();
  for (const [index, result] of results.entries())
    if (result.match) {
      const look = [result.match, ...(result.also ?? [])].sort().join(" ");
      takers.set(look, [...(takers.get(look) ?? []), index]);
    }
  for (const claim of takers.values()) {
    if (claim.length < 2) continue;
    claim.sort((a, b) => results[a].distance - results[b].distance);
    const [keep, ...rest] = claim;
    const sticker = stickers[names.indexOf(results[keep].match)];
    const settled = rest.map((index) => {
      const value = advantage(sticker, corrected[keep], corrected[index]);
      if (value === undefined) return "duplicate";
      if (value >= rule.minAdvantage || !closerLook)
        return value >= rule.minAdvantage;
      const fullSticker = full.stickers[names.indexOf(results[keep].match)];
      const closer = advantage(
        fullSticker,
        closerLook.picture(keep),
        closerLook.picture(index),
        MIN_CHANNELS * 4,
      );
      return closer !== undefined && closer >= rule.minAdvantage;
    });
    const fine = settled.every((value) => value !== false);
    for (const [at, index] of (fine ? rest : claim).entries())
      results[index] = {
        ...results[index],
        status: !fine
          ? "conflict"
          : settled[at] === "duplicate"
            ? "duplicate"
            : "outmatched",
        match: null,
        also: undefined,
        ...(fine ? { lostTo: keep + 1 } : {}),
      };
  }
  // Twins need not be twins of each other's twins (a like b, b like c, a
  // unlike c), so two looks can both bring the same twin's name. A name stays
  // with the picture that matched it itself; a name only brought along by two
  // or more is given to none.
  const bringers = new Map();
  for (const [index, result] of results.entries())
    for (const name of result.also ?? [])
      bringers.set(name, [...(bringers.get(name) ?? []), index]);
  const matched = new Set(results.map((result) => result.match));
  for (const [name, indices] of bringers)
    if (matched.has(name) || indices.length > 1)
      for (const index of indices) {
        const also = results[index].also.filter((other) => other !== name);
        results[index] = {
          ...results[index],
          also: also.length ? also : undefined,
        };
      }
  return { results, offset: round(size === Infinity ? 0 : size, 2) };
}

/** Name → signature of every sticker in a workspace. */
async function stickerSignatures(workspace) {
  const dir = path.join(workspace, "stickers");
  const files = existsSync(dir)
    ? readdirSync(dir)
        .filter((file) => /\.(webp|png|gif|jpe?g|avif)$/.test(file))
        .sort()
    : [];
  const manifest = path.join(dir, "stickers.json");
  const outfits = existsSync(manifest)
    ? Object.keys(JSON.parse(readFileSync(manifest, "utf8")).outfits ?? {})
    : [];
  const names = [];
  const signatures = [];
  const fine = [];
  const full = [];
  const paths = [];
  for (const file of files) {
    names.push(file.replace(/\.[^.]+$/, ""));
    paths.push(path.join(dir, file));
    signatures.push(await signature(path.join(dir, file)));
    fine.push(await fineSignature(path.join(dir, file)));
    full.push(await fullSignature(path.join(dir, file)));
  }
  return { names, signatures, fine, full, paths, outfits };
}

/**
 * A sticker name's outfit: its first word when `stickers.json` declares it as
 * one (`gym-happy` → `gym`), else "" for the default outfit.
 */
export function outfitOf(name, outfits) {
  const at = name.indexOf("-");
  return at > 0 && outfits.includes(name.slice(0, at)) ? name.slice(0, at) : "";
}

/**
 * The outfit a plan set holds: its `outfit` ("" for the default one), else its
 * id when that is a declared outfit, else the default.
 */
export function outfitOfSet(set, outfits) {
  if (typeof set.outfit === "string") {
    if (set.outfit && !outfits.includes(set.outfit))
      throw new Error(`${set.id}: no outfit ${set.outfit} in stickers.json`);
    return set.outfit;
  }
  return outfits.includes(set.id) ? set.id : "";
}

const blank = () =>
  sharp({
    create: {
      width: 1,
      height: 1,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .png()
    .toBuffer();

const thumb = (buffer) =>
  sharp(buffer)
    .resize(160, 160, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();

export async function stagePortraits(planFile, workspace, dir, options = {}) {
  const opts = { ...DEFAULTS, ...options };
  const get = (url) => politeGet(url, opts.fetch, opts.userAgent, opts.timeout);
  const plan = JSON.parse(readFileSync(planFile, "utf8"));
  const face = plan.crop !== "whole";
  const cache = path.join(opts.cache, cacheKey(plan));
  const stickers = await stickerSignatures(workspace);
  const rule = {
    maxDistance: opts.maxDistance,
    maxWorst: opts.maxWorst,
    minAdvantage: opts.minAdvantage,
    maxOffset: opts.maxOffset,
  };
  const report = {
    workspace: path.resolve(workspace),
    wiki: plan.wiki,
    cache,
    match: rule,
    sets: [],
  };
  mkdirSync(dir, { recursive: true });
  const run = { downloads: 0 };
  for (const set of plan.sets) {
    if (!NAME.test(set.id)) throw new Error(`Set id isn't a name: ${set.id}`);
    const pictures = await originals(plan, set, cache, {
      delay: opts.delay,
      get,
      run,
    });
    const out = path.join(dir, set.id);
    rmSync(out, { recursive: true, force: true });
    mkdirSync(out, { recursive: true });
    if (pictures.length === 0) continue;
    const buffers = pictures.map((picture) => picture.buffer);

    // Name each picture by the sticker `stickers.mjs stage` would cut from it.
    const sources = [];
    for (const buffer of buffers) sources.push(await faceSource(buffer));
    const { width: sourceWidth } = await sharp(buffers[0]).metadata();
    const crop = await cropOfSet(sources, {
      face,
      box: set.box,
      sourceWidth,
    });
    // Only the set's own outfit can be what its pictures became.
    const outfit = outfitOfSet(set, stickers.outfits);
    const candidates = stickers.names
      .map((name, index) => index)
      .filter(
        (index) => outfitOf(stickers.names[index], stickers.outfits) === outfit,
      );
    const targets = candidates.map((index) => stickers.signatures[index]);
    // A box from the plan is where to look; one found from differences is
    // only a start for a wide search.
    const stickerBox =
      face && crop.box
        ? await alignBox(
            sources,
            set.box ? crop.box : await searchBox(sources, crop.box, targets),
            targets,
          )
        : undefined;
    const wouldBe = [];
    for (const source of sources)
      wouldBe.push(await stickerOf(source, stickerBox));
    const own = [];
    const ownFull = [];
    for (const sticker of wouldBe) {
      own.push(await fineSignature(sticker));
      ownFull.push(await fullSignature(sticker));
    }
    const { results: names, offset } = matchPictures(
      own,
      candidates.map((index) => stickers.fine[index]),
      candidates.map((index) => stickers.names[index]),
      rule,
      {
        pictures: ownFull,
        stickers: candidates.map((index) => stickers.full[index]),
      },
    );

    // One box and scale for the whole set, from pictures of the first's size.
    const first = await sharp(buffers[0]).metadata();
    const fits = [];
    for (const buffer of buffers) {
      const meta = await sharp(buffer).metadata();
      fits.push(meta.width === first.width && meta.height === first.height);
    }
    const trim = await unionBox(buffers.filter((_, index) => fits[index]));
    if (!trim) {
      console.warn(`${set.id}: every picture is transparent`);
      continue;
    }
    const height = Math.min(trim.height, opts.maxHeight);
    const size = [
      trim.height > opts.maxHeight
        ? Math.max(1, Math.round((trim.width * height) / trim.height))
        : trim.width,
      height,
    ];
    const features =
      crop.features ??
      (face && sources.length > 1 ? await faceFeatures(sources) : undefined);
    const eyeY = features
      ? features.ys[0] + EYE_AT * (features.ys[1] - features.ys[0])
      : stickerBox
        ? stickerBox[1] + stickerBox[2] / 2
        : undefined;
    const eyeline =
      eyeY === undefined
        ? undefined
        : round(
            Math.min(
              Math.max((eyeY / crop.scale - trim.top) / trim.height, 0),
              1,
            ),
            3,
          );

    const entries = [];
    for (const [index, picture] of pictures.entries()) {
      const entry = { n: index + 1, source: picture.file };
      if (!fits[index]) {
        console.warn(`${set.id}: ${picture.file} isn't the set's size`);
        entries.push({ ...entry, file: null, status: "size", name: null });
        continue;
      }
      const file = path.resolve(out, `${index + 1}.webp`);
      writeFileSync(
        file,
        await normalize(picture.buffer, trim, opts.maxHeight),
      );
      entries.push({
        ...entry,
        file,
        ...names[index],
        name: names[index].match,
      });
    }

    // Matched: picture, its would-be sticker, the sticker it matched.
    // The rest: picture, would-be sticker, the nearest two stickers.
    const cellOf = async (name) =>
      name ? stickers.paths[stickers.names.indexOf(name)] : await blank();
    for (const matched of [true, false]) {
      const shown = entries.filter(
        (entry) => (entry.status === "matched") === matched,
      );
      if (shown.length === 0) continue;
      const cells = [];
      const captions = [];
      for (const entry of shown) {
        const index = entry.n - 1;
        cells.push(
          await thumb(entry.file ? readFileSync(entry.file) : buffers[index]),
          wouldBe[index],
          await cellOf(entry.nearest),
        );
        captions.push(
          `#${entry.n}`,
          matched
            ? `d ${entry.distance} a ${entry.advantage}`
            : `${entry.status}${entry.duplicateOf ? ` #${entry.duplicateOf}` : ""}`,
          matched
            ? entry.match
            : `${entry.nearest ?? "none"} ${entry.distance ?? ""}`,
        );
        if (!matched) {
          // An ambiguous picture's rival is what it couldn't be told from.
          const other = entry.rival ?? entry.runnerUp;
          cells.push(await cellOf(other));
          captions.push(
            entry.rival
              ? `${entry.rival} a ${entry.advantage ?? "twin"}`
              : `${entry.runnerUp ?? "none"} ${entry.runnerUpDistance ?? ""}`,
          );
        }
      }
      await contactSheet(
        cells,
        path.join(out, matched ? "matched.png" : "unmatched.png"),
        captions,
        matched ? 3 : 4,
      );
    }

    const inSource = (box) =>
      box.map((value) => Math.round(value / crop.scale));
    report.sets.push({
      id: set.id,
      outfit,
      offset,
      ...(stickerBox
        ? {
            faceBox: inSource(crop.box),
            stickerBox: inSource(stickerBox),
          }
        : {}),
      trim: [trim.left, trim.top, trim.width, trim.height],
      size,
      ...(eyeline === undefined ? {} : { eyeline }),
      portraits: entries,
    });
    const counts = entries.reduce(
      (sum, entry) => ({
        ...sum,
        [entry.status]: (sum[entry.status] ?? 0) + 1,
      }),
      {},
    );
    console.log(
      `${set.id}: ${entries.length} staged, ${Object.entries(counts)
        .map(([status, count]) => `${count} ${status}`)
        .join(", ")}`,
    );
  }
  writeFileSync(
    path.join(dir, "stage.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  return report;
}

/**
 * Replaces `<workspace>/portraits/` with the report's named pictures and a
 * `portraits.json` from the set holding `neutral` (else the first name).
 */
export function placePortraits(reportFile) {
  const report = JSON.parse(readFileSync(reportFile, "utf8"));
  const chosen = [];
  for (const set of report.sets)
    for (const entry of set.portraits)
      if (entry.name)
        for (const name of [entry.name, ...(entry.also ?? [])])
          chosen.push({ set, entry, name });
  const names = new Set();
  for (const { name, entry } of chosen) {
    if (!NAME.test(name)) throw new Error(`Not a portrait name: ${name}`);
    if (names.has(name)) throw new Error(`Two portraits named ${name}`);
    if (!entry.file || !existsSync(entry.file))
      throw new Error(`${name}: no staged picture ${entry.file}`);
    names.add(name);
  }
  if (chosen.length === 0) throw new Error("No picture has a name");
  const stickerDir = path.join(report.workspace, "stickers");
  const stickerNames = new Set(
    existsSync(stickerDir)
      ? readdirSync(stickerDir).map((file) => file.replace(/\.[^.]+$/, ""))
      : [],
  );
  for (const name of names)
    if (!stickerNames.has(name))
      console.warn(`${name}: no sticker has this name`);

  const dir = path.join(report.workspace, "portraits");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  chosen.sort((a, b) => a.name.localeCompare(b.name));
  for (const { entry, name } of chosen)
    copyFileSync(entry.file, path.join(dir, `${name}.webp`));
  const lead = (chosen.find(({ name }) => name === "neutral") ?? chosen[0]).set;
  for (const set of new Set(chosen.map(({ set }) => set)))
    if (
      set !== lead &&
      (set.size.join() !== lead.size.join() ||
        Math.abs((set.eyeline ?? 0) - (lead.eyeline ?? 0)) > 0.02)
    )
      console.warn(
        `${set.id}: size ${set.size.join("×")}, eyeline ${set.eyeline}; portraits.json has ${lead.id}'s`,
      );
  const manifest = {
    size: lead.size,
    ...(lead.eyeline === undefined ? {} : { eyeline: lead.eyeline }),
  };
  writeFileSync(
    path.join(dir, "portraits.json"),
    `${JSON.stringify(manifest)}\n`,
  );
  console.log(`${dir}: ${chosen.length} portraits`);
  return { dir, names: [...names], manifest };
}

const USAGE = `Usage:
  portraits.mjs stage <plan.json> <workspace> <dir> [options]
    Fetch originals (cached), trim each set together, match to the workspace's
    stickers. Writes <dir>/<set>/<n>.webp, matched.png, unmatched.png and
    <dir>/stage.json. Options:
      --cache <dir>          originals cache (default .cache/art)
      --max-height <px>      height cap (default ${DEFAULTS.maxHeight})
      --delay <ms>           pause between downloads (default ${DEFAULTS.delay})
      --user-agent <text>    User-Agent header (default ${DEFAULTS.userAgent})
      --max-distance <n>     match threshold, 0-255 (default ${DEFAULTS.maxDistance})
  portraits.mjs place <dir>/stage.json
    Write <workspace>/portraits/<name>.webp for every picture with a "name"
    (fill unmatched ones in by hand first) and portraits.json.`;

function parseOptions(args) {
  const flags = {
    "--cache": ["cache", String],
    "--max-height": ["maxHeight", Number],
    "--delay": ["delay", Number],
    "--user-agent": ["userAgent", String],
    "--max-distance": ["maxDistance", Number],
  };
  const options = {};
  const positional = [];
  for (let at = 0; at < args.length; at++) {
    const flag = flags[args[at]];
    if (!flag) {
      positional.push(args[at]);
      continue;
    }
    const value = flag[1](args[++at]);
    if (args[at] === undefined || Number.isNaN(value))
      throw new Error(`${args[at - 1]} needs a value`);
    options[flag[0]] = value;
  }
  return { positional, options };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, ...rest] = process.argv.slice(2);
  let parsed;
  try {
    parsed = parseOptions(rest);
  } catch (error) {
    console.error(`${error.message}\n${USAGE}`);
    process.exit(1);
  }
  const { positional, options } = parsed;
  if (command === "stage" && positional.length === 3)
    await stagePortraits(...positional, options);
  else if (command === "place" && positional.length === 1)
    placePortraits(positional[0]);
  else {
    console.error(USAGE);
    process.exit(1);
  }
}
