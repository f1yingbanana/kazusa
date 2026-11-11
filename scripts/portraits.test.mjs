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
  alignBox,
  assignNames,
  cacheKey,
  placePortraits,
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
  // A near copy of `happy` that no one could tell apart by pixels.
  const glad = path.join(root, "glad.webp");
  await sharp(from("happy"))
    .composite([
      {
        input: {
          create: { width: 2, height: 2, channels: 4, background: "#888" },
        },
        left: 10,
        top: 10,
      },
    ])
    .webp({ quality: 82 })
    .toFile(glad);
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

  it("keeps the originals in the cache, by plan id and set", () => {
    expect(cacheKey(read(plan))).toBe("placeholder");
    expect(
      readdirSync(path.join(cache, "placeholder", "casual")).sort(),
    ).toEqual(MOODS.map(file).sort());
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
    // `happy` and its near copy `glad` are equally close.
    expect(byMood.happy).toMatchObject({ status: "ambiguous", name: null });
    expect([byMood.happy.nearest, byMood.happy.runnerUp].sort()).toEqual([
      "glad",
      "happy",
    ]);
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
    // Without a plan id the cache is named after the wiki's host.
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
    expect(readdirSync(path.join(dir, "cache", "failing", "broken"))).toEqual([
      file("neutral"),
    ]);
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

describe("assignNames", () => {
  const names = ["a", "b", "c"];
  it("matches the clear nearest, within the threshold", () => {
    expect(assignNames([[2, 30, 40]], names)[0]).toMatchObject({
      status: "matched",
      match: "a",
      runnerUp: "b",
      runnerUpDistance: 30,
    });
  });
  it("leaves a picture unmatched when even the nearest is far", () => {
    expect(assignNames([[40, 50, 60]], names)[0].status).toBe("unmatched");
  });
  it("calls it ambiguous when the runner-up is close", () => {
    expect(assignNames([[4, 7, 40]], names)[0].status).toBe("ambiguous");
    expect(assignNames([[1, 5, 40]], names)[0].status).toBe("ambiguous");
  });
  it("gives a name to at most one picture", () => {
    const results = assignNames(
      [
        [2, 30, 40],
        [3, 30, 40],
        [30, 2, 40],
      ],
      names,
    );
    expect(results.map((result) => [result.status, result.match])).toEqual([
      ["conflict", null],
      ["conflict", null],
      ["matched", "b"],
    ]);
  });
});
