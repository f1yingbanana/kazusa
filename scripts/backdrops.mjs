#!/usr/bin/env node
/**
 * Builds a world's backdrop library (`shared/backdrops/<set>/<name>.webp`, see
 * the kazusa-client skill's `references/visual-novel.md` §8.2) from a MediaWiki
 * category of background pictures, and names a set on place pages:
 *
 * - `list` enumerates the category through the API and keeps the listing, with
 *   each file's size and the URL it will be fetched from, in the cache.
 * - `stage <dir>` downloads every listed file into the cache (sequential,
 *   throttled, atomic, resumable: a cached file is never fetched again),
 *   normalises each to a WebP at most `--width` wide in `<dir>/pictures/`, and
 *   writes `<dir>/index.json` and labelled contact sheets in `<dir>/sheets/`.
 * - `place <labels.json> <index.json> <world>` writes the labelled sets into
 *   `<world>/shared/backdrops/`, with a `backdrops.json` for sets that declare
 *   states. It writes nothing outside that folder.
 * - `assign <places.json> <world>` sets or replaces the `backdrop:` line in each
 *   named place page's frontmatter, and changes nothing else in the file.
 * - `check <world>` reads the library and the place pages as the plugin does and
 *   reports every problem, and how many places resolve to a set.
 *
 * Originals are kept in `<cache>/<wiki host>/<category>/` (default
 * `.cache/art`, git-ignored). A re-run with everything cached sends no
 * request.
 */
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { NAME } from "./stickers.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
/** A generic client name: nothing about who runs it or for what. */
export const AGENT = "art-importer/1.0";
export const DEFAULTS = {
  cache: path.join(ROOT, ".cache", "art"),
  /** The scene is drawn `object-fit: cover`, at most about 1920 px wide. */
  width: 1920,
  /** Between any two requests, API or file. */
  delay: 500,
  /**
   * Originals larger than this, in bytes or pixels wide, are fetched as the
   * wiki's own rendering at `thumbWidth` instead.
   */
  maxOriginalBytes: 6_000_000,
  /**
   * A static original costs the wiki less than rendering a new thumbnail, so
   * only a truly huge one is fetched as a rendering.
   */
  maxOriginalWidth: 8192,
  thumbWidth: 2560,
  /** `stage` stops after listing a category larger than this… */
  maxFiles: 1500,
  /** …or whose downloads would add up to more than this many bytes. */
  maxBytes: 6_000_000_000,
  /** Attempts per request before the run stops. */
  tries: 3,
  /** A `Retry-After` longer than this, in seconds, stops the run instead. */
  maxRetryAfter: 300,
  columns: 4,
  rows: 5,
};
/** Painted and rendered scenery: smooth gradients, fine detail, no alpha. */
export const BACKDROP_WEBP = {
  quality: 80,
  preset: "picture",
  smartSubsample: true,
  effort: 6,
};
/** The plugin's default `scene.times`, in order of the day. */
export const TIMES = ["day", "dusk", "night"];
const MAX_NAME = 64;
const RASTER = /\.(webp|png|gif|jpe?g|avif)$/i;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const safe = (name) => name.replace(/[/\\:*?"<>|]/g, "_");
const isName = (value) =>
  typeof value === "string" && NAME.test(value) && value.length <= MAX_NAME;

/** Writes through a temporary file beside the target, then renames it. */
export function writeAtomic(file, data) {
  mkdirSync(path.dirname(file), { recursive: true });
  const part = `${file}.${process.pid}.part`;
  writeFileSync(part, data);
  renameSync(part, file);
}

/** Seconds a `Retry-After` header asks for (a number or an HTTP date). */
function retryAfter(header) {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds);
  const at = Date.parse(header);
  return Number.isNaN(at) ? undefined : Math.max(0, (at - Date.now()) / 1000);
}

/**
 * A polite, strictly sequential HTTP client: `delay` ms between any two
 * requests, a 429 or 5xx (or a network error) retried after the server's
 * `Retry-After` (else 5 s, then 10 s), and the run stopped after `tries`
 * attempts or when the server asks to wait longer than `maxRetryAfter`. `stats`
 * counts requests and downloaded bytes.
 */
export function politeClient(options = {}) {
  const opts = { ...DEFAULTS, ...options };
  const fetchImpl = opts.fetch ?? fetch;
  const stats = { requests: 0, bytes: 0, retries: 0 };
  let last = 0;
  async function get(url) {
    for (let attempt = 1; ; attempt++) {
      const wait = last + opts.delay - Date.now();
      if (wait > 0) await sleep(wait);
      stats.requests++;
      let response;
      let failure;
      try {
        response = await fetchImpl(url, { headers: { "User-Agent": AGENT } });
      } catch (error) {
        failure = error;
      }
      last = Date.now();
      if (response?.ok) return response;
      const retryable =
        !response || response.status === 429 || response.status >= 500;
      const what = response ? `HTTP ${response.status}` : failure.message;
      if (!retryable || attempt >= opts.tries)
        throw Object.assign(
          new Error(`${what} for ${url}`, { cause: failure }),
          response ? { status: response.status } : {},
        );
      const asked = retryAfter(response?.headers.get("retry-after"));
      if (asked !== undefined && asked > opts.maxRetryAfter)
        throw new Error(
          `${what} for ${url}, and the server asks to wait ${Math.round(asked)} s; stopping`,
        );
      stats.retries++;
      await sleep((asked ?? 5 * attempt) * 1000);
    }
  }
  return {
    stats,
    get,
    async json(url) {
      const data = await (await get(url)).json();
      if (data.error)
        throw new Error(`${data.error.code}: ${data.error.info} (${url})`);
      return data;
    },
    async bytes(url) {
      const body = Buffer.from(await (await get(url)).arrayBuffer());
      stats.bytes += body.length;
      return body;
    },
  };
}

const api = (wiki, query) =>
  `${wiki.replace(/\/$/, "")}/api.php?${new URLSearchParams({
    ...query,
    format: "json",
    formatversion: "2",
  })}`;

/** Every file title in `category` (`Category:…`), without `File:`, in order. */
export async function categoryFiles(wiki, category, client) {
  const titles = [];
  let next = {};
  for (;;) {
    const data = await client.json(
      api(wiki, {
        action: "query",
        list: "categorymembers",
        cmtitle: category,
        cmtype: "file",
        cmlimit: "500",
        ...next,
      }),
    );
    for (const member of data.query?.categorymembers ?? [])
      titles.push(member.title.replace(/^File:/, ""));
    if (!data.continue) return titles;
    next = data.continue;
  }
}

/**
 * File title → its original's size, type and URLs, and `download`: the URL to
 * fetch, the original unless it is larger than `maxOriginalBytes` or wider than
 * `maxOriginalWidth`, then the wiki's rendering `thumbWidth` wide.
 */
export async function fileInfo(wiki, titles, client, options = {}) {
  const opts = { ...DEFAULTS, ...options };
  const info = new Map();
  for (let at = 0; at < titles.length; at += 50) {
    const data = await client.json(
      api(wiki, {
        action: "query",
        titles: titles
          .slice(at, at + 50)
          .map((title) => `File:${title}`)
          .join("|"),
        prop: "imageinfo",
        iiprop: "url|size|mime",
        iiurlwidth: String(opts.thumbWidth),
      }),
    );
    const normalized = new Map(
      (data.query?.normalized ?? []).map(({ from, to }) => [to, from]),
    );
    for (const page of data.query?.pages ?? []) {
      const image = page.imageinfo?.[0];
      if (!image) continue;
      const title = (normalized.get(page.title) ?? page.title).replace(
        /^File:/,
        "",
      );
      const big =
        image.size > opts.maxOriginalBytes ||
        image.width > opts.maxOriginalWidth;
      const thumb = big && image.thumburl && image.thumbwidth < image.width;
      info.set(title, {
        title,
        width: image.width,
        height: image.height,
        bytes: image.size,
        mime: image.mime,
        url: image.url,
        page: image.descriptionurl,
        download: thumb
          ? { kind: "thumb", width: image.thumbwidth, url: image.thumburl }
          : { kind: "original", width: image.width, url: image.url },
      });
    }
  }
  return info;
}

/** `<cache>/<wiki host>/<category without its namespace>`. */
export const cacheDir = (cache, wiki, category) =>
  path.join(
    cache,
    safe(new URL(wiki).host),
    safe(category.replace(/^Category:/, "")),
  );

/** Where a file's download is kept: by title, under its kind and width. */
const cachedFile = (dir, entry) =>
  path.join(
    dir,
    entry.download.kind === "original"
      ? "originals"
      : `w${entry.download.width}`,
    safe(entry.title),
  );

/**
 * The category's listing: from `<cache dir>/listing.json`, else (or with
 * `refresh`) from the wiki, then kept there.
 */
export async function listBackdrops(wiki, category, options = {}) {
  const opts = { ...DEFAULTS, ...options };
  const client = opts.client ?? politeClient(opts);
  const dir = cacheDir(opts.cache, wiki, category);
  const file = path.join(dir, "listing.json");
  if (!opts.refresh && existsSync(file)) {
    const listing = JSON.parse(readFileSync(file, "utf8"));
    if (listing.wiki === wiki && listing.category === category)
      return { listing, dir, client, cached: true };
  }
  const titles = await categoryFiles(wiki, category, client);
  const info = await fileInfo(wiki, titles, client, opts);
  const missing = titles.filter((title) => !info.has(title));
  const listing = {
    wiki,
    category,
    listed: new Date().toISOString(),
    rule: {
      maxOriginalBytes: opts.maxOriginalBytes,
      maxOriginalWidth: opts.maxOriginalWidth,
      thumbWidth: opts.thumbWidth,
    },
    ...(missing.length ? { missing } : {}),
    files: titles.filter((title) => info.has(title)).map((t) => info.get(t)),
  };
  writeAtomic(file, `${JSON.stringify(listing, null, 2)}\n`);
  return { listing, dir, client, cached: false };
}

/** Counts and bytes of a listing, what was asked to be fetched. */
export function listingSummary(listing) {
  const sum = (files, key) => files.reduce((total, f) => total + f[key], 0);
  const thumbs = listing.files.filter((f) => f.download.kind === "thumb");
  return {
    files: listing.files.length,
    missing: listing.missing?.length ?? 0,
    originalBytes: sum(listing.files, "bytes"),
    thumbs: thumbs.length,
    /** Thumbnails' sizes aren't listed: count them at their original's. */
    downloadBytesAtMost: sum(listing.files, "bytes"),
    mimes: listing.files.reduce(
      (count, f) => ({ ...count, [f.mime]: (count[f.mime] ?? 0) + 1 }),
      {},
    ),
  };
}

/**
 * A picture as a backdrop: at most `width` wide, aspect kept, never enlarged,
 * WebP (`BACKDROP_WEBP`, `quality` overridable).
 */
export async function normalizeBackdrop(buffer, options = {}) {
  const opts = { ...DEFAULTS, ...options };
  const { data, info } = await sharp(buffer)
    .rotate()
    .resize({ width: opts.width, withoutEnlargement: true })
    .webp({
      ...BACKDROP_WEBP,
      ...(opts.quality ? { quality: opts.quality } : {}),
    })
    .toBuffer({ resolveWithObject: true });
  return { buffer: data, width: info.width, height: info.height };
}

const slug = (title) =>
  title
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "file";

const escapeXml = (text) =>
  text.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );

/** A caption cut into lines of at most `width` characters, at most `lines`. */
function wrap(text, width, lines) {
  const out = [];
  let rest = text;
  while (rest.length && out.length < lines) {
    if (rest.length <= width) {
      out.push(rest);
      rest = "";
      break;
    }
    let cut = rest.lastIndexOf(" ", width);
    if (cut < width / 2) cut = width;
    out.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest.length) out[out.length - 1] = `${out.at(-1).slice(0, width - 1)}…`;
  return out;
}

/**
 * Pages of `columns` × `rows` 16:9 thumbnails (letterboxed, so the real aspect
 * shows), each captioned with its number, source file name and original size.
 * Returns the pages' paths.
 */
export async function backdropSheets(entries, outDir, options = {}) {
  const opts = { ...DEFAULTS, ...options };
  const cellWidth = 384;
  const thumbHeight = 216;
  const captionHeight = 52;
  const gap = 8;
  const perPage = opts.columns * opts.rows;
  mkdirSync(outDir, { recursive: true });
  const pages = [];
  for (let at = 0; at < entries.length; at += perPage) {
    const shown = entries.slice(at, at + perPage);
    const rows = Math.ceil(shown.length / opts.columns);
    const width = opts.columns * (cellWidth + gap) + gap;
    const height = rows * (thumbHeight + captionHeight + gap) + gap;
    const layers = [];
    for (const [index, entry] of shown.entries()) {
      const left = gap + (index % opts.columns) * (cellWidth + gap);
      const top =
        gap +
        Math.floor(index / opts.columns) * (thumbHeight + captionHeight + gap);
      layers.push({
        input: await sharp(entry.file)
          .resize(cellWidth, thumbHeight, {
            fit: "contain",
            background: "#222",
          })
          .toBuffer(),
        left,
        top,
      });
      const [first, second] = wrap(entry.title, 50, 2);
      const lines = [
        `#${entry.n} ${first}`,
        second ?? "",
        `${entry.size}`,
      ].filter(Boolean);
      layers.push({
        input: Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="${cellWidth}" height="${captionHeight}">
            <rect width="100%" height="100%" fill="#fff"/>
            ${lines
              .map(
                (line, row) =>
                  `<text x="4" y="${15 + row * 16}" font-family="Helvetica, Arial, sans-serif" font-size="13" fill="${row === lines.length - 1 ? "#555" : "#000"}">${escapeXml(line)}</text>`,
              )
              .join("")}</svg>`,
        ),
        left,
        top: top + thumbHeight,
      });
    }
    const out = path.join(
      outDir,
      `sheet-${String(pages.length + 1).padStart(3, "0")}.jpg`,
    );
    await sharp({
      create: { width, height, channels: 3, background: "#888" },
    })
      .composite(layers)
      .jpeg({ quality: 85 })
      .toFile(out);
    pages.push(out);
  }
  return pages;
}

/**
 * Lists (or reads the cached listing), downloads what the cache lacks,
 * normalises every picture into `<dir>/pictures/`, and writes
 * `<dir>/index.json` and `<dir>/sheets/`. Stops after listing when the category
 * is larger than `maxFiles` or `maxBytes`, unless `force`.
 */
export async function stageBackdrops(wiki, category, dir, options = {}) {
  const opts = { ...DEFAULTS, ...options };
  const started = Date.now();
  const {
    listing,
    dir: cache,
    client,
  } = await listBackdrops(wiki, category, opts);
  const summary = listingSummary(listing);
  const log = opts.log ?? console.log;
  log(
    `${category}: ${summary.files} files, ${(summary.originalBytes / 1e6).toFixed(1)} MB as originals, ${summary.thumbs} to fetch as ${opts.thumbWidth} px renderings`,
  );
  if (
    !opts.force &&
    (summary.files > opts.maxFiles ||
      summary.downloadBytesAtMost > opts.maxBytes)
  )
    throw new Error(
      `${summary.files} files, up to ${(summary.downloadBytesAtMost / 1e9).toFixed(2)} GB: larger than expected; stopping after the listing (pass --force to fetch anyway)`,
    );

  const picturesDir = path.join(dir, "pictures");
  mkdirSync(picturesDir, { recursive: true });
  const indexFile = path.join(dir, "index.json");
  const previous = existsSync(indexFile)
    ? JSON.parse(readFileSync(indexFile, "utf8"))
    : undefined;
  const settings = {
    width: opts.width,
    webp: BACKDROP_WEBP,
    quality: opts.quality,
  };
  const reuse =
    previous && JSON.stringify(previous.settings) === JSON.stringify(settings)
      ? new Map(previous.pictures.map((entry) => [entry.title, entry]))
      : new Map();
  const index = {
    wiki,
    category,
    listed: listing.listed,
    cache,
    settings,
    pictures: [],
    failed: [],
  };
  const used = new Set();
  let fetched = 0;
  let gone = 0;
  for (const [at, entry] of listing.files.entries()) {
    const n = at + 1;
    const source = cachedFile(cache, entry);
    if (!existsSync(source)) {
      let body;
      try {
        body = await client.bytes(entry.download.url);
        gone = 0;
      } catch (error) {
        // A file deleted since the listing is skipped; several in a row, or
        // any other failure, stop the run.
        if ((error.status === 404 || error.status === 410) && ++gone < 5) {
          index.failed.push({ title: entry.title, error: error.message });
          log(`${entry.title}: ${error.message}; skipped`);
          continue;
        }
        throw new Error(
          `${entry.title}: ${error.message}. ${fetched} files fetched this run stay in ${cache}; run again to resume.`,
          { cause: error },
        );
      }
      writeAtomic(source, body);
      fetched++;
      if (fetched % 25 === 0)
        log(`fetched ${fetched} (${n}/${listing.files.length})`);
    }
    let name = `${String(n).padStart(4, "0")}-${slug(entry.title)}`;
    while (used.has(name)) name += "-x";
    used.add(name);
    const out = path.join(picturesDir, `${name}.webp`);
    const before = reuse.get(entry.title);
    let normal;
    if (
      before?.file === out &&
      existsSync(out) &&
      statSync(out).mtimeMs >= statSync(source).mtimeMs
    )
      normal = { width: before.width, height: before.height };
    else {
      try {
        normal = await normalizeBackdrop(readFileSync(source), opts);
      } catch (error) {
        index.failed.push({ title: entry.title, error: error.message });
        log(`${entry.title}: can't be read as a picture: ${error.message}`);
        continue;
      }
      writeAtomic(out, normal.buffer);
    }
    const meta = await sharp(source).metadata();
    index.pictures.push({
      n,
      title: entry.title,
      page: entry.page,
      url: entry.url,
      original: {
        width: entry.width,
        height: entry.height,
        bytes: entry.bytes,
        mime: entry.mime,
      },
      downloaded: {
        kind: entry.download.kind,
        width: entry.download.width,
        bytes: statSync(source).size,
        alpha: Boolean(meta.hasAlpha),
      },
      file: out,
      width: normal.width,
      height: normal.height,
      bytes: statSync(out).size,
    });
  }
  const sheets = await backdropSheets(
    index.pictures.map((entry) => ({
      n: entry.n,
      title: entry.title,
      file: entry.file,
      size: `${entry.original.width}×${entry.original.height} ${entry.downloaded.alpha ? "alpha " : ""}${Math.round(entry.bytes / 1024)} KB`,
    })),
    path.join(dir, "sheets"),
    opts,
  );
  index.sheets = sheets;
  index.run = {
    requests: client.stats.requests,
    retries: client.stats.retries,
    fetched,
    fetchedBytes: client.stats.bytes,
    seconds: Math.round((Date.now() - started) / 1000),
  };
  writeAtomic(indexFile, `${JSON.stringify(index, null, 2)}\n`);
  const bytes = index.pictures.reduce((sum, entry) => sum + entry.bytes, 0);
  log(
    `${index.pictures.length} staged (${(bytes / 1e6).toFixed(1)} MB, ${Math.round(bytes / Math.max(1, index.pictures.length) / 1024)} KB each), ${index.failed.length} unreadable, ${fetched} fetched, ${client.stats.requests} requests, ${sheets.length} sheets`,
  );
  return index;
}

/**
 * Why a picture name can't be in a set, or undefined when it can: a name is
 * `[<state>-]<time>`, the state one of the set's declared ones.
 */
export function nameProblem(name, states, times = TIMES) {
  if (!isName(name)) return `${name} isn't lowercase words joined by -`;
  const [first, ...rest] = name.split("-");
  if (rest.length && Object.hasOwn(states, first)) {
    if (!times.includes(rest.join("-")))
      return `${name}: after the state ${first} comes a time (${times.join(", ")})`;
    return undefined;
  }
  if (!times.includes(name))
    return `${name} is neither a time (${times.join(", ")}) nor <declared state>-<time>`;
  return undefined;
}

/**
 * Every problem with a labels file, `{ sets: [{ set, states?, pictures: [{
 * name, from }] }] }`: names, duplicates, sources the index lacks, and sets
 * with no picture for the default state.
 */
export function labelProblems(labels, titles, times = TIMES) {
  const problems = [];
  const sets = new Set();
  const sources = new Map();
  for (const entry of labels.sets ?? []) {
    const set = entry.set;
    if (!isName(set)) problems.push(`set ${set} isn't a name`);
    if (sets.has(set)) problems.push(`set ${set} is listed twice`);
    sets.add(set);
    const states = entry.states ?? {};
    for (const [state, meaning] of Object.entries(states)) {
      if (!/^[a-z0-9]+$/.test(state))
        problems.push(`${set}: state ${state} isn't one lowercase word`);
      if (times.includes(state))
        problems.push(`${set}: state ${state} is also a time`);
      if (typeof meaning !== "string" || !meaning.trim())
        problems.push(`${set}: state ${state} needs a description`);
    }
    const names = new Set();
    const used = new Set();
    for (const { name, from } of entry.pictures ?? []) {
      const problem = nameProblem(name, states, times);
      if (problem) problems.push(`${set}: ${problem}`);
      if (names.has(name)) problems.push(`${set}: two pictures named ${name}`);
      names.add(name);
      if (!titles.has(from)) problems.push(`${set}/${name}: no staged ${from}`);
      if (sources.has(from))
        problems.push(
          `${set}/${name}: ${from} is already ${sources.get(from)}`,
        );
      sources.set(from, `${set}/${name}`);
      const [first, ...rest] = name.split("-");
      if (rest.length && Object.hasOwn(states, first)) used.add(first);
    }
    if (names.size === 0) problems.push(`${set}: no pictures`);
    else if (![...names].some((name) => times.includes(name)))
      problems.push(`${set}: no picture for the default state (a bare time)`);
    for (const state of Object.keys(states))
      if (!used.has(state))
        problems.push(`${set}: state ${state} has no picture`);
  }
  return problems;
}

/**
 * `<world>/shared/backdrops`, checked to be a real folder (or absent) inside
 * the world, so nothing written under it can land anywhere else.
 */
function libraryOf(world) {
  const shared = path.join(world, "shared");
  if (!existsSync(shared)) throw new Error(`${world} has no shared/ folder`);
  const library = path.join(shared, "backdrops");
  if (existsSync(library)) {
    if (lstatSync(library).isSymbolicLink())
      throw new Error(`${library} is a link; refusing to write through it`);
    const real = realpathSync(library);
    if (real !== path.join(realpathSync(shared), "backdrops"))
      throw new Error(`${library} resolves outside the world`);
  }
  return library;
}

/** `path` when it is strictly inside `dir`, else an error. */
function inside(dir, file) {
  const relative = path.relative(dir, file);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
    throw new Error(`${file} isn't inside ${dir}`);
  return file;
}

/**
 * Writes each labelled set to `<world>/shared/backdrops/<set>/` (replacing that
 * set's folder, leaving other sets alone): `<name>.webp` from the staged
 * picture, and `backdrops.json` when the set declares states. Checks everything
 * first and writes nothing if any label is wrong.
 */
export function placeBackdrops(labelsFile, indexFile, world, options = {}) {
  const times = options.times ?? TIMES;
  const log = options.log ?? console.log;
  const labels = JSON.parse(readFileSync(labelsFile, "utf8"));
  const index = JSON.parse(readFileSync(indexFile, "utf8"));
  const staged = new Map(index.pictures.map((entry) => [entry.title, entry]));
  const problems = labelProblems(labels, new Set(staged.keys()), times);
  for (const entry of labels.sets ?? [])
    for (const { from } of entry.pictures ?? [])
      if (staged.has(from) && !existsSync(staged.get(from).file))
        problems.push(`${from}: staged file ${staged.get(from).file} is gone`);
  if (problems.length)
    throw new Error(`Labels have problems:\n  ${problems.join("\n  ")}`);

  const library = libraryOf(world);
  mkdirSync(library, { recursive: true });
  let pictures = 0;
  let bytes = 0;
  for (const entry of labels.sets) {
    const dir = inside(library, path.join(library, entry.set));
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir);
    for (const { name, from } of entry.pictures) {
      const target = inside(dir, path.join(dir, `${name}.webp`));
      copyFileSync(staged.get(from).file, target);
      pictures++;
      bytes += statSync(target).size;
    }
    if (Object.keys(entry.states ?? {}).length)
      writeAtomic(
        inside(dir, path.join(dir, "backdrops.json")),
        `${JSON.stringify({ states: entry.states }, null, 2)}\n`,
      );
  }
  log(
    `${library}: ${labels.sets.length} sets, ${pictures} pictures, ${(bytes / 1e6).toFixed(1)} MB`,
  );
  return { library, sets: labels.sets.length, pictures, bytes };
}

/** The library's sets that hold at least one picture, as the plugin reads it. */
export function librarySets(world) {
  const library = path.join(world, "shared", "backdrops");
  const sets = new Map();
  if (!existsSync(library)) return sets;
  for (const set of readdirSync(library).sort()) {
    if (!isName(set)) continue;
    const dir = path.join(library, set);
    if (!statSync(dir).isDirectory()) continue;
    const names = readdirSync(dir)
      .filter((file) => RASTER.test(file))
      .map((file) => file.replace(/\.[^.]+$/, ""))
      .filter(isName);
    if (names.length) sets.set(set, { dir, names: [...new Set(names)] });
  }
  return sets;
}

/**
 * The frontmatter of a page's text: where its first line starts, where the
 * closing `---` starts (just past the last line's EOL), and the EOL.
 */
function frontmatter(text) {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  if (!text.startsWith(`---${eol}`)) return undefined;
  const start = 3 + eol.length;
  for (let at = start; ;) {
    const next = text.indexOf(eol, at);
    const line = text.slice(at, next < 0 ? text.length : next);
    if (/^---[ \t]*$/.test(line)) {
      if (eol === "\r\n" && /(^|[^\r])\n/.test(text.slice(0, at)))
        throw new Error("frontmatter mixes line endings");
      return { eol, start, end: at };
    }
    if (next < 0) return undefined;
    at = next + eol.length;
  }
}

/** A top-level `key: value` from frontmatter text, unquoted. */
function topLevel(block, key) {
  const match = new RegExp(`^${key}:[ \\t]*(.*?)[ \\t\\r]*$`, "m").exec(block);
  if (!match) return undefined;
  const value = match[1].replace(/[ \t]+#.*$/, "");
  return value.replace(/^(["'])(.*)\1$/, "$2") || undefined;
}

/**
 * The page with its frontmatter's `backdrop:` line set to `set`: that one line
 * replaced, or added as the frontmatter's last line. Every other byte stays.
 */
export function withBackdrop(text, set) {
  const fm = frontmatter(text);
  if (!fm) throw new Error("no frontmatter");
  const { eol, start, end } = fm;
  const lines = text.slice(start, end).split(eol);
  // `end` sits just past the last line's EOL, so the split ends with "".
  lines.pop();
  const at = lines.findIndex((line) => /^backdrop:/.test(line));
  const line = `backdrop: ${set}`;
  if (at >= 0) {
    if (/^[ \t]/.test(lines[at + 1] ?? "") || /^-/.test(lines[at + 1] ?? ""))
      throw new Error("backdrop has a block value; edit it by hand");
    lines[at] = line;
  } else lines.push(line);
  return `${text.slice(0, start)}${lines.join(eol)}${eol}${text.slice(end)}`;
}

/**
 * `place_id` → page file, for every page in
 * `<world>/shared/wiki/entities/places`.
 */
export function placePages(world) {
  const dir = path.join(world, "shared", "wiki", "entities", "places");
  const pages = new Map();
  const walk = (at) => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const full = path.join(at, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".md")) {
        const text = readFileSync(full, "utf8");
        const fm = frontmatter(text);
        if (!fm) continue;
        const block = text.slice(fm.start, fm.end);
        const id = topLevel(block, "place_id");
        if (id && !pages.has(id))
          pages.set(id, {
            file: full,
            name: topLevel(block, "name"),
            parent: topLevel(block, "parent"),
            backdrop: topLevel(block, "backdrop"),
          });
      }
    }
  };
  if (existsSync(dir)) walk(dir);
  return pages;
}

/**
 * Sets `backdrop:` on each mapped page (`{ places: [{ place, set, why?,
 * uncertain? }] }`). Refuses (writing nothing) a mapping that names a set the
 * library lacks or a place twice; reports a place with no page. A page already
 * saying so isn't touched.
 */
export function assignBackdrops(mappingFile, world, options = {}) {
  const log = options.log ?? console.log;
  const mapping = JSON.parse(readFileSync(mappingFile, "utf8"));
  const sets = librarySets(world);
  const pages = placePages(world);
  const problems = [];
  const seen = new Set();
  for (const { place, set } of mapping.places ?? []) {
    if (seen.has(place)) problems.push(`${place} is mapped twice`);
    seen.add(place);
    if (!isName(set)) problems.push(`${place}: ${set} isn't a set name`);
    else if (!sets.has(set))
      problems.push(`${place}: no set ${set} in shared/backdrops`);
  }
  if (problems.length)
    throw new Error(`Mapping has problems:\n  ${problems.join("\n  ")}`);
  const result = { changed: [], unchanged: [], missing: [] };
  for (const { place, set } of mapping.places) {
    const page = pages.get(place);
    if (!page) {
      result.missing.push(place);
      continue;
    }
    const text = readFileSync(page.file, "utf8");
    const next = withBackdrop(text, set);
    if (next === text) {
      result.unchanged.push(place);
      continue;
    }
    writeAtomic(page.file, next);
    result.changed.push(place);
  }
  for (const place of result.missing) log(`${place}: no such place page`);
  log(
    `${result.changed.length} pages changed, ${result.unchanged.length} already right, ${result.missing.length} missing`,
  );
  return result;
}

/**
 * The library and the place pages as the plugin would read them: every problem,
 * and how many places name a set, inherit one or have none.
 */
export function checkWorld(world, options = {}) {
  const times = options.times ?? TIMES;
  const problems = [];
  const sets = librarySets(world);
  const library = path.join(world, "shared", "backdrops");
  if (existsSync(library))
    for (const entry of readdirSync(library)) {
      const full = path.join(library, entry);
      if (!statSync(full).isDirectory()) {
        problems.push(`backdrops/${entry}: not a set folder`);
        continue;
      }
      if (!isName(entry)) problems.push(`backdrops/${entry}: not a set name`);
      if (!sets.has(entry)) problems.push(`backdrops/${entry}: no picture`);
    }
  let pictures = 0;
  let bytes = 0;
  for (const [set, { dir, names }] of sets) {
    let states = {};
    const manifest = path.join(dir, "backdrops.json");
    if (existsSync(manifest))
      try {
        states = JSON.parse(readFileSync(manifest, "utf8")).states ?? {};
      } catch {
        problems.push(`${set}: backdrops.json isn't JSON`);
      }
    for (const file of readdirSync(dir)) {
      if (file === "backdrops.json") continue;
      if (!RASTER.test(file)) {
        problems.push(`${set}/${file}: not a picture`);
        continue;
      }
      pictures++;
      bytes += statSync(path.join(dir, file)).size;
    }
    for (const name of names) {
      const problem = nameProblem(name, states, times);
      if (problem) problems.push(`${set}: ${problem}`);
    }
    if (!names.some((name) => times.includes(name)))
      problems.push(`${set}: no picture any time of day resolves to`);
  }
  const pages = placePages(world);
  const counts = { direct: 0, inherited: 0, none: 0 };
  const resolved = new Map();
  for (const [id, page] of pages) {
    if (page.backdrop !== undefined && !sets.has(page.backdrop))
      problems.push(`${id}: backdrop ${page.backdrop} isn't a set`);
    let set;
    const seen = new Set();
    for (let at = id; at && !seen.has(at); at = pages.get(at)?.parent) {
      seen.add(at);
      const own = pages.get(at)?.backdrop;
      if (own !== undefined && sets.has(own)) {
        set = own;
        break;
      }
    }
    resolved.set(id, set);
    if (page.backdrop !== undefined && sets.has(page.backdrop)) counts.direct++;
    else if (set) counts.inherited++;
    else counts.none++;
  }
  return {
    sets: sets.size,
    pictures,
    bytes,
    places: pages.size,
    ...counts,
    unused: [...sets.keys()].filter(
      (set) => ![...pages.values()].some((page) => page.backdrop === set),
    ),
    resolved,
    problems,
  };
}

const USAGE = `Usage:
  backdrops.mjs list --wiki <api base> --category <Category:Name> [options]
    List the category (cached; --refresh lists again) and print its size.
  backdrops.mjs stage <dir> --wiki <api base> --category <Category:Name> [options]
    Download what the cache lacks, normalise every picture into
    <dir>/pictures/, write <dir>/index.json and <dir>/sheets/sheet-NNN.jpg.
  backdrops.mjs place <labels.json> <index.json> <world>
    Write the labelled sets into <world>/shared/backdrops/.
  backdrops.mjs assign <places.json> <world>
    Set "backdrop: <set>" on each mapped place page.
  backdrops.mjs check <world>
    Report problems and how many places resolve to a set.
Options:
  --cache <dir>        originals cache (default .cache/art)
  --width <px>         width cap (default ${DEFAULTS.width})
  --quality <q>        WebP quality (default ${BACKDROP_WEBP.quality})
  --delay <ms>         pause between requests (default ${DEFAULTS.delay})
  --thumb-width <px>   width of the wiki's rendering for large originals (default ${DEFAULTS.thumbWidth})
  --times <a,b,c>      the world's times of day (default ${TIMES.join(",")})
  --refresh            list the category again
  --force              stage past the size guard (${DEFAULTS.maxFiles} files, ${DEFAULTS.maxBytes / 1e9} GB)`;

function parseOptions(args) {
  const flags = {
    "--wiki": ["wiki", String],
    "--category": ["category", String],
    "--cache": ["cache", String],
    "--width": ["width", Number],
    "--quality": ["quality", Number],
    "--delay": ["delay", Number],
    "--thumb-width": ["thumbWidth", Number],
    "--times": ["times", (value) => value.split(",")],
  };
  const switches = { "--refresh": "refresh", "--force": "force" };
  const options = {};
  const positional = [];
  for (let at = 0; at < args.length; at++) {
    if (switches[args[at]]) {
      options[switches[args[at]]] = true;
      continue;
    }
    const flag = flags[args[at]];
    if (!flag) {
      positional.push(args[at]);
      continue;
    }
    if (args[at + 1] === undefined)
      throw new Error(`${args[at]} needs a value`);
    const value = flag[1](args[++at]);
    if (Number.isNaN(value)) throw new Error(`${args[at - 1]} needs a number`);
    options[flag[0]] = value;
  }
  return { positional, options };
}

async function main(argv) {
  const [command, ...rest] = argv;
  const { positional, options } = parseOptions(rest);
  const source = () => {
    if (!options.wiki || !options.category)
      throw new Error("--wiki and --category are needed");
    return [options.wiki, options.category];
  };
  if (command === "list" && positional.length === 0) {
    const { listing, client, cached } = await listBackdrops(
      ...source(),
      options,
    );
    console.log(
      JSON.stringify(
        { ...listingSummary(listing), cached, requests: client.stats.requests },
        null,
        2,
      ),
    );
  } else if (command === "stage" && positional.length === 1)
    await stageBackdrops(...source(), positional[0], options);
  else if (command === "place" && positional.length === 3)
    placeBackdrops(...positional, options);
  else if (command === "assign" && positional.length === 2)
    assignBackdrops(...positional, options);
  else if (command === "check" && positional.length === 1) {
    const { resolved: _resolved, ...report } = checkWorld(
      positional[0],
      options,
    );
    console.log(JSON.stringify(report, null, 2));
    if (report.problems.length) process.exitCode = 1;
  } else {
    console.error(USAGE);
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
