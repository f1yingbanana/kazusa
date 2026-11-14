import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  adoptWorldRepo,
  checkLiveWorld,
  cloneWorld,
  compareReleases,
  downloadLiveWorld,
  listWorlds,
  PLAY,
  SOURCES,
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
  return { root, source, live: path.join(root, WORLD) };
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

/** A release the creator tags with notes, as Publish will. */
function release(source, version, file = "shared/wiki/concepts/more.md") {
  put(path.join(source, file), `${version}\n`);
  const pkg = JSON.parse(readFileSync(path.join(source, "package.json")));
  put(path.join(source, "package.json"), JSON.stringify({ ...pkg, version }));
  git(source, "add", "-A");
  git(source, "commit", "--quiet", "-m", `Release ${version}`);
  git(source, "tag", "-a", `v${version}`, "-m", `${version}: more lore.`);
  return git(source, "rev-parse", "HEAD");
}

describe("listWorlds and cloneWorld", () => {
  it("lists worlds by their package.json, then clones the picked one's newest release into world/", async () => {
    const { root, source, live } = kazusa();
    const [peeked] = await listWorlds(root);
    expect(peeked).toMatchObject({
      id: "demo",
      downloaded: false,
      package: { name: "demo-world", version: "0.2.0" },
    });
    git(source, "commit", "--quiet", "--allow-empty", "-m", "Unreleased");
    const seen = [];
    expect(await cloneWorld(root, "demo", (p) => seen.push(p))).toEqual([]);
    expect(git(live, "rev-parse", PLAY)).toBe(
      git(source, "rev-parse", "v0.2.0^{commit}"),
    );
    expect(git(live, "symbolic-ref", "HEAD")).toBe(`refs/heads/${PLAY}`);
    expect(git(live, "config", "core.autocrlf")).toBe("false");
    // The machine's config and runtime state are local.
    put(path.join(live, "openclaw.json"), "{}");
    put(path.join(live, ".state/db.sqlite"), "db");
    expect(git(live, "status", "--porcelain")).toBe("");
    expect(existsSync(`${live}.cloning`)).toBe(false);
    const [listed] = await listWorlds(root);
    expect(listed).toMatchObject({ id: "demo", downloaded: true });
    // Picked again: already here.
    expect(await cloneWorld(root, "demo")).toEqual([]);
    await expect(cloneWorld(root, "elsewhere")).rejects.toThrow(
      "No world elsewhere is listed.",
    );
  });

  it("replaces another pick that wasn't set up, never a world that was", async () => {
    const { root, source, live } = kazusa();
    await cloneWorld(root, "demo");
    const other = published();
    put(
      path.join(root, SOURCES),
      JSON.stringify({
        worlds: [
          { id: "demo", provider: "git", url: source },
          { id: "other", provider: "git", url: other },
        ],
      }),
    );
    await cloneWorld(root, "other");
    expect(git(live, "remote", "get-url", "origin")).toBe(other);
    put(path.join(live, "openclaw.json"), "{}");
    await expect(cloneWorld(root, "demo")).rejects.toThrow(/set up already/);
  });

  it("keeps what the machine already has in world/, such as an older Kazusa's keys", async () => {
    const { root, live } = kazusa();
    put(path.join(live, ".state/.env"), "OPENROUTER_API_KEY=k\n");
    put(path.join(live, "shared/half-copied.md"), "From a run that died.\n");
    await cloneWorld(root, "demo");
    expect(readFileSync(path.join(live, ".state/.env"), "utf8")).toContain(
      "OPENROUTER_API_KEY",
    );
    expect(existsSync(path.join(live, "shared/half-copied.md"))).toBe(false);
    expect(git(live, "status", "--porcelain")).toBe("");
  });

  it("leaves nothing when a clone fails", async () => {
    const { root, live } = kazusa(path.join(tmpdir(), "kazusa-nowhere-world"));
    await expect(cloneWorld(root, "demo")).rejects.toThrow();
    expect(existsSync(live)).toBe(false);
    expect(existsSync(`${live}.cloning`)).toBe(false);
  });

  it("says why a world can't be listed", async () => {
    const { root } = kazusa(path.join(tmpdir(), "kazusa-nowhere-world"));
    const [listed] = await listWorlds(root);
    expect(listed).toMatchObject({ id: "demo", error: expect.any(String) });
  });
});

describe("checkLiveWorld and downloadLiveWorld", () => {
  it("finds a newer release without fetching it, then fetches only its tag", async () => {
    const { root, source, live } = kazusa();
    expect(await checkLiveWorld(root)).toEqual({ checked: false });
    await cloneWorld(root, "demo");
    const here = git(live, "rev-parse", PLAY);
    expect(await checkLiveWorld(root)).toMatchObject({
      current: { commit: here, version: "0.2.0" },
      latest: { version: "0.2.0" },
      newer: false,
    });
    const next = release(source, "0.3.0");
    git(source, "commit", "--quiet", "--allow-empty", "-m", "Unreleased");
    // Off GitHub: no size, no page.
    expect(await checkLiveWorld(root)).toEqual({
      checked: true,
      current: { commit: here, version: "0.2.0" },
      latest: { commit: next, version: "0.3.0", url: null },
      newer: true,
      downloaded: false,
    });
    const seen = [];
    expect(await downloadLiveWorld(root, (p) => seen.push(p))).toEqual([]);
    expect(git(live, "rev-parse", "v0.3.0^{commit}")).toBe(next);
    // Only the release: not the work pushed after it, and the world unmoved.
    expect(() =>
      git(live, "cat-file", "-e", git(source, "rev-parse", "HEAD")),
    ).toThrow();
    expect(git(live, "rev-parse", PLAY)).toBe(here);
    expect(await checkLiveWorld(root)).toMatchObject({
      latest: { version: "0.3.0", notes: "0.3.0: more lore." },
      newer: true,
      downloaded: true,
    });
    // Taken, as `world_update` leaves it.
    git(live, "update-ref", `refs/heads/${PLAY}`, next);
    expect(await checkLiveWorld(root)).toMatchObject({
      current: { commit: next, version: "0.3.0" },
      newer: false,
    });
  });

  it("moves a world from before clones onto the commit its snapshot matches, touching no file", async () => {
    const { root, source } = kazusa();
    const live = world(root, source, "v0.1.0");
    expect(await adoptWorldRepo(root)).toEqual([
      "This world's history is on: its next update finds where it came from.",
    ]);
    expect(git(live, "remote", "get-url", "origin")).toBe(source);
    // No history yet: versions decide.
    expect(await checkLiveWorld(root)).toMatchObject({
      current: { commit: null, version: "0.1.0" },
      latest: { version: "0.2.0" },
      newer: true,
    });
    const published = git(source, "rev-parse", "v0.1.0^{commit}");
    expect(await downloadLiveWorld(root)).toEqual([
      `This world now stands on the creator's commit it was made from (${published.slice(0, 7)}).`,
    ]);
    expect(git(live, "rev-parse", PLAY)).toBe(published);
    expect(existsSync(path.join(live, ".template"))).toBe(false);
    expect(
      readFileSync(path.join(live, "workspaces/ami/MEMORY.md"), "utf8"),
    ).toBe("Played.\n");
  });

  it("moves a world rooted at an older release onto the one an earlier update took", async () => {
    const { root, source } = kazusa();
    // Rooted at 0.1.0, then updated to 0.2.0 by copying files: its snapshot
    // says 0.2.0.
    const live = world(root, source, "v0.2.0");
    await adoptWorldRepo(root);
    git(live, "fetch", "--quiet", source, "refs/tags/v0.1.0:refs/tags/v0.1.0");
    git(live, "update-ref", `refs/heads/${PLAY}`, "v0.1.0^{commit}");
    release(source, "0.3.0");
    await downloadLiveWorld(root);
    expect(git(live, "rev-parse", PLAY)).toBe(
      git(source, "rev-parse", "v0.2.0^{commit}"),
    );
  });

  it("keeps a world whose snapshot matches nothing on its own root", async () => {
    const { root, source } = kazusa();
    const live = world(root, source, "v0.1.0");
    put(path.join(live, ".template/shared/wiki/concepts/lore.md"), "Edited.\n");
    await adoptWorldRepo(root);
    expect(await downloadLiveWorld(root)).toEqual([]);
    expect(() => git(live, "rev-parse", "--verify", PLAY)).toThrow();
    // Nothing else says where it came from: kept for a best attempt.
    expect(existsSync(path.join(live, ".template"))).toBe(true);
  });

  it("drops the remote and refs an older Kazusa kept, touching no file", async () => {
    const { root, source, live } = kazusa();
    await cloneWorld(root, "demo");
    git(live, "remote", "add", "upstream", source);
    git(live, "update-ref", "refs/kazusa/taken", PLAY);
    put(path.join(live, "workspaces/ami/MEMORY.md"), "Played.\n");
    expect(await adoptWorldRepo(root)).toEqual([]);
    expect(git(live, "remote")).toBe("origin");
    expect(git(live, "for-each-ref", "refs/kazusa/")).toBe("");
    expect(
      readFileSync(path.join(live, "workspaces/ami/MEMORY.md"), "utf8"),
    ).toBe("Played.\n");
  });
});

describe("compareReleases", () => {
  it("says what a release changes in a world and what downloading it costs", () => {
    const tree = (files) =>
      new Map(
        Object.entries(files).map(([file, [sha, size]]) => [
          file,
          { sha, size },
        ]),
      );
    const from = tree({
      "package.json": ["p1", 10],
      "shared/wiki/places/hub.md": ["h1", 100],
      "workspaces/ami/SOUL.md": ["s1", 50],
    });
    // A new chapter: a new checkpoint listed, nothing for a game in progress.
    const chapter = new Map(from).set("package.json", { sha: "p3", size: 12 });
    expect(compareReleases(from, chapter)).toEqual({
      changes: { files: 0, areas: [] },
      size: 12,
    });
    const to = tree({
      "package.json": ["p2", 11],
      "shared/wiki/places/hub.md": ["h2", 120],
      "workspaces/ami/SOUL.md": ["s1", 50],
      "workspaces/ami/portraits/happy.webp": ["w1", 5000],
      "workspaces/bo/portraits/happy.webp": ["w1", 5000],
    });
    expect(compareReleases(from, to)).toEqual({
      changes: {
        files: 3,
        areas: [
          { area: "workspaces/*/portraits", count: 2 },
          { area: "shared/wiki", count: 1 },
        ],
      },
      // The same picture twice is downloaded once.
      size: 11 + 120 + 5000,
    });
  });
});
