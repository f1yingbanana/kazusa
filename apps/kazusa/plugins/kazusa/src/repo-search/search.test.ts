import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findRepoRoot, grepRepo } from "./search.ts";

let repo: string;
let world: string;
const put = (file: string, text: string | Buffer) => {
  const full = path.join(repo, file);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, text);
};

beforeEach(() => {
  repo = mkdtempSync(path.join(tmpdir(), "repo-search-"));
  world = path.join(repo, "apps/kazusa/world");
  put("package.json", JSON.stringify({ name: "kazusa" }));
  put(
    "apps/kazusa/world/shared/wiki/entities/places/hub.md",
    "# Hub\n\nThe Rose Courtyard is nearby.\n",
  );
  put(
    "apps/kazusa/world/workspaces/amy/wiki/entities/places/rose.md",
    "Where I met Bea at the rose courtyard.\n",
  );
  put("apps/kazusa/world/.state/.env", "ROSE_KEY=secret\n");
  put("apps/kazusa/world/.state/kazusa/rose.sqlite", "rose");
  put("apps/kazusa/world/.state/kazusa/note.json", '{"rose": true}');
  put(
    "apps/kazusa/worlds/demo/shared/wiki/entities/places/court.md",
    "aliases: [Rose Courtyard]\n",
  );
  put(".env", "ROSE=1\n");
  put("node_modules/x/rose.md", "rose\n");
  put(
    "apps/kazusa/world/avatar.webp",
    Buffer.from([0, 1, 2, 114, 111, 115, 101]),
  );
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe("grepRepo", () => {
  it("finds the repository root from inside it", () => {
    expect(findRepoRoot(world)).toBe(repo);
  });

  it("searches this world by default, with paths the other tools take", async () => {
    const result = await grepRepo(repo, world, { pattern: "rose courtyard" });
    expect(result.matches.map(({ file }) => file).sort()).toEqual([
      "shared/wiki/entities/places/hub.md",
      "workspaces/amy/wiki/entities/places/rose.md",
    ]);
  });

  it("takes a regular expression, else literal text", async () => {
    const either = await grepRepo(repo, world, { pattern: "met bea|# hub" });
    expect(either.matches).toHaveLength(2);
    const invalid = await grepRepo(repo, world, { pattern: "[Rose" });
    expect(invalid.matches).toEqual([]);
    put("apps/kazusa/world/shared/notes.md", "see [Rose Courtyard]\n");
    const literal = await grepRepo(repo, world, { pattern: "[rose" });
    expect(literal.matches.map(({ file }) => file)).toEqual([
      "shared/notes.md",
    ]);
  });

  it("reaches a template, and never secrets, state, dependencies or binaries", async () => {
    const result = await grepRepo(repo, world, {
      pattern: "rose",
      path: "../../..",
    });
    const files = result.matches.map(({ file }) => file);
    expect(files).toContain(
      "../worlds/demo/shared/wiki/entities/places/court.md",
    );
    expect(files).toContain(".state/kazusa/note.json");
    expect(
      files.some((file) => /\.env|\.sqlite|node_modules|\.webp/.test(file)),
    ).toBe(false);
  });

  it("refuses to leave the repository", async () => {
    await expect(
      grepRepo(repo, world, { pattern: "x", path: "../../../.." }),
    ).rejects.toThrow("inside the Kazusa repository");
  });

  it("filters by glob and caps the results", async () => {
    const result = await grepRepo(repo, world, {
      pattern: "r",
      glob: "workspaces/**/*.md",
      maxResults: 1,
    });
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].file.startsWith("workspaces/")).toBe(true);
  });
});
