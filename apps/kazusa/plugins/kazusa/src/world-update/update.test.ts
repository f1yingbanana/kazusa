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
  PLAY,
  standOn,
  worldGit,
} from "../world/repo.ts";
import { applyUpdate } from "./apply.ts";
import { planUpdate } from "./plan.ts";
import { commitTree } from "./tree.ts";

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
  it("merges the release in and stands the world on it", () => {
    const first = world();
    const git = worldGit(live)!;
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

    applyUpdate(live, template, plan);
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
  });

  it("finishes an update cut short before `play` moved by applying it again", () => {
    const first = world();
    const git = worldGit(live)!;
    const release = downloadedRelease(git)!;
    const template = commitTree(git, release.commit);
    // Half the release written, `play` never moved.
    put("shared/wiki/entities/places/hub.md", place("hub", "The centre."));
    put("workspaces/amy/portraits/happy.webp", Buffer.from([0, 1, 2, 3]));
    rmSync(path.join(live, "shared/wiki/entities/places/park.md"));
    const plan = planUpdate(live, template, commitTree(git, first), {
      layout: "keep",
    });
    applyUpdate(live, template, plan);
    standOn(git, release.commit);
    expect(get("shared/wiki/entities/places/hub.md")).toContain("The centre.");
    expect(get("workspaces/amy/MEMORY.md")).toContain("Busy.");
    expect(
      readFileSync(path.join(live, "workspaces/amy/stickers/happy[2].webp")),
    ).toEqual(Buffer.from([7]));
    expect(
      run("status", "--porcelain")
        .split("\n")
        .map((line) => line.trim())
        .sort(),
    ).toEqual(["?? workspaces/amy/wiki/", "M workspaces/amy/MEMORY.md"]);
  });

  it("works on the world's own repository whatever the environment says", () => {
    world();
    const elsewhere = path.join(root, "elsewhere");
    mkdirSync(elsewhere);
    execFileSync("git", ["init", "--quiet"], { cwd: elsewhere });
    const before = process.env.GIT_DIR;
    process.env.GIT_DIR = path.join(elsewhere, ".git");
    try {
      expect(downloadedRelease(worldGit(live)!)?.version).toBe("2.0.0");
    } finally {
      if (before === undefined) delete process.env.GIT_DIR;
      else process.env.GIT_DIR = before;
    }
  });
});
