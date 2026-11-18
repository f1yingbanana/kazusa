import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  EditConflict,
  pictureType,
  putPicture,
  readJsonObject,
  readText,
  removePicture,
  writeTextOver,
} from "./files.ts";

const dir = () => mkdtempSync(path.join(tmpdir(), "wiki-edit-"));

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
const WEBP = Buffer.concat([
  Buffer.from("RIFF"),
  Buffer.from([0, 0, 0, 0]),
  Buffer.from("WEBPVP8 "),
]);

describe("a text the Wiki saves", () => {
  it("is written only over the version that was read", () => {
    const file = path.join(dir(), "MEMORY.md");
    const empty = readText(file);
    expect(empty).toEqual({ text: "", hash: null });
    const first = writeTextOver(file, "One", null);
    expect(first.text).toBe("One\n");
    // A night's sleep writes meanwhile.
    writeFileSync(file, "Slept on it\n");
    expect(() => writeTextOver(file, "Two", first.hash)).toThrow(EditConflict);
    expect(readFileSync(file, "utf8")).toBe("Slept on it\n");
  });
});

describe("a JSON file the Wiki writes over", () => {
  it("is read only when it is an object, and says what is wrong otherwise", () => {
    const at = dir();
    const file = path.join(at, "stickers.json");
    expect(readJsonObject(file)).toMatchObject({ ok: false, missing: true });
    writeFileSync(file, '{ "outfits": { "swim": "A swimsuit" }, }');
    expect(readJsonObject(file)).toMatchObject({
      ok: false,
      missing: false,
      problem: expect.stringMatching(/valid JSON/),
    });
    writeFileSync(file, "[]");
    expect(readJsonObject(file)).toMatchObject({ ok: false, missing: false });
    writeFileSync(file, '{ "outfits": {} }');
    expect(readJsonObject(file)).toEqual({ ok: true, value: { outfits: {} } });
  });
});

describe("a picture the Wiki takes", () => {
  it("is known by its bytes, and must be the type it was sent as", () => {
    expect(pictureType(PNG, "image/png")).toEqual({
      type: "image/png",
      ext: "png",
    });
    expect(pictureType(WEBP, undefined)?.ext).toBe("webp");
    expect(pictureType(PNG, "image/webp")).toBeUndefined();
    expect(
      pictureType(
        Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"),
        "image/svg+xml",
      ),
    ).toBeUndefined();
  });

  it("replaces one of the same name in another type, and deletes for good", () => {
    const root = dir();
    const looks = path.join(root, "portraits");
    putPicture(looks, "happy", PNG, "png");
    expect(putPicture(looks, "happy", WEBP, "webp")).toBe("happy.webp");
    expect(readdirSync(looks)).toEqual(["happy.webp"]);
    expect(removePicture(looks, "happy")).toBe(1);
    expect(existsSync(path.join(looks, "happy.webp"))).toBe(false);
    expect(removePicture(looks, "sad")).toBe(0);
  });
});
