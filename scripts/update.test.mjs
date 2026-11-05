import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyPending,
  buildOf,
  refOf,
  replaceTree,
  updatePaths,
} from "./update.mjs";

/** Writes `{ "a/b.txt": "text" }` under a new folder. */
function tree(
  files,
  root = mkdtempSync(path.join(tmpdir(), "kazusa-update-")),
) {
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  }
  return root;
}
const read = (root, file) =>
  existsSync(path.join(root, file))
    ? readFileSync(path.join(root, file), "utf8")
    : undefined;

describe("refOf", () => {
  it("takes the commit from a describe name, else the tag itself", () => {
    expect(refOf("0.1.3-2-gef08f9b")).toBe("ef08f9b");
    expect(refOf("0.1.3")).toBe("0.1.3");
    expect(refOf("v0.2.0-beta")).toBe("v0.2.0-beta");
  });
});

describe("buildOf", () => {
  it("is ready once the downloads are up, whatever the workflow says", () => {
    expect(buildOf(true, { status: "in_progress" })).toBe("ready");
  });

  it("is building while the release workflow hasn't finished", () => {
    expect(buildOf(false, { status: "queued", conclusion: null })).toBe(
      "building",
    );
    expect(buildOf(false, { status: "in_progress", conclusion: null })).toBe(
      "building",
    );
  });

  it("failed when the workflow didn't succeed, else the downloads are missing", () => {
    expect(buildOf(false, { status: "completed", conclusion: "failure" })).toBe(
      "failed",
    );
    expect(buildOf(false, { status: "completed", conclusion: "success" })).toBe(
      "missing",
    );
    expect(buildOf(false, undefined)).toBe("missing");
  });
});

describe("replaceTree", () => {
  it("replaces whole entries but keeps what only this copy has around the world", () => {
    const to = tree({
      "package.json": "old",
      "scripts/gone.mjs": "old",
      "apps/web/page.tsx": "old",
      "apps/kazusa/world/openclaw.json": "mine",
      "apps/kazusa/node_modules/x.js": "installed",
      ".env": "mine",
    });
    const from = tree({
      "package.json": "new",
      "scripts/dev.mjs": "new",
      "apps/web/page.tsx": "new",
      "apps/kazusa/world/openclaw.json": "template",
      "apps/kazusa/package.json": "new",
    });
    const trash = path.join(to, ".update/old-1");
    replaceTree(from, to, {
      keep: ["apps/kazusa/world"],
      within: ["apps", "apps/kazusa"],
      trash,
    });
    expect(read(to, "package.json")).toBe("new");
    expect(read(to, "scripts/dev.mjs")).toBe("new");
    expect(read(to, "scripts/gone.mjs")).toBeUndefined();
    expect(read(to, "apps/web/page.tsx")).toBe("new");
    expect(read(to, "apps/kazusa/package.json")).toBe("new");
    expect(read(to, "apps/kazusa/world/openclaw.json")).toBe("mine");
    expect(read(to, "apps/kazusa/node_modules/x.js")).toBe("installed");
    expect(read(to, ".env")).toBe("mine");
    expect(read(trash, "scripts/gone.mjs")).toBe("old");
  });

  it("puts everything back when a step fails", () => {
    const to = tree({ "a.txt": "old a", "b/c.txt": "old c" });
    const from = tree({ "a.txt": "new a", "b/c.txt": "new c" });
    // A file where the trash needs a folder makes the second move fail.
    const trash = path.join(to, ".update/old-1");
    tree({ b: "in the way" }, trash);
    expect(() => replaceTree(from, to, { trash })).toThrow();
    expect(read(to, "a.txt")).toBe("old a");
    expect(read(to, "b/c.txt")).toBe("old c");
    expect(read(from, "a.txt")).toBe("new a");
  });
});

describe("applyPending", () => {
  it("does nothing when nothing is staged", () => {
    expect(applyPending(tree({ "package.json": "{}" }))).toBeUndefined();
  });

  it("records a failure once, so the next start doesn't retry it", () => {
    const root = tree({ "package.json": "{}" });
    const paths = updatePaths(root);
    tree(
      {
        ".update/pending.json": JSON.stringify({
          kind: "packaged",
          to: "release",
          version: "0.2.0",
          dir: path.join(root, "missing/t"),
        }),
      },
      root,
    );
    expect(applyPending(root)).toEqual({
      ok: false,
      applied: false,
      version: "0.2.0",
      error: "The download is gone. Try updating again.",
    });
    expect(existsSync(paths.pending)).toBe(false);
    expect(JSON.parse(readFileSync(paths.failed, "utf8")).version).toBe(
      "0.2.0",
    );
  });

  it("swaps a packaged copy in, keeping the world, and clears an old failure", () => {
    const root = tree({
      VERSION: "0.1.3\n",
      "node_modules/a.js": "old",
      "apps/kazusa/world/AGENTS.md": "mine",
      ".update/failed.json": "{}",
    });
    const download = tree({
      "t/VERSION": "0.2.0\n",
      "t/node_modules/a.js": "new",
      "t/node/node": "binary",
    });
    tree(
      {
        ".update/pending.json": JSON.stringify({
          kind: "packaged",
          to: "release",
          version: "0.2.0",
          dir: path.join(download, "t"),
        }),
      },
      root,
    );
    expect(applyPending(root)).toEqual({ ok: true, version: "0.2.0" });
    expect(read(root, "VERSION")).toBe("0.2.0\n");
    expect(read(root, "node_modules/a.js")).toBe("new");
    expect(read(root, "node/node")).toBe("binary");
    expect(read(root, "apps/kazusa/world/AGENTS.md")).toBe("mine");
    expect(existsSync(updatePaths(root).failed)).toBe(false);
    // The download's folder goes once it's applied.
    expect(existsSync(download)).toBe(false);
  });

  it("keeps an update whose install failed, and leaves the install for next start", () => {
    const root = tree({ "package.json": "{}", VERSION: "0.1.3\n" });
    // No lockfile, so `npm ci` fails at once.
    const download = tree({ "t/package.json": '{"name":"new"}' });
    tree(
      {
        ".update/pending.json": JSON.stringify({
          kind: "source",
          to: "release",
          version: "0.2.0",
          dir: path.join(download, "t"),
        }),
      },
      root,
    );
    expect(applyPending(root)).toMatchObject({
      ok: false,
      applied: true,
      version: "0.2.0",
    });
    expect(read(root, "package.json")).toBe('{"name":"new"}');
    expect(read(root, "VERSION")).toBe("0.2.0\n");
    expect(existsSync(updatePaths(root).reinstall)).toBe(true);
    expect(existsSync(updatePaths(root).failed)).toBe(false);
  });
});
