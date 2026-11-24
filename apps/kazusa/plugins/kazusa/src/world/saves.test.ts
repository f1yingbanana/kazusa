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
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Git } from "./git.ts";
import { commitOf, PLAY, worldGit } from "./repo.ts";
import {
  AUTOSAVE,
  autosaveStart,
  BEFORE_UPDATE,
  deleteSave,
  isRunning,
  listSaves,
  saveBeforeUpdate,
  loadGame,
  newSaveRef,
  readRequest,
  saveGame,
  stageRequest,
  stateDatabases,
} from "./saves.ts";

let root: string;
let live: string;
let git: Git;
const run = (...args: string[]) =>
  execFileSync("git", args, { cwd: live, encoding: "utf8" }).trim();
const put = (file: string, text: string) => {
  const full = path.join(live, file);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, text);
};
const get = (file: string) => readFileSync(path.join(live, file), "utf8");
const has = (file: string) => existsSync(path.join(live, file));

/** A database the way the Gateway leaves it: the shared one, in WAL mode. */
function sharedDb(simTime: number, keys: string, model = "m1") {
  const file = path.join(live, ".state/state/openclaw.sqlite");
  mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS plugin_state_entries (plugin_id TEXT, namespace TEXT, entry_key TEXT, value_json TEXT, PRIMARY KEY (plugin_id, namespace, entry_key));
    CREATE TABLE IF NOT EXISTS config_machine_state (state_key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at_ms INTEGER NOT NULL);`);
  db.prepare(
    "INSERT OR REPLACE INTO plugin_state_entries VALUES ('kazusa', '@retained.clock', 'primary', ?)",
  ).run(JSON.stringify({ simTime, speed: 0 }));
  db.prepare(
    "INSERT OR REPLACE INTO config_machine_state VALUES ('authProfiles.store', ?, 0)",
  ).run(keys);
  db.prepare(
    "INSERT OR REPLACE INTO plugin_state_entries VALUES ('kazusa', '@retained.models', 'world', ?)",
  ).run(JSON.stringify({ model }));
  db.close();
}

const readDb = (sql: string) => {
  const db = new DatabaseSync(path.join(live, ".state/state/openclaw.sqlite"), {
    readOnly: true,
  });
  try {
    return db.prepare(sql).get() as Record<string, unknown> | undefined;
  } finally {
    db.close();
  }
};

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "kazusa-saves-"));
  live = path.join(root, "apps/kazusa/world");
  mkdirSync(live, { recursive: true });
  run("init", "--quiet", `--initial-branch=${PLAY}`);
  run("config", "user.name", "Kazusa");
  run("config", "user.email", "kazusa@localhost");
  run("config", "commit.gpgSign", "false");
  writeFileSync(
    path.join(live, ".git/info/exclude"),
    "/*\n!/package.json\n!/shared/\n!/workspaces/\n/workspaces/*/.agents\n",
  );
  put("package.json", "{}");
  put("workspaces/amy/MEMORY.md", "# Amy\n");
  put("workspaces/amy/gone.md", "creator's\n");
  run("add", "-A");
  run("commit", "--quiet", "-m", "Release 1.0.0");
  run("tag", "-a", "v1.0.0", "-m", "1.0.0");
  put("openclaw.json", '{"saved":true}');
  git = worldGit(live)!;
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("saves", () => {
  it("finds the databases, but not those of caches or temporary files", () => {
    put(".state/kazusa/messages.sqlite", "");
    put(".state/kazusa/messages.sqlite-wal", "");
    put(".state/agents/amy/agent/openclaw-agent.sqlite", "");
    put(".state/tmp/captures/owner.sqlite", "");
    put(".state/cache/x.sqlite", "");
    put(".state/kazusa/memory-vectors.sqlite", "");
    expect(stateDatabases(live)).toEqual([
      ".state/agents/amy/agent/openclaw-agent.sqlite",
      ".state/kazusa/messages.sqlite",
    ]);
  });

  it("saves the whole game and loads it back, keeping this machine's keys and settings", () => {
    sharedDb(1_000, "old-keys");
    put("workspaces/amy/MEMORY.md", "# Amy\n\nSaved.\n");
    put("workspaces/amy/notes.md", "kept\n");
    run("rm", "--quiet", "workspaces/amy/gone.md");
    const ref = newSaveRef(git, new Date("2026-11-23T10:00:00Z"));
    expect(ref).toBe("refs/saves/2026-11-23T10-00-00Z");
    put(".state/kazusa/memory-vectors.sqlite", "vectors then");
    saveGame(git, live, ref, {
      kind: "save",
      name: "  Before  the festival ",
      kazusaVersion: "0.7.0",
    });
    // Folded in: the database alone is the save.
    expect(has(".state/state/openclaw.sqlite-wal")).toBe(false);
    // Nothing moved: play and the files are as they were.
    expect(run("status", "--porcelain")).toContain("workspaces/amy/notes.md");

    const [save] = listSaves(git);
    expect(save).toMatchObject({
      ref,
      name: "Before the festival",
      kind: "save",
      simTime: 1_000,
      version: "1.0.0",
      branch: "main",
      kazusaVersion: "0.7.0",
      base: run("rev-parse", "v1.0.0^{commit}"),
    });

    // Play on, change keys and config, then load.
    sharedDb(9_000, "new-keys", "m2");
    put(".state/kazusa/memory-vectors.sqlite", "vectors now");
    put(".state/agents/bea/agent/openclaw-agent.sqlite", "new");
    put(".state/agents/bea/agent/openclaw-agent.sqlite-wal", "log");
    put("workspaces/amy/MEMORY.md", "# Amy\n\nLater.\n");
    put("workspaces/bea/MEMORY.md", "# Bea\n");
    put("workspaces/arona/.agents/skill.md", "rewritten each start\n");
    put("openclaw.json", '{"saved":false}');
    expect(loadGame(git, live, ref)).toEqual([]);

    expect(get("workspaces/amy/MEMORY.md")).toBe("# Amy\n\nSaved.\n");
    expect(get("workspaces/amy/notes.md")).toBe("kept\n");
    expect(has("workspaces/amy/gone.md")).toBe(false);
    expect(has("workspaces/bea/MEMORY.md")).toBe(false);
    expect(has("workspaces/arona/.agents/skill.md")).toBe(true);
    expect(get("openclaw.json")).toBe('{"saved":true}');
    expect(has(".state/agents/bea/agent/openclaw-agent.sqlite")).toBe(false);
    expect(has(".state/agents/bea/agent/openclaw-agent.sqlite-wal")).toBe(
      false,
    );
    expect(
      readDb(
        "SELECT value_json FROM plugin_state_entries WHERE namespace = '@retained.clock'",
      )?.value_json,
    ).toContain('"simTime":1000');
    expect(
      readDb(
        "SELECT value_json FROM plugin_state_entries WHERE namespace = '@retained.models'",
      )?.value_json,
    ).toBe('{"model":"m2"}');
    expect(get(".state/kazusa/memory-vectors.sqlite")).toBe("vectors now");
    expect(
      readDb("SELECT value_json FROM config_machine_state")?.value_json,
    ).toBe("new-keys");
    // The save's differences are working changes on the commit it stood on.
    expect(commitOf(git, PLAY)).toBe(run("rev-parse", "v1.0.0^{commit}"));
    const status = execFileSync("git", ["status", "--porcelain"], {
      cwd: live,
      encoding: "utf8",
    });
    expect(status.trimEnd().split("\n").sort()).toEqual([
      " D workspaces/amy/gone.md",
      " M workspaces/amy/MEMORY.md",
      "?? workspaces/amy/notes.md",
    ]);
  });

  it("keeps no name the player didn't give, and deletes saves", () => {
    sharedDb(5, "k");
    saveGame(git, live, AUTOSAVE, { kind: "autosave" });
    // Something else under the saves isn't a save.
    run("update-ref", "refs/saves/stray", "HEAD");
    const [save] = listSaves(git);
    expect(listSaves(git)).toHaveLength(1);
    expect(save).toMatchObject({ ref: AUTOSAVE, name: null });
    deleteSave(git, AUTOSAVE);
    expect(listSaves(git)).toEqual([]);
    expect(() => deleteSave(git, "refs/saves/stray")).toThrow();
  });

  it("fills the autosave slot with a world's start, before it ever ran", () => {
    // As setup leaves it: the config, and the keys' database with no play.
    put(
      "openclaw.json",
      JSON.stringify({
        plugins: {
          entries: {
            kazusa: { config: { clock: { startAt: "2026-11-01T08:00:00Z" } } },
          },
        },
      }),
    );
    mkdirSync(path.join(live, ".state/state"), { recursive: true });
    const db = new DatabaseSync(
      path.join(live, ".state/state/openclaw.sqlite"),
    );
    db.exec(
      "CREATE TABLE config_machine_state (state_key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at_ms INTEGER NOT NULL)",
    );
    db.close();
    expect(autosaveStart(git, live, "0.7.0")).toBe(true);
    expect(listSaves(git)[0]).toMatchObject({
      ref: AUTOSAVE,
      kind: "autosave",
      name: "World start",
      simTime: Date.parse("2026-11-01T08:00:00Z"),
    });
    // Once only, and never for a world that has run.
    expect(autosaveStart(git, live)).toBe(false);
    deleteSave(git, AUTOSAVE);
    put(".state/agents/amy/agent/openclaw-agent.sqlite", "");
    expect(autosaveStart(git, live)).toBe(false);
  });

  it("never saves the token or stray files, whatever git ignores", () => {
    rmSync(path.join(live, ".git/info/exclude"));
    sharedDb(5, "k");
    put(".state/.env", "OPENCLAW_GATEWAY_TOKEN=secret\n");
    put(".state/logs/today.log", "noise\n");
    put("openclaw.json.bak", "{}");
    saveGame(git, live, AUTOSAVE, { kind: "autosave" });
    expect(
      run("ls-tree", "-r", "--name-only", AUTOSAVE).split("\n").sort(),
    ).toEqual([
      ".state/state/openclaw.sqlite",
      "openclaw.json",
      "package.json",
      "workspaces/amy/MEMORY.md",
      "workspaces/amy/gone.md",
    ]);
  });

  it("saves nothing while a world update is open, but loads: that's its undo", () => {
    sharedDb(5, "k");
    saveGame(git, live, AUTOSAVE, { kind: "autosave" });
    put(".state/kazusa/world-update/report.json", "{}");
    expect(() => saveGame(git, live, AUTOSAVE, { kind: "autosave" })).toThrow(
      /update is still open/,
    );
    expect(() => stageRequest(git, live, { op: "save" })).toThrow(
      /update is still open/,
    );
    expect(stageRequest(git, live, { op: "load", ref: AUTOSAVE }).op).toBe(
      "load",
    );
    rmSync(path.join(live, ".state/kazusa/save-request.json"));
    loadGame(git, live, AUTOSAVE);
    expect(has(".state/kazusa/world-update/report.json")).toBe(false);
  });

  it("saves before an update into its slot, named for the release", () => {
    sharedDb(5, "k");
    expect(() =>
      stageRequest(git, live, { op: "save", beforeUpdate: true }),
    ).toThrow(/no new version/);
    // The creator's next release, downloaded.
    const next = run("commit-tree", "HEAD^{tree}", "-p", "HEAD", "-m", "2.0.0");
    run("tag", "-a", "v2.0.0", "-m", "2.0.0", next);
    const request = stageRequest(git, live, { op: "save", beforeUpdate: true });
    expect(request).toMatchObject({
      ref: BEFORE_UPDATE,
      kind: "autosave",
      name: "Before update to 2.0.0",
    });
    rmSync(path.join(live, ".state/kazusa/save-request.json"));
    expect(saveBeforeUpdate(git)).toBeUndefined();
    saveGame(git, live, BEFORE_UPDATE, {
      kind: "autosave",
      name: request.name,
    });
    expect(saveBeforeUpdate(git)?.name).toBe("Before update to 2.0.0");
  });

  it("stages one request at a time", () => {
    const request = stageRequest(git, live, { op: "save", name: " Day 2 " });
    expect(request).toMatchObject({
      op: "save",
      name: "Day 2",
      phase: "waiting",
    });
    expect(isRunning(readRequest(live))).toBe(true);
    expect(() =>
      stageRequest(git, live, { op: "save", name: "again" }),
    ).toThrow(/already/);
    expect(() =>
      stageRequest(git, live, { op: "load", ref: "refs/saves/none" }),
    ).toThrow();
  });
});
