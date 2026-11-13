import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { authorName } from "@kazusa/client";
import { afterEach, describe, expect, it } from "vitest";
import {
  availableUpdate,
  compareVersions,
  readWorldPackage,
  worldCredit,
} from "./package.ts";

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

describe("compareVersions", () => {
  it("orders by number, not by text", () => {
    expect(compareVersions("0.10.0", "0.9.2")).toBeGreaterThan(0);
    expect(compareVersions("0.3.0", "0.4.0")).toBeLessThan(0);
    expect(compareVersions("v1.0", "1.0.0")).toBe(0);
    expect(compareVersions("1.2.0-beta", "1.2.0")).toBe(0);
  });
});

describe("availableUpdate", () => {
  let root: string | undefined;
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = undefined;
  });
  /** `apps/kazusa` as Kazusa lays it out: the live world and its template. */
  const layout = (live: string, template?: string) => {
    root = mkdtempSync(path.join(tmpdir(), "world-update-"));
    const put = (dir: string, version: string) => {
      mkdirSync(path.join(root!, dir), { recursive: true });
      writeFileSync(
        path.join(root!, dir, "package.json"),
        JSON.stringify({
          name: "demo",
          version,
          kazusa: { ...KAZUSA, template: "demo" },
        }),
      );
    };
    put("world", live);
    if (template) put("worlds/demo", template);
    return path.join(root, "world");
  };

  it("offers a newer template, and who brings it in", () => {
    expect(availableUpdate(layout("0.3.0", "0.4.0"))).toEqual({
      version: "0.4.0",
      current: "0.3.0",
      systemAgent: "arona",
    });
  });

  it("offers nothing when the template is the same, older or not downloaded", () => {
    expect(availableUpdate(layout("0.4.0", "0.4.0"))).toBeUndefined();
    expect(availableUpdate(layout("0.4.0", "0.3.0"))).toBeUndefined();
    expect(availableUpdate(layout("0.4.0"))).toBeUndefined();
  });
});
