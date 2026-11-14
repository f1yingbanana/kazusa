import { execFileSync } from "node:child_process";
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
  checkLiveWorld,
  cloneWorld,
  downloadLiveWorld,
  downloadSize,
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
    await cloneWorld(root, "demo", (p) => seen.push(p));
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
    await cloneWorld(root, "demo");
    expect(git(live, "status", "--porcelain")).toBe("");
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

  it("keeps what the machine already has in world/, such as the Gateway's token", async () => {
    const { root, live } = kazusa();
    put(path.join(live, ".state/.env"), "OPENCLAW_GATEWAY_TOKEN=t\n");
    put(path.join(live, "shared/half-copied.md"), "From a run that died.\n");
    await cloneWorld(root, "demo");
    expect(readFileSync(path.join(live, ".state/.env"), "utf8")).toContain(
      "OPENCLAW_GATEWAY_TOKEN",
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
    await downloadLiveWorld(root, (p) => seen.push(p));
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

  it("counts a release as downloaded only once its tag is here", async () => {
    const { root, source, live } = kazusa();
    await cloneWorld(root, "demo");
    const next = release(source, "0.3.0");
    // The commit, fetched some other way, without its tag.
    git(live, "fetch", "--quiet", "--no-tags", source, `${next}:refs/fetched`);
    expect(await checkLiveWorld(root)).toMatchObject({
      newer: true,
      downloaded: false,
    });
  });
});

describe("downloadSize", () => {
  it("counts what a release has that the world's commit lacks, once each", () => {
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
    const chapter = new Map(from).set("package.json", { sha: "p3", size: 12 });
    expect(downloadSize(from, chapter)).toBe(12);
    const to = tree({
      "package.json": ["p2", 11],
      "shared/wiki/places/hub.md": ["h2", 120],
      "workspaces/ami/SOUL.md": ["s1", 50],
      "workspaces/ami/portraits/happy.webp": ["w1", 5000],
      "workspaces/bo/portraits/happy.webp": ["w1", 5000],
    });
    // The same picture twice is downloaded once.
    expect(downloadSize(from, to)).toBe(11 + 120 + 5000);
  });
});
