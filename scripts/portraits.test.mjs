import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  DEFAULTS,
  alignBox,
  cacheKey,
  matchPictures,
  outfitOf,
  outfitOfSet,
  searchBox,
  placePortraits,
  politeGet,
  stagePortraits,
  signature,
} from "./portraits.mjs";
import { faceBox, place, stage, stickerOf } from "./stickers.mjs";
import { drawCharacter, startFakeWiki } from "./testing/fake-wiki.mjs";

const WIDTH = 1500;
const HEIGHT = 2400;
const MOODS = ["neutral", "happy", "surprised", "angry", "sad"];
const file = (mood) => `Placeholder ${mood}.png`;
const read = (where) => JSON.parse(readFileSync(where, "utf8"));
const options = (cache) => ({ cache, delay: 0 });

let wiki;
let root;
let head;
let workspace;
let plan;

/** Every file under `dir`, with its bytes, by path relative to `dir`. */
function snapshot(dir) {
  const files = new Map();
  const walk = (at) => {
    for (const name of readdirSync(at)) {
      const full = path.join(at, name);
      if (statSync(full).isDirectory()) walk(full);
      else files.set(path.relative(dir, full), readFileSync(full));
    }
  };
  walk(dir);
  return files;
}

beforeAll(async () => {
  root = mkdtempSync(path.join(tmpdir(), "kazusa-portraits-"));
  const files = new Map();
  for (const mood of MOODS) {
    const drawn = await drawCharacter({
      expression: mood,
      width: WIDTH,
      height: HEIGHT,
    });
    files.set(file(mood), drawn.png);
    head = drawn.head;
  }
  files.set(
    "Placeholder wave.png",
    (await drawCharacter({ wave: true, width: WIDTH, height: HEIGHT })).png,
  );
  wiki = await startFakeWiki(files, { failures: { "Broken.png": 404 } });
  files.set("Broken.png", files.get(file("neutral")));

  // The stickers as the existing pipeline made them: staged, then labelled.
  plan = path.join(root, "plan.json");
  writeFileSync(
    plan,
    JSON.stringify({
      id: "placeholder",
      wiki: wiki.url,
      crop: "face",
      sets: [{ id: "casual", files: MOODS.map(file) }],
    }),
  );
  await stage(plan, path.join(root, "old"));
  const staged = read(path.join(root, "old", "stage.json")).sets[0].stickers;
  const from = (mood) => staged[MOODS.indexOf(mood)].file;
  // `happy` again under another name, as when one picture was labelled twice:
  // no one could tell the two apart.
  const glad = path.join(root, "glad.webp");
  await sharp(from("happy")).webp({ lossless: true }).toFile(glad);
  workspace = path.join(root, "workspaces", "someone");
  writeFileSync(
    path.join(root, "labels.json"),
    JSON.stringify({
      workspace,
      stickers: [
        { from: from("neutral"), name: "neutral" },
        { from: from("happy"), name: "happy" },
        { from: glad, name: "glad" },
        { from: from("surprised"), name: "surprised" },
        { from: from("angry"), name: "angry" },
        // No sticker for `sad`.
      ],
    }),
  );
  place(path.join(root, "labels.json"));
}, 60_000);
afterAll(() => wiki.close());

describe("portraits stage", () => {
  let report;
  let cache;
  let firstRunRequests;

  beforeAll(async () => {
    cache = path.join(root, "cache");
    const before = wiki.requests.length;
    report = await stagePortraits(
      plan,
      workspace,
      path.join(root, "staged"),
      options(cache),
    );
    firstRunRequests = wiki.requests.slice(before);
  }, 60_000);

  it("keeps the originals in the cache, one folder per wiki", () => {
    const host = new URL(wiki.url).host.replace(":", "_");
    expect(cacheKey(read(plan))).toBe(host);
    expect(readdirSync(path.join(cache, host)).sort()).toEqual(
      MOODS.map(file).sort(),
    );
    // Originals, not thumbnails, asked for as the original format.
    const downloads = firstRunRequests.filter((url) => !url.startsWith("/api"));
    expect(downloads).toHaveLength(MOODS.length);
    for (const url of downloads) {
      expect(url).toMatch(/^\/images\//);
      expect(url).toContain("format=original");
    }
  });

  it("recovers each picture's sticker name, and guesses none", () => {
    const set = report.sets[0];
    const byMood = Object.fromEntries(
      set.portraits.map((entry) => [MOODS[entry.n - 1], entry]),
    );
    for (const mood of ["neutral", "surprised", "angry"]) {
      expect(byMood[mood]).toMatchObject({
        status: "matched",
        match: mood,
        name: mood,
      });
      expect(byMood[mood].distance).toBeLessThan(report.match.maxDistance / 2);
    }
    // `happy` and its copy `glad` are twins: one look with two names.
    expect(byMood.happy).toMatchObject({
      status: "matched",
      name: "happy",
      also: ["glad"],
    });
    // No sticker was ever made of `sad`.
    expect(byMood.sad).toMatchObject({ status: "unmatched", name: null });
    expect(byMood.sad.distance).toBeGreaterThan(report.match.maxDistance);
    for (const sheet of ["matched.png", "unmatched.png"])
      expect(existsSync(path.join(root, "staged", "casual", sheet))).toBe(true);
  });

  it("puts the eyeline inside the head", () => {
    const [set] = report.sets;
    const [left, top, width, height] = set.trim;
    expect(set.size[1]).toBe(1600);
    expect(set.size[0]).toBe(Math.round((width * 1600) / height));
    expect(left).toBeGreaterThan(0);
    const eyes = top + set.eyeline * height;
    expect(eyes).toBeGreaterThan(head.top);
    expect(eyes).toBeLessThan(head.bottom);
    // The face box from the existing pipeline is reported, in source pixels.
    expect(set.faceBox[0]).toBeLessThanOrEqual(head.left);
    expect(set.faceBox[2]).toBeGreaterThan(head.right - head.left);
    expect(set.stickerBox).toHaveLength(3);
  });

  it("writes every portrait at the set's size as WebP", async () => {
    const [set] = report.sets;
    for (const entry of set.portraits) {
      const meta = await sharp(entry.file).metadata();
      expect([meta.format, meta.width, meta.height, meta.hasAlpha]).toEqual([
        "webp",
        ...set.size,
        true,
      ]);
    }
  });

  it(
    "reads the cache on a second run and fetches nothing",
    { timeout: 60_000 },
    async () => {
      const before = wiki.requests.length;
      const again = await stagePortraits(
        plan,
        workspace,
        path.join(root, "staged-again"),
        options(cache),
      );
      expect(wiki.requests.length - before).toBe(0);
      expect(again.sets[0].portraits.map((entry) => entry.status)).toEqual(
        report.sets[0].portraits.map((entry) => entry.status),
      );
    },
  );

  it("places named pictures under portraits/ only", async () => {
    const before = snapshot(workspace);
    // A name filled in by hand for an unmatched picture.
    const labels = read(path.join(root, "staged", "stage.json"));
    labels.sets[0].portraits[MOODS.indexOf("sad")].name = "sad";
    const labelsFile = path.join(root, "staged", "labelled.json");
    writeFileSync(labelsFile, JSON.stringify(labels));
    placePortraits(labelsFile);
    const after = snapshot(workspace);
    for (const [name, bytes] of before)
      expect(after.get(name)?.equals(bytes), name).toBe(true);
    const added = [...after.keys()].filter((name) => !before.has(name)).sort();
    expect(added).toEqual(
      [
        "angry.webp",
        "glad.webp",
        "happy.webp",
        "neutral.webp",
        "portraits.json",
        "sad.webp",
        "surprised.webp",
      ].map((name) => path.join("portraits", name)),
    );
    const manifest = read(path.join(workspace, "portraits", "portraits.json"));
    expect(Object.keys(manifest).sort()).toEqual(["eyeline", "size"]);
    expect(manifest.size).toEqual(labels.sets[0].size);
    expect(manifest.size.every(Number.isInteger)).toBe(true);
    expect(manifest.eyeline).toBeGreaterThan(0);
    expect(manifest.eyeline).toBeLessThan(1);
    const meta = await sharp(
      path.join(workspace, "portraits", "neutral.webp"),
    ).metadata();
    expect([meta.width, meta.height]).toEqual(manifest.size);
  });
});

describe("portraits stage, alignment and failures", () => {
  it("trims a set by the union of its pictures, so they stay aligned", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "kazusa-portraits-union-"));
    const unionPlan = path.join(dir, "plan.json");
    writeFileSync(
      unionPlan,
      JSON.stringify({
        wiki: wiki.url,
        sets: [
          { id: "wave", files: [file("neutral"), "Placeholder wave.png"] },
        ],
      }),
    );
    const empty = path.join(dir, "workspace");
    mkdirSync(empty);
    const report = await stagePortraits(
      unionPlan,
      empty,
      path.join(dir, "out"),
      {
        ...options(path.join(dir, "cache")),
        maxHeight: 10_000,
      },
    );
    expect(readdirSync(path.join(dir, "cache"))).toEqual([
      new URL(wiki.url).host.replace(":", "_"),
    ]);
    const [plain, waving] = report.sets[0].portraits;
    // Where the dark legs are, in each output.
    const legs = async (where) => {
      const { data, info } = await sharp(where)
        .raw()
        .toBuffer({ resolveWithObject: true });
      let box = [Infinity, Infinity, -1, -1];
      for (let y = 0; y < info.height; y++)
        for (let x = 0; x < info.width; x++) {
          const at = (y * info.width + x) * info.channels;
          const dark =
            data[at + 3] > 200 &&
            Math.abs(data[at] - 0x2a) < 6 &&
            Math.abs(data[at + 1] - 0x2a) < 6 &&
            Math.abs(data[at + 2] - 0x2a) < 6;
          if (dark)
            box = [
              Math.min(box[0], x),
              Math.min(box[1], y),
              Math.max(box[2], x),
              Math.max(box[3], y),
            ];
        }
      return { size: [info.width, info.height], box };
    };
    const a = await legs(plain.file);
    const b = await legs(waving.file);
    expect(a.size).toEqual(b.size);
    expect(a.box).toEqual(b.box);
    // The raised hand widened the box: the plain picture has a margin on its left.
    expect(a.box[0]).toBeGreaterThan(100);
    expect(report.sets[0].trim[0]).toBeLessThan(head.left - 300);
  }, 60_000);

  it("stops with a clear error on an HTTP failure, without retrying", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "kazusa-portraits-fail-"));
    const failPlan = path.join(dir, "plan.json");
    writeFileSync(
      failPlan,
      JSON.stringify({
        id: "failing",
        wiki: wiki.url,
        sets: [{ id: "broken", files: [file("neutral"), "Broken.png"] }],
      }),
    );
    const empty = path.join(dir, "workspace");
    mkdirSync(empty);
    await expect(
      stagePortraits(
        failPlan,
        empty,
        path.join(dir, "out"),
        options(path.join(dir, "cache")),
      ),
    ).rejects.toThrow(/broken: Broken\.png: HTTP 404 .*run again to resume/);
    expect(
      wiki.requests.filter((url) => url.startsWith("/images/Broken.png")),
    ).toHaveLength(1);
    // What was fetched before the failure stays cached.
    expect(
      readdirSync(
        path.join(dir, "cache", new URL(wiki.url).host.replace(":", "_")),
      ),
    ).toEqual([file("neutral")]);
  });
});

describe("politeGet", () => {
  it("sends a generic User-Agent, or the one given", async () => {
    const agents = [];
    const fetchImpl = async (_url, init) => {
      agents.push(init.headers["User-Agent"]);
      return new Response("ok");
    };
    await politeGet("http://example.test/a", fetchImpl);
    await politeGet("http://example.test/b", fetchImpl, "other/2.0");
    expect(agents).toEqual(["art-importer/1.0", "other/2.0"]);
  });

  it("gives up on a request that stalls", async () => {
    const fetchImpl = (_url, init) =>
      new Promise((_resolve, reject) =>
        init.signal.addEventListener("abort", () => reject(init.signal.reason)),
      );
    await expect(
      politeGet("http://example.test/a", fetchImpl, undefined, 50),
    ).rejects.toThrow(/Couldn't fetch .*/);
  });

  it("waits out a 429's Retry-After once, then gives up", async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls++;
      return new Response("busy", {
        status: 429,
        headers: { "Retry-After": "0" },
      });
    };
    await expect(politeGet("http://example.test/a", fetchImpl)).rejects.toThrow(
      /HTTP 429/,
    );
    expect(calls).toBe(2);
  });
});

describe("alignBox", () => {
  it("finds the box the stickers were cut with, a few pixels off", async () => {
    const sources = [];
    for (const mood of ["neutral", "happy", "surprised"])
      sources.push((await drawCharacter({ expression: mood })).png);
    const found = await faceBox(sources);
    // As if the old run's thumbnails, or an explicit box, put it elsewhere.
    const truth = [found[0] + 9, found[1] - 6, found[2] + 14];
    const targets = [];
    for (const source of sources.slice(0, 2))
      targets.push(await signature(await stickerOf(source, truth)));
    expect(await alignBox(sources, found, targets)).toEqual(truth);
  });
});

describe("searchBox", () => {
  it("finds a box far from the one the differences give", async () => {
    const sources = [];
    for (const mood of ["neutral", "happy", "surprised"])
      sources.push((await drawCharacter({ expression: mood })).png);
    const found = await faceBox(sources);
    // As if the stickers were cut wider and lower, past alignBox's reach.
    const truth = [
      found[0] - Math.round(found[2] * 0.2),
      found[1] - Math.round(found[2] * 0.05),
      Math.round(found[2] * 1.35),
    ];
    const targets = [];
    for (const source of sources)
      targets.push(await signature(await stickerOf(source, truth)));
    const searched = await searchBox(sources, found, targets);
    const refined = await alignBox(sources, searched, targets);
    for (const [index, value] of refined.entries())
      expect(Math.abs(value - truth[index])).toBeLessThanOrEqual(2);
  });
});

describe("matchPictures", () => {
  const SIDE = 128;
  /** A grey fine signature with squares (`[x, y, size, value]`) drawn on. */
  const face = (...marks) => {
    const out = new Float32Array(SIDE * SIDE * 4).fill(128);
    for (let at = 3; at < out.length; at += 4) out[at] = 255;
    for (const [x0, y0, size, value] of marks)
      for (let y = y0; y < y0 + size; y++)
        for (let x = x0; x < x0 + size; x++)
          for (let c = 0; c < 3; c++) out[(y * SIDE + x) * 4 + c] = value;
    return out;
  };
  /** Every pixel moved by `by`: the common error of another source. */
  const shifted = (signature, by) =>
    signature.map((value, at) => (at % 4 === 3 ? value : value + by));
  const eyes = (value) => [
    [40, 50, 10, value],
    [80, 50, 10, value],
  ];
  const stickers = [
    face(...eyes(0)),
    face(...eyes(255)),
    face(...eyes(0), [60, 90, 12, 0]),
  ];
  const names = ["calm", "wide", "talking"];

  it("names each picture through a common offset, by where looks differ", () => {
    // 10 on every channel: past maxDistance, but common to the whole set.
    const pictures = stickers.map((sticker) => shifted(sticker, 10));
    const { results, offset } = matchPictures(pictures, stickers, names);
    expect(results.map((result) => [result.status, result.match])).toEqual([
      ["matched", "calm"],
      ["matched", "wide"],
      ["matched", "talking"],
    ]);
    expect(offset).toBeCloseTo(7.5, 1);
  });

  it("takes off no difference as large as another outfit's", () => {
    const pictures = stickers.map((sticker) => shifted(sticker, 40));
    const { results } = matchPictures(pictures, stickers, names);
    expect(results.map((result) => result.status)).toEqual([
      "unmatched",
      "unmatched",
      "unmatched",
    ]);
  });

  it("leaves a picture unmatched when even the nearest is far", () => {
    // A second picture, as in any real set: where the set's pictures spread
    // is face too.
    const {
      results: [result],
    } = matchPictures(
      [face(...eyes(0), [20, 20, 30, 0]), stickers[1]],
      stickers,
      names,
    );
    expect(result).toMatchObject({ status: "unmatched", match: null });
  });

  it("calls a picture between two looks ambiguous", () => {
    const {
      results: [result],
    } = matchPictures([face(...eyes(0), [60, 90, 12, 64])], stickers, names, {
      ...DEFAULTS,
      maxDistance: 50,
      maxWorst: 255,
    });
    expect(result).toMatchObject({ status: "ambiguous", match: null });
    expect([result.nearest, result.rival].sort()).toEqual(["calm", "talking"]);
  });

  it("gives a look every name its twin stickers have", () => {
    const twins = [stickers[0], face(...eyes(0), [5, 5, 2, 0]), stickers[1]];
    const {
      results: [result],
    } = matchPictures([stickers[0]], twins, ["a", "b", "c"]);
    expect(result).toMatchObject({ status: "matched", match: "a" });
    expect(result.also).toEqual(["b"]);
    // Two copies of that look, one nearer each twin, still make one claim.
    const both = matchPictures(
      [shifted(stickers[0], 1), shifted(twins[1], 2)],
      twins,
      ["a", "b", "c"],
    ).results;
    expect(both.filter((one) => one.match)).toHaveLength(1);
  });

  it("gives a twin's name to one picture only, when twins chain", () => {
    // a like b, b like c, a unlike c: the looks a and c both bring b along.
    const chain = [
      face(...eyes(0)),
      face(...eyes(0), [70, 20, 3, 60]),
      face(...eyes(0), [70, 20, 3, 60], [75, 20, 3, 60]),
      stickers[1],
    ];
    const twinNames = ["a", "b", "c", "d"];
    const { results } = matchPictures(
      [chain[0], chain[2], stickers[1]],
      chain,
      twinNames,
    );
    const placed = results.flatMap((one) =>
      one.match ? [one.match, ...(one.also ?? [])] : [],
    );
    expect(new Set(placed).size).toBe(placed.length);
    expect(results[0]).toMatchObject({ match: "a" });
    expect(results[1]).toMatchObject({ match: "c" });
    expect(placed).not.toContain("b");
  });

  it("settles two pictures taking one name by the sticker, else by none", () => {
    const twice = matchPictures(
      [shifted(stickers[1], 2), shifted(stickers[1], 1)],
      stickers,
      names,
    ).results;
    expect(twice.map((result) => [result.status, result.match])).toEqual([
      ["duplicate", null],
      ["matched", "wide"],
    ]);
    expect(twice[0].lostTo).toBe(2);
    const loose = { ...DEFAULTS, maxDistance: 50, maxWorst: 255 };
    const nearer = matchPictures(
      [stickers[1], face(...eyes(255), [60, 90, 4, 100])],
      stickers.slice(0, 2),
      names.slice(0, 2),
      loose,
    ).results;
    expect(nearer.map((result) => result.status)).toEqual([
      "matched",
      "outmatched",
    ]);
    // The sticker is halfway between two pictures: no one can say which.
    const clash = matchPictures(
      [
        face(...eyes(255), [20, 90, 8, 60]),
        face(...eyes(255), [100, 90, 8, 60]),
      ],
      stickers.slice(0, 2),
      names.slice(0, 2),
      loose,
    ).results;
    expect(clash.map((result) => result.status)).toEqual([
      "conflict",
      "conflict",
    ]);
  });
});

describe("matchPictures, second look", () => {
  /** Grey, `side` px, with one square drawn on, at the same place at any size. */
  const square = (side, value) => {
    const out = new Float32Array(side * side * 4).fill(128);
    for (let at = 3; at < out.length; at += 4) out[at] = 255;
    const from = Math.round(side * 0.4);
    const to = Math.round(side * 0.5);
    for (let y = from; y < to; y++)
      for (let x = from; x < to; x++)
        for (let c = 0; c < 3; c++) out[(y * side + x) * 4 + c] = value;
    return out;
  };
  it("decides at full size what the blurred look leaves halfway", () => {
    const fine = [square(128, 128), square(128, 160)];
    const full = { stickers: [square(256, 128), square(256, 160)] };
    // Blurred, the picture is about halfway; at full size it is `marked`.
    const pictures = [square(128, 146)];
    const names = ["plain", "marked"];
    const rule = { ...DEFAULTS, maxDistance: 50, maxWorst: 255 };
    expect(matchPictures(pictures, fine, names, rule).results[0].status).toBe(
      "ambiguous",
    );
    const [result] = matchPictures(pictures, fine, names, rule, {
      ...full,
      pictures: [square(256, 160)],
    }).results;
    expect(result).toMatchObject({
      status: "matched",
      match: "marked",
      secondLook: true,
    });
  });
});

describe("outfits", () => {
  const outfits = ["gym", "swimsuit"];
  it("reads a sticker's outfit from a declared first word only", () => {
    expect(outfitOf("gym-happy", outfits)).toBe("gym");
    expect(outfitOf("happy", outfits)).toBe("");
    expect(outfitOf("very-happy", outfits)).toBe("");
  });
  it("takes a set's outfit from the plan, else its id", () => {
    expect(outfitOfSet({ id: "gym" }, outfits)).toBe("gym");
    expect(outfitOfSet({ id: "battle-2", outfit: "gym" }, outfits)).toBe("gym");
    expect(outfitOfSet({ id: "school" }, outfits)).toBe("");
    expect(() => outfitOfSet({ id: "x", outfit: "mask" }, outfits)).toThrow(
      /no outfit mask/,
    );
  });
});
