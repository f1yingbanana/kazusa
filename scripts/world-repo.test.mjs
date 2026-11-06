import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  adoptWorldRepo,
  PLAY,
  SOURCES,
  syncWorlds,
  WORLDS,
} from "./world-repo.mjs";

const WORLD = "apps/kazusa/world";

const git = (dir, ...args) =>
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
    { cwd: dir, encoding: "utf8" },
  ).trim();

const put = (file, text) => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
};

/** A published world `demo` with two releases, as its creator's repository. */
function published() {
  const repo = mkdtempSync(path.join(tmpdir(), "kazusa-demo-world-"));
  git(repo, "init", "--quiet", "--initial-branch=main");
  const release = (version, lore) => {
    put(
      path.join(repo, "package.json"),
      JSON.stringify({ name: "demo-world", displayName: "Demo", version }),
    );
    put(path.join(repo, "shared/wiki/concepts/lore.md"), lore);
    put(path.join(repo, "workspaces/ami/SOUL.md"), "Ami.\n");
    put(path.join(repo, "workspaces/ami/stickers/happy.webp"), "\x00\x01");
    git(repo, "add", "-A");
    git(repo, "commit", "--quiet", "-m", `Release ${version}`);
    git(repo, "tag", `v${version}`);
  };
  release("0.1.0", "Old lore.\n");
  release("0.2.0", "New lore.\n");
  return repo;
}

/** A Kazusa copy whose sources list the published `demo`. */
function kazusa(source = published()) {
  const root = mkdtempSync(path.join(tmpdir(), "kazusa-world-repo-"));
  put(
    path.join(root, SOURCES),
    JSON.stringify({ worlds: [{ id: "demo", provider: "git", url: source }] }),
  );
  return { root, source, clone: path.join(root, WORLDS, "demo") };
}

/**
 * A live world made from the template at `commit` (as setup leaves it, with its
 * `.template/` snapshot), then played on.
 */
function world(root, source, commit, { snapshot = true } = {}) {
  const live = path.join(root, WORLD);
  const manifest = {};
  for (const file of git(source, "ls-tree", "-r", "--name-only", commit).split(
    "\n",
  )) {
    const data = execFileSync("git", ["show", `${commit}:${file}`], {
      cwd: source,
    });
    put(path.join(live, file), data);
    manifest[file] = createHash("sha256").update(data).digest("hex");
    if (snapshot && /\.(md|json|txt)$/.test(file))
      put(path.join(live, ".template", file), data);
  }
  const pkg = JSON.parse(readFileSync(path.join(live, "package.json"), "utf8"));
  put(
    path.join(live, "package.json"),
    JSON.stringify({ ...pkg, kazusa: { systemAgent: "a", template: "demo" } }),
  );
  if (snapshot)
    put(
      path.join(live, ".template/manifest.json"),
      JSON.stringify({ template: "demo", files: manifest }),
    );
  put(path.join(live, "openclaw.json"), "{}\n");
  put(path.join(live, "workspaces/ami/MEMORY.md"), "Played.\n");
  put(path.join(live, ".state/kazusa/memory-vectors.sqlite"), "db");
  return live;
}

describe("syncWorlds", () => {
  it("clones each listed world, then moves it to what was published", async () => {
    const { root, source, clone } = kazusa();
    expect(await syncWorlds(root)).toEqual(["Downloading the demo world."]);
    expect(git(clone, "rev-parse", "HEAD")).toBe(
      git(source, "rev-parse", "HEAD"),
    );
    put(path.join(source, "shared/wiki/concepts/more.md"), "More.\n");
    git(source, "add", "-A");
    git(source, "commit", "--quiet", "-m", "More");
    expect(await syncWorlds(root)).toEqual([]);
    expect(git(clone, "rev-parse", "HEAD")).toBe(
      git(source, "rev-parse", "HEAD"),
    );
  });

  it("keeps a creator's work in a clone", async () => {
    const { root, source, clone } = kazusa();
    await syncWorlds(root);
    put(path.join(clone, "shared/wiki/concepts/lore.md"), "Mine.\n");
    git(source, "commit", "--quiet", "--allow-empty", "-m", "Upstream");
    const kept = ["Kept your work in worlds/demo; it isn't updated."];
    expect(await syncWorlds(root)).toEqual(kept);
    expect(
      readFileSync(path.join(clone, "shared/wiki/concepts/lore.md"), "utf8"),
    ).toBe("Mine.\n");
    git(clone, "commit", "--quiet", "-am", "Edit");
    expect(await syncWorlds(root)).toEqual(kept);
  });

  it("sets a template folder from before repositories aside", async () => {
    const { root, source, clone } = kazusa();
    put(path.join(clone, "package.json"), "{}");
    const [aside, downloading] = await syncWorlds(root);
    expect(aside).toMatch(/^Set the old demo template aside in /);
    expect(downloading).toBe("Downloading the demo world.");
    expect(git(clone, "rev-parse", "HEAD")).toBe(
      git(source, "rev-parse", "HEAD"),
    );
    const [kept] = readdirSync(
      path.join(root, "apps/kazusa/.worlds-before-repositories"),
    );
    expect(kept).toMatch(/^demo-\d+$/);
  });

  it("keeps what it has when a world can't be reached", async () => {
    const { root } = kazusa(path.join(tmpdir(), "kazusa-nowhere-world"));
    const [, line] = await syncWorlds(root);
    expect(line).toMatch(/^Couldn't update the demo world: /);
  });
});

describe("adoptWorldRepo", () => {
  it("roots a world at the published commit its snapshot matches, touching no file", async () => {
    const { root, source } = kazusa();
    await syncWorlds(root);
    const live = world(root, source, "v0.1.0");
    const memory = readFileSync(path.join(live, "workspaces/ami/MEMORY.md"));
    const lines = await adoptWorldRepo(root);
    expect(git(live, "rev-parse", PLAY)).toBe(
      git(source, "rev-parse", "v0.1.0^{commit}"),
    );
    expect(lines).toEqual([
      `Demo's history starts at its published 0.1.0 (${git(live, "rev-parse", "--short=7", PLAY)}).`,
    ]);
    expect(readFileSync(path.join(live, "workspaces/ami/MEMORY.md"))).toEqual(
      memory,
    );
    // Play shows as changes; the machine's files and the snapshot don't.
    expect(
      git(live, "status", "--porcelain")
        .split("\n")
        .map((line) => line.trim())
        .sort(),
    ).toEqual([
      "?? openclaw.json",
      "?? workspaces/ami/MEMORY.md",
      "M package.json",
    ]);
    // Updates come from the source, as the world names no repository.
    expect(git(live, "remote", "get-url", "upstream")).toBe(source);
    expect(git(live, "config", "core.autocrlf")).toBe("false");
  });

  it("follows the world's own repository", async () => {
    const { root, source } = kazusa();
    await syncWorlds(root);
    const live = world(root, source, "v0.2.0");
    const pkg = JSON.parse(
      readFileSync(path.join(live, "package.json"), "utf8"),
    );
    put(
      path.join(live, "package.json"),
      JSON.stringify({
        ...pkg,
        repository: { type: "git", url: "https://example.com/demo.git" },
      }),
    );
    await adoptWorldRepo(root);
    expect(git(live, "remote", "get-url", "upstream")).toBe(
      "https://example.com/demo.git",
    );
    expect(git(live, "rev-parse", PLAY)).toBe(
      git(source, "rev-parse", "v0.2.0^{commit}"),
    );
  });

  it("keeps its root on later starts", async () => {
    const { root, source } = kazusa();
    await syncWorlds(root);
    const live = world(root, source, "v0.1.0");
    await adoptWorldRepo(root);
    const rooted = git(live, "rev-parse", PLAY);
    expect(await adoptWorldRepo(root)).toEqual([]);
    expect(git(live, "rev-parse", PLAY)).toBe(rooted);
  });

  it("roots a world whose template was never published at its snapshot", async () => {
    const { root, source } = kazusa();
    await syncWorlds(root);
    const live = world(root, source, "v0.2.0");
    put(path.join(live, ".template/shared/wiki/concepts/lore.md"), "Edited.\n");
    const [line] = await adoptWorldRepo(root);
    expect(line).toMatch(/matches no published version/);
    expect(git(live, "log", "--format=%s", PLAY)).toBe("Demo as imported");
    expect(git(live, "show", `${PLAY}:shared/wiki/concepts/lore.md`)).toBe(
      "Edited.",
    );
    // Binary files aren't in a snapshot.
    expect(
      git(live, "ls-tree", "-r", "--name-only", PLAY).split("\n"),
    ).not.toContain("workspaces/ami/stickers/happy.webp");
  });

  it("roots at the snapshot when the template's clone is missing", async () => {
    const { root, source } = kazusa();
    const live = world(root, source, "v0.2.0");
    const [line] = await adoptWorldRepo(root);
    expect(line).toMatch(/matches no published version/);
    expect(git(live, "remote", "get-url", "upstream")).toBe(source);
  });

  it("leaves a world from before snapshots unrooted, and says so once", async () => {
    const { root, source } = kazusa();
    await syncWorlds(root);
    const live = world(root, source, "v0.2.0", { snapshot: false });
    const [line] = await adoptWorldRepo(root);
    expect(line).toMatch(/starts at its first save/);
    expect(existsSync(path.join(live, ".git"))).toBe(true);
    expect(() => git(live, "rev-parse", "--verify", "--quiet", PLAY)).toThrow();
    expect(await adoptWorldRepo(root)).toEqual([]);
  });

  it("does nothing before setup has made a world", async () => {
    const { root } = kazusa();
    expect(await adoptWorldRepo(root)).toEqual([]);
  });
});
