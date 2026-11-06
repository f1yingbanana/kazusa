import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  deleteSource,
  readSource,
  saveSource,
  SourceConflict,
} from "./source.ts";

let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "kazusa-source-"));
  mkdirSync(path.join(root, "entities", "places"), { recursive: true });
  writeFileSync(
    path.join(root, "entities", "places", "plaza.md"),
    "---\nname: Plaza\n---\n\n# Plaza\n",
  );
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("readSource", () => {
  it("finds a page by id wherever it lives", () => {
    const source = readSource(root, "plaza");
    expect(source).toMatchObject({
      path: "entities/places/plaza.md",
      exists: true,
      text: "---\nname: Plaza\n---\n\n# Plaza\n",
    });
    expect(source.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("says where a page not written yet would go", () => {
    expect(readSource(root, "mika", "person")).toEqual({
      id: "mika",
      path: "entities/characters/mika.md",
      text: "",
      exists: false,
      hash: null,
    });
  });
});

describe("saveSource", () => {
  it("writes over the version that was read", () => {
    const { hash } = readSource(root, "plaza");
    const saved = saveSource(root, {
      id: "plaza",
      text: "# Plaza\n\nBusy.",
      base: hash,
    });
    expect(saved.text).toBe("# Plaza\n\nBusy.\n");
    expect(
      readFileSync(path.join(root, "entities", "places", "plaza.md"), "utf8"),
    ).toBe("# Plaza\n\nBusy.\n");
  });

  it("refuses when the page changed since it was read", () => {
    const { hash } = readSource(root, "plaza");
    writeFileSync(
      path.join(root, "entities", "places", "plaza.md"),
      "# Plaza\n\nSlept on.\n",
    );
    expect(() =>
      saveSource(root, { id: "plaza", text: "Mine", base: hash }),
    ).toThrow(SourceConflict);
  });

  it("starts a new page in its kind's folder, but not over one", () => {
    saveSource(root, {
      id: "mika",
      kind: "person",
      text: "# Mika",
      base: null,
    });
    expect(readSource(root, "mika").path).toBe("entities/characters/mika.md");
    expect(() =>
      saveSource(root, { id: "mika", text: "# Again", base: null }),
    ).toThrow(SourceConflict);
  });

  it("overwrites when no base is given", () => {
    writeFileSync(
      path.join(root, "entities", "places", "plaza.md"),
      "# Plaza\n\nSlept on.\n",
    );
    expect(saveSource(root, { id: "plaza", text: "Mine\n" }).text).toBe(
      "Mine\n",
    );
  });
});

describe("deleteSource", () => {
  it("moves the page to the trash, keeping where it lived", () => {
    const trash = path.join(root, "..", `${path.basename(root)}-trash`);
    const { hash } = readSource(root, "plaza");
    deleteSource(root, { id: "plaza", base: hash }, trash);
    expect(existsSync(path.join(root, "entities/places/plaza.md"))).toBe(false);
    expect(
      readFileSync(path.join(trash, "entities/places/plaza.md"), "utf8"),
    ).toContain("# Plaza");
    rmSync(trash, { recursive: true });
  });

  it("refuses a page that changed since it was read, or isn't there", () => {
    expect(() =>
      deleteSource(root, { id: "plaza", base: "stale" }, root),
    ).toThrow(SourceConflict);
    expect(() => deleteSource(root, { id: "nowhere" }, root)).toThrow(
      SourceConflict,
    );
  });
});
