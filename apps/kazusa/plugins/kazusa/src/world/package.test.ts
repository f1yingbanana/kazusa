import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { authorName } from "@kazusa/client";
import { afterEach, describe, expect, it } from "vitest";
import { readWorldPackage, worldCredit } from "./package.ts";

const KAZUSA = { systemAgent: "arona" };

describe("worldCredit", () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });
  const world = (contents: string) => {
    dir = mkdtempSync(path.join(tmpdir(), "world-package-"));
    writeFileSync(path.join(dir, "package.json"), contents);
    return dir;
  };

  it("credits the name people read, the author and the homepage", () => {
    const live = world(
      JSON.stringify({
        name: "cute-and-funny-world-of-kivotos",
        displayName: "Cute and Funny World of Kivotos",
        version: "0.3.0",
        author: "breados17",
        homepage: "https://openrp.ai/kazusa",
        kazusa: KAZUSA,
      }),
    );
    expect(worldCredit(live)).toEqual({
      name: "Cute and Funny World of Kivotos",
      version: "0.3.0",
      author: "breados17",
      homepage: "https://openrp.ai/kazusa",
    });
  });

  it("falls back to the slug and takes an author object's name", () => {
    const live = world(
      JSON.stringify({
        name: "saltmere",
        author: { name: "Ada", email: "a@b.c" },
        kazusa: KAZUSA,
      }),
    );
    expect(worldCredit(live)).toEqual({ name: "saltmere", author: "Ada" });
  });

  it("credits nobody without a readable package.json", () => {
    dir = mkdtempSync(path.join(tmpdir(), "world-package-"));
    expect(worldCredit(dir)).toBeUndefined();
    expect(readWorldPackage(world("{ nope"))).toBeUndefined();
    expect(readWorldPackage(world('{"name":"x"}'))).toBeUndefined();
  });
});

describe("authorName", () => {
  it("keeps only the name of npm's one-line author", () => {
    expect(authorName("Ada Lovelace <ada@example.com> (https://ada.dev)")).toBe(
      "Ada Lovelace",
    );
    expect(authorName("<ada@example.com>")).toBeUndefined();
    expect(authorName(undefined)).toBeUndefined();
  });
});
