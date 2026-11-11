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
  assignBackdrops,
  checkWorld,
  listBackdrops,
  nameProblem,
  placeBackdrops,
  stageBackdrops,
  withBackdrop,
} from "./backdrops.mjs";
import { startFakeWiki } from "./testing/fake-wiki.mjs";

const CATEGORY = "Category:Background images";
const COUNT = 23;
const title = (n) => `BG Place ${String(n).padStart(2, "0")}.png`;
const quiet = () => {};

let wiki;
let root;
let cache;
let stageDir;
let index;

/** A painted-looking scene, different for each `n`. */
const scene = (n, width, height) =>
  sharp(
    Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="hsl(${n * 15}, 60%, 70%)"/>
        <stop offset="1" stop-color="hsl(${n * 15 + 40}, 50%, 30%)"/>
      </linearGradient></defs>
      <rect width="100%" height="100%" fill="url(#g)"/>
      <circle cx="${width * 0.3}" cy="${height * 0.6}" r="${height / 5}" fill="#fff8"/>
      <rect x="${width * 0.55}" y="${height * 0.3}" width="${width / 4}" height="${height / 2}" fill="hsl(${n * 30}, 40%, 45%)"/>
    </svg>`),
  )
    .png()
    .toBuffer();

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

/** A world with a few place pages, one with CRLF and quoted values. */
function makeWorld() {
  const world = mkdtempSync(path.join(root, "world-"));
  const places = path.join(world, "shared", "wiki", "entities", "places");
  mkdirSync(places, { recursive: true });
  writeFileSync(
    path.join(places, "school.md"),
    "---\nplace_id: school\nname: Example School\nsummary: >-\n  A school, open 07:00-19:00.\nconnections:\n  - to: station\n    ways:\n      - by: walk\n        minutes: 5\n---\n\nThe school.\n",
  );
  writeFileSync(
    path.join(places, "classroom.md"),
    '---\r\nplace_id: "classroom"\r\nname: \'Classroom 1-A\'\r\nparent: school\r\nsummary: "Desks: thirty"\r\nbackdrop: old-set\r\nentry_minutes: 1\r\n---\r\n\r\nDesks.\r\n',
  );
  writeFileSync(
    path.join(places, "hall.md"),
    "---\nplace_id: hall\nname: Hall\nparent: school\nsummary: A hall.\n---\nA hall.\n",
  );
  writeFileSync(
    path.join(places, "station.md"),
    "---\nplace_id: station\nname: Station\nsummary: A station.\n---\n",
  );
  writeFileSync(path.join(world, "shared", "wiki", "INDEX.md"), "# Index\n");
  return world;
}

function labelsFile(dir, sets) {
  const file = path.join(dir, `labels-${Math.random()}.json`);
  writeFileSync(file, JSON.stringify({ sets }));
  return file;
}

const SETS = [
  {
    set: "school-classroom",
    states: { festival: "Decorated for the school festival" },
    pictures: [
      { name: "day", from: title(1) },
      { name: "dusk", from: title(2) },
      { name: "night", from: title(3) },
      { name: "festival-day", from: title(4) },
    ],
  },
  { set: "station", pictures: [{ name: "day", from: title(5) }] },
];

beforeAll(async () => {
  root = mkdtempSync(path.join(tmpdir(), "kazusa-backdrops-"));
  cache = path.join(root, "cache");
  stageDir = path.join(root, "stage");
  const files = new Map();
  const names = [];
  for (let n = 1; n <= COUNT; n++) {
    // One small picture, one too wide to fetch whole, the rest 2400 wide.
    const [width, height] =
      n === 7 ? [800, 450] : n === 8 ? [3600, 1800] : [2400, 1350];
    files.set(title(n), await scene(n, width, height));
    names.push(title(n));
  }
  wiki = await startFakeWiki(files, {
    categories: { [CATEGORY]: names },
    fandom: false,
    pageSize: 10,
  });
});

afterAll(async () => {
  await wiki?.close();
});

const options = () => ({
  cache,
  delay: 0,
  log: quiet,
  maxOriginalWidth: 3000,
});

describe("list", () => {
  it("follows cmcontinue to the end, then batches imageinfo", async () => {
    const before = wiki.requests.length;
    const { listing, cached } = await listBackdrops(
      wiki.url,
      CATEGORY,
      options(),
    );
    expect(cached).toBe(false);
    expect(listing.files.map((file) => file.title)).toEqual(
      Array.from({ length: COUNT }, (_, at) => title(at + 1)),
    );
    const sent = wiki.requests.slice(before);
    const lists = sent.filter((url) => url.includes("categorymembers"));
    expect(lists).toHaveLength(3);
    expect(lists[1]).toContain("cmcontinue=file%7C10");
    expect(lists[2]).toContain("cmcontinue=file%7C20");
    expect(sent.filter((url) => url.includes("imageinfo"))).toHaveLength(1);
    // Wider than 3000 px: fetched as the wiki's 2560 px rendering.
    expect(listing.files[7].download).toMatchObject({
      kind: "thumb",
      width: 2560,
    });
    expect(listing.files[0].download.kind).toBe("original");
  });
});

describe("stage", () => {
  beforeAll(async () => {
    index = await stageBackdrops(wiki.url, CATEGORY, stageDir, options());
  });

  it("caps the width at 1920, keeps the aspect, never enlarges", async () => {
    expect(index.pictures).toHaveLength(COUNT);
    for (const entry of index.pictures) {
      const meta = await sharp(entry.file).metadata();
      expect(meta.format).toBe("webp");
      expect([meta.width, meta.height]).toEqual([entry.width, entry.height]);
      expect(entry.bytes).toBe(statSync(entry.file).size);
      const aspect = entry.original.width / entry.original.height;
      expect(Math.abs(meta.width / meta.height - aspect)).toBeLessThan(0.01);
    }
    expect(index.pictures[0]).toMatchObject({ width: 1920, height: 1080 });
    expect(index.pictures[6]).toMatchObject({ width: 800, height: 450 });
    expect(index.pictures[7]).toMatchObject({ width: 1920, height: 960 });
    expect(index.pictures[7].downloaded.kind).toBe("thumb");
    expect(wiki.requests.some((url) => url.startsWith("/thumb/2560/"))).toBe(
      true,
    );
  });

  it("writes the index and labelled contact sheets", () => {
    const written = JSON.parse(
      readFileSync(path.join(stageDir, "index.json"), "utf8"),
    );
    expect(written.pictures[0]).toMatchObject({
      n: 1,
      title: title(1),
      original: { width: 2400, height: 1350 },
    });
    expect(written.sheets).toHaveLength(2);
    for (const sheet of written.sheets) expect(existsSync(sheet)).toBe(true);
  });

  it("sends no request at all when everything is cached", async () => {
    const before = wiki.requests.length;
    const again = await stageBackdrops(wiki.url, CATEGORY, stageDir, options());
    expect(wiki.requests.length).toBe(before);
    expect(again.run).toMatchObject({ requests: 0, fetched: 0 });
    expect(again.pictures.map((entry) => entry.file)).toEqual(
      index.pictures.map((entry) => entry.file),
    );
  });
});

describe("names", () => {
  it("are a time, or a declared state and a time", () => {
    const states = { festival: "Decorated" };
    expect(nameProblem("day", states)).toBeUndefined();
    expect(nameProblem("festival-night", states)).toBeUndefined();
    expect(nameProblem("rain-day", states)).toMatch(/neither a time/);
    expect(nameProblem("festival", states)).toMatch(/neither a time/);
    expect(nameProblem("festival-noon", states)).toMatch(/comes a time/);
    expect(nameProblem("Day", states)).toMatch(/lowercase/);
    expect(nameProblem("evening", {}, ["morning", "evening"])).toBeUndefined();
  });
});

describe("place", () => {
  it("writes the sets, and only under shared/backdrops", () => {
    const world = makeWorld();
    const before = snapshot(world);
    placeBackdrops(
      labelsFile(root, SETS),
      path.join(stageDir, "index.json"),
      world,
      { log: quiet },
    );
    const after = snapshot(world);
    const added = [...after.keys()].filter((file) => !before.has(file));
    for (const [file, bytes] of before) expect(after.get(file)).toEqual(bytes);
    expect(added.sort()).toEqual(
      [
        "shared/backdrops/school-classroom/backdrops.json",
        "shared/backdrops/school-classroom/day.webp",
        "shared/backdrops/school-classroom/dusk.webp",
        "shared/backdrops/school-classroom/festival-day.webp",
        "shared/backdrops/school-classroom/night.webp",
        "shared/backdrops/station/day.webp",
      ].map((file) => file.split("/").join(path.sep)),
    );
    expect(
      JSON.parse(
        after
          .get(path.join("shared/backdrops/school-classroom/backdrops.json"))
          .toString(),
      ),
    ).toEqual({ states: { festival: "Decorated for the school festival" } });
    // The fixture's classroom names a set that isn't in the library.
    expect(checkWorld(world).problems).toEqual([
      "classroom: backdrop old-set isn't a set",
    ]);
  });

  it("prunes set folders the labels no longer name, and only with --prune", () => {
    const world = makeWorld();
    const index = path.join(stageDir, "index.json");
    placeBackdrops(labelsFile(root, SETS), index, world, { log: quiet });
    const renamed = [{ ...SETS[0], set: "school-classroom-front" }, SETS[1]];
    const library = path.join(world, "shared", "backdrops");
    placeBackdrops(labelsFile(root, renamed), index, world, { log: quiet });
    expect(readdirSync(library).sort()).toEqual([
      "school-classroom",
      "school-classroom-front",
      "station",
    ]);
    writeFileSync(path.join(library, "notes.txt"), "kept");
    const result = placeBackdrops(labelsFile(root, renamed), index, world, {
      log: quiet,
      prune: true,
    });
    expect(result.pruned).toEqual(["school-classroom"]);
    expect(readdirSync(library).sort()).toEqual([
      "notes.txt",
      "school-classroom-front",
      "station",
    ]);
  });

  it.each([
    [
      "a bad set name",
      [{ set: "../out", pictures: [{ name: "day", from: title(1) }] }],
      /isn't a name/,
    ],
    [
      "a duplicate name",
      [
        {
          set: "a",
          pictures: [
            { name: "day", from: title(1) },
            { name: "day", from: title(2) },
          ],
        },
      ],
      /two pictures named day/,
    ],
    [
      "a source used twice",
      [
        { set: "a", pictures: [{ name: "day", from: title(1) }] },
        { set: "b", pictures: [{ name: "day", from: title(1) }] },
      ],
      /already a\/day/,
    ],
    [
      "an undeclared state",
      [
        {
          set: "a",
          pictures: [
            { name: "day", from: title(1) },
            { name: "rain-day", from: title(2) },
          ],
        },
      ],
      /rain-day is neither/,
    ],
    [
      "only state pictures",
      [
        {
          set: "a",
          states: { rain: "Raining" },
          pictures: [{ name: "rain-day", from: title(1) }],
        },
      ],
      /no picture for the default state/,
    ],
    [
      "an unstaged source",
      [{ set: "a", pictures: [{ name: "day", from: "Nope.png" }] }],
      /no staged/,
    ],
  ])("refuses %s and writes nothing", (_, sets, problem) => {
    const world = makeWorld();
    const before = snapshot(world);
    expect(() =>
      placeBackdrops(
        labelsFile(root, sets),
        path.join(stageDir, "index.json"),
        world,
        { log: quiet },
      ),
    ).toThrow(problem);
    expect(snapshot(world)).toEqual(before);
  });
});

describe("assign", () => {
  let world;
  let places;
  beforeAll(() => {
    world = makeWorld();
    places = path.join(world, "shared", "wiki", "entities", "places");
    placeBackdrops(
      labelsFile(root, SETS),
      path.join(stageDir, "index.json"),
      world,
      { log: quiet },
    );
  });
  const mapping = (entries) => {
    const file = path.join(root, `places-${Math.random()}.json`);
    writeFileSync(file, JSON.stringify({ places: entries }));
    return file;
  };

  it("changes only the backdrop line, and is idempotent", () => {
    const before = snapshot(world);
    const result = assignBackdrops(
      mapping([
        { place: "school", set: "school-classroom", why: "the school" },
        { place: "classroom", set: "school-classroom", why: "a classroom" },
        { place: "nowhere", set: "station", why: "missing" },
      ]),
      world,
      { log: quiet },
    );
    expect(result).toEqual({
      changed: ["school", "classroom"],
      unchanged: [],
      missing: ["nowhere"],
    });
    const after = snapshot(world);
    for (const [file, bytes] of before)
      if (!file.endsWith("school.md") && !file.endsWith("classroom.md"))
        expect(after.get(file)).toEqual(bytes);

    // Added as the frontmatter's last line: without it, the same bytes.
    const school = readFileSync(path.join(places, "school.md"), "utf8");
    expect(school).toContain(
      "        minutes: 5\nbackdrop: school-classroom\n---\n",
    );
    expect(school.replace("backdrop: school-classroom\n", "")).toBe(
      before.get(path.join("shared/wiki/entities/places/school.md")).toString(),
    );
    // Replaced in place, CRLF and every other line's quoting kept.
    const classroom = readFileSync(path.join(places, "classroom.md"), "utf8");
    expect(classroom).toBe(
      before
        .get(path.join("shared/wiki/entities/places/classroom.md"))
        .toString()
        .replace("backdrop: old-set\r\n", "backdrop: school-classroom\r\n"),
    );

    const mtime = statSync(path.join(places, "school.md")).mtimeMs;
    const again = assignBackdrops(
      mapping([
        { place: "school", set: "school-classroom" },
        { place: "classroom", set: "school-classroom" },
      ]),
      world,
      { log: quiet },
    );
    expect(again.changed).toEqual([]);
    expect(again.unchanged).toEqual(["school", "classroom"]);
    expect(statSync(path.join(places, "school.md")).mtimeMs).toBe(mtime);

    const report = checkWorld(world);
    expect(report).toMatchObject({ direct: 2, inherited: 1, none: 1 });
    expect(report.resolved.get("hall")).toBe("school-classroom");
    expect(report.problems).toEqual([]);
  });

  it("refuses a set the library doesn't have, writing nothing", () => {
    const before = snapshot(world);
    expect(() =>
      assignBackdrops(
        mapping([
          { place: "hall", set: "station" },
          { place: "station", set: "no-such-set" },
        ]),
        world,
        { log: quiet },
      ),
    ).toThrow(/no set no-such-set/);
    expect(snapshot(world)).toEqual(before);
  });

  it("refuses a place mapped twice", () => {
    expect(() =>
      assignBackdrops(
        mapping([
          { place: "hall", set: "station" },
          { place: "hall", set: "school-classroom" },
        ]),
        world,
        { log: quiet },
      ),
    ).toThrow(/mapped twice/);
  });
});

describe("withBackdrop", () => {
  it("adds to an empty frontmatter and leaves the body alone", () => {
    expect(withBackdrop("---\n---\nbody\n---\n", "a")).toBe(
      "---\nbackdrop: a\n---\nbody\n---\n",
    );
  });

  it("refuses a page without frontmatter or with a block value", () => {
    expect(() => withBackdrop("# Title\n", "a")).toThrow(/no frontmatter/);
    expect(() => withBackdrop("---\nbackdrop:\n  - a\n---\n", "b")).toThrow(
      /block value/,
    );
  });
});
