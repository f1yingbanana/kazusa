import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { authorName } from "@kazusa/client";
import { afterEach, describe, expect, it } from "vitest";
import { availableUpdate, readWorldPackage, worldCredit } from "./package.ts";

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

describe("availableUpdate", () => {
  let root: string | undefined;
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = undefined;
  });

  it("offers the newest release downloaded until the world stands on it", () => {
    root = mkdtempSync(path.join(tmpdir(), "world-update-"));
    const live = path.join(root, "apps/kazusa/world");
    mkdirSync(live, { recursive: true });
    const git = (...args: string[]) =>
      execFileSync(
        "git",
        [
          "-c",
          "user.name=Test",
          "-c",
          "user.email=test@example.com",
          "-c",
          "commit.gpgSign=false",
          ...args,
        ],
        { cwd: live, encoding: "utf8" },
      ).trim();
    writeFileSync(
      path.join(live, "package.json"),
      JSON.stringify({ name: "demo", kazusa: { ...KAZUSA, template: "demo" } }),
    );
    git("init", "--quiet", "--initial-branch=play");
    git("remote", "add", "origin", "https://github.com/someone/demo-world.git");
    git("add", "-A");
    git("commit", "--quiet", "-m", "First");
    git("tag", "v0.4.0");
    expect(availableUpdate(live)).toBeUndefined();
    git("commit", "--quiet", "--allow-empty", "-m", "More lore");
    git("tag", "-a", "v0.5.0", "-m", "New lore.");
    const next = git("rev-parse", "HEAD");
    git("reset", "--quiet", "--hard", "HEAD~1");
    expect(availableUpdate(live)).toMatchObject({
      commit: next,
      version: "0.5.0",
      notes: "New lore.",
      url: "https://github.com/someone/demo-world/releases/tag/v0.5.0",
      systemAgent: "arona",
    });
    // Taken: the world stands on it.
    git("update-ref", "refs/heads/play", next);
    expect(availableUpdate(live)).toBeUndefined();
  });
});
