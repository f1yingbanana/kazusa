import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { stage } from "./stickers.mjs";
import { drawCharacter, startFakeWiki } from "./testing/fake-wiki.mjs";

let wiki;
beforeAll(async () => {
  const files = new Map();
  for (const expression of ["neutral", "happy", "surprised"]) {
    files.set(
      `Small ${expression}.png`,
      (await drawCharacter({ expression })).png,
    );
    files.set(
      `Large ${expression}.png`,
      (await drawCharacter({ expression, width: 1500, height: 2400 })).png,
    );
  }
  wiki = await startFakeWiki(files);
});
afterAll(() => wiki.close());

describe("stickers stage", () => {
  it("crops a face set to 256 px WebP stickers around the same box as before", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "kazusa-stickers-"));
    const plan = path.join(dir, "plan.json");
    const names = ["neutral", "happy", "surprised"];
    writeFileSync(
      plan,
      JSON.stringify({
        wiki: wiki.url,
        crop: "face",
        sets: [
          { id: "small", files: names.map((name) => `Small ${name}.png`) },
          { id: "large", files: names.map((name) => `Large ${name}.png`) },
        ],
      }),
    );
    await stage(plan, path.join(dir, "out"));
    const staged = JSON.parse(
      readFileSync(path.join(dir, "out", "stage.json"), "utf8"),
    );
    // The large set is fetched as the wiki's 1200 px thumbnail.
    expect(wiki.requests.some((url) => url.startsWith("/thumb/1200/"))).toBe(
      true,
    );
    expect(staged.sets.map((set) => [set.id, set.box])).toEqual([
      ["small", [171, 66, 258]],
      ["large", [430, 149, 640]],
    ]);
    for (const set of staged.sets)
      for (const sticker of set.stickers) {
        const meta = await sharp(sticker.file).metadata();
        expect([meta.format, meta.width, meta.height]).toEqual([
          "webp",
          256,
          256,
        ]);
      }
  });
});
