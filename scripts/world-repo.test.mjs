import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
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
import { describe, expect, it } from "vitest";
import { adoptWorldRepo, buildRemotes, PLAY, REMOTES } from "./world-repo.mjs";

const TEMPLATE = "apps/kazusa/worlds/demo";
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

/** A Kazusa checkout whose template `demo` had two releases. */
function checkout() {
  const root = mkdtempSync(path.join(tmpdir(), "kazusa-world-repo-"));
  git(root, "init", "--quiet", "--initial-branch=main");
  const template = path.join(root, TEMPLATE);
  const release = (version, lore, date) => {
    put(
      path.join(template, "package.json"),
      JSON.stringify({ name: "demo-world", displayName: "Demo", version }),
    );
    put(path.join(template, "shared/wiki/concepts/lore.md"), lore);
    put(path.join(template, "workspaces/ami/SOUL.md"), "Ami.\n");
    put(path.join(template, "workspaces/ami/stickers/happy.webp"), "\x00\x01");
    git(root, "add", "-A");
    execFileSync(
      "git",
      [
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.com",
        "commit",
        "--quiet",
        "-m",
        `Release ${version}`,
      ],
      {
        cwd: root,
        env: {
          ...process.env,
          GIT_AUTHOR_DATE: date,
          GIT_COMMITTER_DATE: date,
        },
      },
    );
  };
  release("0.1.0", "Old lore.\n", "2026-11-01T00:00:00Z");
  release("0.2.0", "New lore.\n", "2026-11-02T00:00:00Z");
  put(path.join(root, "README.md"), "Not a template.\n");
  git(root, "add", "-A");
  git(root, "commit", "--quiet", "-m", "Unrelated");
  return root;
}

/**
 * A live world made from the template at `commit` (as setup leaves it, with its
 * `.template/` snapshot), then played on.
 */
function world(root, commit, { snapshot = true } = {}) {
  const live = path.join(root, WORLD);
  const files = git(root, "ls-tree", "-r", "--name-only", commit, TEMPLATE)
    .split("\n")
    .map((file) => path.relative(TEMPLATE, file));
  const manifest = {};
  for (const file of files) {
    const data = execFileSync(
      "git",
      ["show", `${commit}:${TEMPLATE}/${file}`],
      {
        cwd: root,
      },
    );
    put(path.join(live, file), data);
    manifest[file] = createHash("sha256").update(data).digest("hex");
    if (snapshot && /\.(md|json|txt)$/.test(file))
      put(path.join(live, ".template", file), data);
  }
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

describe("buildRemotes", () => {
  it("gives every build the same commits, one per template change, tagged by version", async () => {
    const root = checkout();
    const other = mkdtempSync(path.join(tmpdir(), "kazusa-remotes-"));
    expect(await buildRemotes(root)).toEqual(["Built the demo-world remote."]);
    await buildRemotes(root, other);
    const bare = path.join(root, REMOTES, "demo-world.git");
    const tip = git(bare, "rev-parse", "main");
    expect(git(path.join(other, "demo-world.git"), "rev-parse", "main")).toBe(
      tip,
    );
    expect(git(bare, "rev-list", "--count", "main")).toBe("2");
    expect(git(bare, "tag").split("\n")).toEqual(["v0.1.0", "v0.2.0"]);
    expect(git(bare, "rev-parse", "v0.2.0^{commit}")).toBe(tip);
    expect(git(bare, "log", "-1", "--format=%an <%ae> %at", "main")).toBe(
      `Kazusa <worlds@openrp.ai> ${Date.parse("2026-11-02T00:00:00Z") / 1000}`,
    );
    // Up to date: nothing to do.
    expect(await buildRemotes(root)).toEqual([]);
  });
});

describe("adoptWorldRepo", () => {
  it("roots a world at the published commit its snapshot matches, touching no file", async () => {
    const root = checkout();
    await buildRemotes(root);
    const live = world(root, "HEAD~2");
    const memory = readFileSync(path.join(live, "workspaces/ami/MEMORY.md"));
    const lines = await adoptWorldRepo(root);
    const bare = path.join(root, REMOTES, "demo-world.git");
    expect(git(live, "rev-parse", PLAY)).toBe(git(bare, "rev-parse", "v0.1.0"));
    expect(lines).toEqual([
      "Demo's history starts at its published 0.1.0 (" +
        git(live, "rev-parse", "--short=7", PLAY) +
        ").",
    ]);
    expect(readFileSync(path.join(live, "workspaces/ami/MEMORY.md"))).toEqual(
      memory,
    );
    // Play shows as changes; the machine's files and the snapshot don't.
    expect(git(live, "status", "--porcelain").split("\n").sort()).toEqual([
      "?? openclaw.json",
      "?? workspaces/ami/MEMORY.md",
    ]);
    expect(git(live, "remote", "get-url", "upstream")).toBe(bare);
    expect(git(live, "config", "core.autocrlf")).toBe("false");
  });

  it("keeps its root on later starts", async () => {
    const root = checkout();
    await buildRemotes(root);
    const live = world(root, "HEAD~2");
    await adoptWorldRepo(root);
    const rooted = git(live, "rev-parse", PLAY);
    expect(await adoptWorldRepo(root)).toEqual([]);
    expect(git(live, "rev-parse", PLAY)).toBe(rooted);
  });

  it("roots a world whose template was never published at its snapshot", async () => {
    const root = checkout();
    await buildRemotes(root);
    const live = world(root, "HEAD~1");
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

  it("leaves a world from before snapshots unrooted", async () => {
    const root = checkout();
    await buildRemotes(root);
    const live = world(root, "HEAD~1", { snapshot: false });
    const [line] = await adoptWorldRepo(root);
    expect(line).toMatch(/starts at its first save/);
    expect(existsSync(path.join(live, ".git"))).toBe(true);
    expect(() => git(live, "rev-parse", "--verify", "--quiet", PLAY)).toThrow();
    // Said once, not on every start.
    expect(await adoptWorldRepo(root)).toEqual([]);
  });

  it("does nothing before setup has made a world", async () => {
    const root = checkout();
    expect(await adoptWorldRepo(root)).toEqual([]);
  });

  it("works without a remote, as a copy without this repo's history", async () => {
    const root = checkout();
    const live = world(root, "HEAD~1");
    rmSync(path.join(root, ".git"), { recursive: true, force: true });
    const [line] = await adoptWorldRepo(root);
    expect(line).toMatch(/matches no published version/);
    expect(git(live, "remote")).toBe("");
  });
});
