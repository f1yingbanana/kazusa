import { execFileSync } from "node:child_process";
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
  commitOf,
  downloadedRelease,
  gitIn,
  keepInStash,
  PLAY,
  standOn,
} from "./git.ts";
import { applyUpdate, commitTree, planUpdate } from "./update.ts";

let root: string;
let live: string;
const run = (...args: string[]) =>
  execFileSync("git", args, { cwd: live, encoding: "utf8" }).trim();
const put = (file: string, text: string | Buffer) => {
  const full = path.join(live, file);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, text);
};
const get = (file: string) => readFileSync(path.join(live, file), "utf8");
const place = (id: string, summary: string) =>
  `---\nplace_id: ${id}\nname: ${id}\nsummary: ${summary}\n---\n\n# ${id}\n`;

/**
 * A world as setup leaves it, a clone standing on release 1.0.0 and played on
 * without committing; then release 2.0.0 downloaded (its tag fetched).
 */
function world() {
  run("init", "--quiet", `--initial-branch=${PLAY}`);
  run("config", "user.name", "Kazusa");
  run("config", "user.email", "kazusa@localhost");
  run("config", "commit.gpgSign", "false");
  mkdirSync(path.join(live, ".git/info"), { recursive: true });
  writeFileSync(
    path.join(live, ".git/info/exclude"),
    "/*\n!/package.json\n!/shared/\n!/workspaces/\n",
  );
  put("package.json", JSON.stringify({ name: "demo", version: "1.0.0" }));
  put("shared/wiki/entities/places/hub.md", place("hub", "A place."));
  put("shared/wiki/entities/places/park.md", place("park", "Grass."));
  put("workspaces/amy/MEMORY.md", "# Amy\n");
  put("workspaces/amy/stickers/happy2.webp", Buffer.from([9, 9]));
  run("add", "-A");
  run("commit", "--quiet", "-m", "Release 1.0.0");
  run("tag", "-a", "v1.0.0", "-m", "1.0.0");
  const first = run("rev-parse", "HEAD");
  // The creator's next release, on the side.
  put("package.json", JSON.stringify({ name: "demo", version: "2.0.0" }));
  put("shared/wiki/entities/places/hub.md", place("hub", "The centre."));
  put("workspaces/amy/portraits/happy.webp", Buffer.from([0, 1, 2, 3]));
  put("workspaces/amy/stickers/happy[2].webp", Buffer.from([7]));
  run("rm", "--quiet", "shared/wiki/entities/places/park.md");
  run("add", "-A");
  run("commit", "--quiet", "-m", "Release 2.0.0");
  run("tag", "-a", "v2.0.0", "-m", "2.0.0: the centre moves.\n\nMore.");
  run("reset", "--quiet", "--hard", first);
  // Play, uncommitted, and the machine's own files.
  put("workspaces/amy/MEMORY.md", "# Amy\n\n## Lately\n\nBusy.\n");
  put("workspaces/amy/wiki/entities/characters/bea.md", "# Bea\n");
  put("openclaw.json", "{}");
  return first;
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "world-update-"));
  live = path.join(root, "apps/kazusa/world");
  mkdirSync(live, { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("a world update over git", () => {
  it("keeps the game in git's stash, merges the release in and stands the world on it", () => {
    const first = world();
    const git = gitIn(live)!;
    const release = downloadedRelease(git)!;
    expect(release).toMatchObject({
      version: "2.0.0",
      notes: "2.0.0: the centre moves.\n\nMore.",
      url: null,
    });
    const template = commitTree(git, release.commit);
    const plan = planUpdate(live, template, commitTree(git, first), {
      layout: "keep",
    });
    expect(plan.bestAttempt).toBe(false);

    keepInStash(git, live, "Demo before updating to 2.0.0", release.commit);
    // Nothing touched: the stash is only a copy.
    expect(get("workspaces/amy/MEMORY.md")).toContain("Busy.");
    expect(run("stash", "list")).toContain("Demo before updating to 2.0.0");
    expect(
      run("stash", "show", "--include-untracked", "--name-only"),
    ).toContain("workspaces/amy/wiki/entities/characters/bea.md");
    // The machine's config isn't the world's.
    expect(run("show", "--name-only", "--format=", "stash@{0}")).not.toContain(
      "openclaw.json",
    );

    applyUpdate(live, template, plan, "keep", {
      from: first,
      to: release.commit,
    });
    standOn(git, release.commit);
    expect(get("shared/wiki/entities/places/hub.md")).toContain("The centre.");
    expect(get("workspaces/amy/MEMORY.md")).toContain("Busy.");
    expect(
      readFileSync(path.join(live, "workspaces/amy/portraits/happy.webp")),
    ).toEqual(Buffer.from([0, 1, 2, 3]));
    // A name, not a pattern: `happy[2].webp` leaves `happy2.webp` alone.
    expect(
      readFileSync(path.join(live, "workspaces/amy/stickers/happy2.webp")),
    ).toEqual(Buffer.from([9, 9]));
    expect(
      existsSync(path.join(live, "shared/wiki/entities/places/park.md")),
    ).toBe(false);
    expect(commitOf(git, PLAY)).toBe(release.commit);
    // What's left as changes is the game again, nothing committed.
    expect(
      run("status", "--porcelain")
        .split("\n")
        .map((line) => line.trim())
        .sort(),
    ).toEqual(["?? workspaces/amy/wiki/", "M workspaces/amy/MEMORY.md"]);
    expect(downloadedRelease(git)).toBeUndefined();
    // And the stash puts the world back as it was, if ever needed.
    run("checkout", "--quiet", "--", ".");
    run("clean", "-fdq", "--", "workspaces");
    run("reset", "--quiet", "--hard", first);
    run("stash", "apply", "--quiet");
    expect(get("shared/wiki/entities/places/hub.md")).toContain("A place.");
    expect(get("workspaces/amy/MEMORY.md")).toContain("Busy.");
  });

  it("keeps a world without history against the release it's about to take", () => {
    run("init", "--quiet", `--initial-branch=${PLAY}`);
    run("config", "user.name", "Kazusa");
    run("config", "user.email", "kazusa@localhost");
    put("package.json", "{}");
    run("add", "-A");
    run("commit", "--quiet", "-m", "Release");
    run("tag", "v1.0.0");
    const release = run("rev-parse", "HEAD");
    run("update-ref", "-d", `refs/heads/${PLAY}`);
    put("workspaces/amy/MEMORY.md", "Played.\n");
    const git = gitIn(live)!;
    expect(downloadedRelease(git)?.version).toBe("1.0.0");
    keepInStash(git, live, "Before", release);
    standOn(git, release);
    expect(run("stash", "list")).toContain("Before");
    expect(get("workspaces/amy/MEMORY.md")).toBe("Played.\n");
  });

  it("works on the world's own repository whatever the environment says", () => {
    world();
    const elsewhere = path.join(root, "elsewhere");
    mkdirSync(elsewhere);
    execFileSync("git", ["init", "--quiet"], { cwd: elsewhere });
    const before = process.env.GIT_DIR;
    process.env.GIT_DIR = path.join(elsewhere, ".git");
    try {
      expect(downloadedRelease(gitIn(live)!)?.version).toBe("2.0.0");
    } finally {
      if (before === undefined) delete process.env.GIT_DIR;
      else process.env.GIT_DIR = before;
    }
  });
});
