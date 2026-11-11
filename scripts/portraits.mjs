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
 * Originals are kept in `.cache/art/<plan id or wiki host>/<set>/<File>`
 * (git-ignored). A re-run reads them and fetches only what is missing.
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
  AGENT,
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
  /** Largest accepted distance (see `distance`), on a 0–255 scale. */
  maxDistance: 16,
  /** The runner-up must be at least this many times as far as the best… */
  minRatio: 2,
  /** …and at least this much farther. */
  minGap: 8,
};
/** Lossy colour that keeps flat shading and line art; lossless alpha. */
export const PORTRAIT_WEBP = {
  quality: 88,
  alphaQuality: 100,
  smartSubsample: true,
  preset: "drawing",
  effort: 6,
};
/** Opacity at or below this is margin, not figure. */
const ALPHA_MIN = 8;
/**
 * The eyes, as a fraction of the way down the rows where a set's pictures
 * differ: from the brows to the mouth, the eyes sit in the upper third.
 */
const EYE_AT = 0.3;
const SIGNATURE = 64;
const CELL = 4;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One request; a 429 or 503 is tried once more after the server's Retry-After
 * (at most 30 s). Anything else that fails stops the run with what failed.
 */
export async function politeGet(url, fetchImpl = fetch) {
  for (let attempt = 1; ; attempt++) {
    let response;
    try {
      response = await fetchImpl(url, { headers: { "User-Agent": AGENT } });
    } catch (error) {
      throw new Error(`Couldn't fetch ${url}: ${error.message}`, {
        cause: error,
      });
    }
    if (response.ok) return response;
    if (attempt === 1 && (response.status === 429 || response.status === 503)) {
      const wait = Number(response.headers.get("retry-after")) || 5;
      await sleep(Math.min(wait, 30) * 1000);
      continue;
    }
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
}

const safe = (name) => name.replace(/[/\\:*?"<>|]/g, "_");

/** `.cache/art/<this>`: the plan's `id`, else the wiki's host. */
export const cacheKey = (plan) =>
  safe(plan.id && NAME.test(plan.id) ? plan.id : new URL(plan.wiki).host);

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
 * The worst 4×4 cell of two signatures: the mean absolute difference of its
 * channels, 0–255. Recompression and resampling spread small errors evenly;
 * another expression moves the eyes or mouth, which is large in a few cells.
 */
export function distance(a, b) {
  const cells = SIGNATURE / CELL;
  let worst = 0;
  for (let cy = 0; cy < cells; cy++)
    for (let cx = 0; cx < cells; cx++) {
      let sum = 0;
      for (let y = cy * CELL; y < (cy + 1) * CELL; y++)
        for (let x = cx * CELL; x < (cx + 1) * CELL; x++) {
          const at = (y * SIGNATURE + x) * 4;
          for (let c = 0; c < 4; c++) sum += Math.abs(a[at + c] - b[at + c]);
        }
      worst = Math.max(worst, sum / (CELL * CELL * 4));
    }
  return worst;
}

/** The mean absolute difference of two signatures, 0–255. */
export function meanDistance(a, b) {
  let sum = 0;
  for (let at = 0; at < a.length; at++) sum += Math.abs(a[at] - b[at]);
  return sum / a.length;
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
 * Names for pictures from `distances[picture][sticker]`. A picture takes its
 * nearest sticker's name only when that is within `maxDistance` and clearly
 * nearer than the runner-up (`minRatio` times and `minGap` farther), and only
 * when no other picture takes the same name; otherwise it is `unmatched`,
 * `ambiguous` or `conflict`, and keeps no name.
 */
export function assignNames(distances, names, rule = DEFAULTS) {
  const results = distances.map((row) => {
    const order = row
      .map((value, index) => [value, index])
      .sort((a, b) => a[0] - b[0]);
    const [best, second] = order;
    const result = {
      match: null,
      status: "unmatched",
      nearest: best ? names[best[1]] : null,
      distance: round(best?.[0]),
      runnerUp: second ? names[second[1]] : null,
      runnerUpDistance: round(second?.[0]),
    };
    if (!best || best[0] > rule.maxDistance) return result;
    if (
      second &&
      (second[0] < best[0] * rule.minRatio || second[0] - best[0] < rule.minGap)
    )
      return { ...result, status: "ambiguous" };
    return { ...result, status: "matched", match: names[best[1]] };
  });
  const takers = new Map();
  for (const result of results)
    if (result.match)
      takers.set(result.match, (takers.get(result.match) ?? 0) + 1);
  return results.map((result) =>
    result.match && takers.get(result.match) > 1
      ? { ...result, status: "conflict", match: null }
      : result,
  );
}

/** Name → signature of every sticker in a workspace. */
async function stickerSignatures(workspace) {
  const dir = path.join(workspace, "stickers");
  const files = existsSync(dir)
    ? readdirSync(dir)
        .filter((file) => /\.(webp|png|gif|jpe?g|avif)$/.test(file))
        .sort()
    : [];
  const names = [];
  const signatures = [];
  const paths = [];
  for (const file of files) {
    names.push(file.replace(/\.[^.]+$/, ""));
    paths.push(path.join(dir, file));
    signatures.push(await signature(path.join(dir, file)));
  }
  return { names, signatures, paths };
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
  const get = (url) => politeGet(url, opts.fetch);
  const plan = JSON.parse(readFileSync(planFile, "utf8"));
  const face = plan.crop !== "whole";
  const cache = path.join(opts.cache, cacheKey(plan));
  const stickers = await stickerSignatures(workspace);
  const rule = {
    maxDistance: opts.maxDistance,
    minRatio: opts.minRatio,
    minGap: opts.minGap,
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
    const pictures = await originals(plan, set, path.join(cache, set.id), {
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
    const stickerBox =
      face && crop.box
        ? await alignBox(sources, crop.box, stickers.signatures)
        : undefined;
    const wouldBe = [];
    for (const source of sources)
      wouldBe.push(await stickerOf(source, stickerBox));
    const distances = [];
    for (const sticker of wouldBe) {
      const own = await signature(sticker);
      distances.push(stickers.signatures.map((other) => distance(own, other)));
    }
    const names = assignNames(distances, stickers.names, rule);

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
          matched ? `d ${entry.distance}` : entry.status,
          matched
            ? entry.match
            : `${entry.nearest ?? "none"} ${entry.distance ?? ""}`,
        );
        if (!matched) {
          cells.push(await cellOf(entry.runnerUp));
          captions.push(
            `${entry.runnerUp ?? "none"} ${entry.runnerUpDistance ?? ""}`,
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
      if (entry.name) chosen.push({ set, entry, name: entry.name });
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
      --max-distance <n>     match threshold, 0-255 (default ${DEFAULTS.maxDistance})
  portraits.mjs place <dir>/stage.json
    Write <workspace>/portraits/<name>.webp for every picture with a "name"
    (fill unmatched ones in by hand first) and portraits.json.`;

function parseOptions(args) {
  const flags = {
    "--cache": ["cache", String],
    "--max-height": ["maxHeight", Number],
    "--delay": ["delay", Number],
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
