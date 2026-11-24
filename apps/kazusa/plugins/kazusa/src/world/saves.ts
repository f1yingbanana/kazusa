import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { GameSave, SaveKind, SaveRequest } from "@kazusa/client";
import { text, type Git } from "./git.ts";
import {
  commitOf,
  downloadedRelease,
  PLAY,
  RELEASE_TAG,
  standOn,
  versionOf,
  WORLD_FILES,
} from "./repo.ts";

/**
 * A game's saves (the kazusa skill's `references/worlds.md` §4.6): each is a
 * commit off to the side, on its own ref under `refs/saves/`, whose parent is
 * the creator's commit the world stood on and whose tree is the whole game, the
 * config and the databases included. Made and loaded only with the Gateway
 * stopped, by whoever owns it (`scripts/dev.mjs`), never on a timer.
 *
 * Imports only Node's own modules at run time, like `repo.ts`, so the scripts
 * use it as is; its types are the wire contract's (`@kazusa/client`).
 */

/** The autosave of the last clean stop: one slot, overwritten each time. */
export const AUTOSAVE = "refs/saves/autosave";
/** The autosave made before a world update, when the player asks for one. */
export const BEFORE_UPDATE = "refs/saves/before-update";
/** What the autosave slot holds before a world's first clean stop. */
const WORLD_START = "World start";
const SAVES = "refs/saves/";
/** What a save is, in trailers of its commit's message. */
const KIND = "Kind";
const NAME = "Name";
const BRANCH = "Branch";
const SIM_TIME = "Sim-Time";
/** What made the save, to warn when it's loaded into something else. */
const KAZUSA_VERSION = "Kazusa-Version";
const WORLD_VERSION = "World-Version";

// ------------------------------------------------------------- the files

/** Runtime folders whose contents are never part of a save (worlds.md §4.6). */
const UNSAVED = new Set([
  "cache",
  "logs",
  "media",
  "tmp",
  "worktree-projections",
]);
/**
 * Caches a load keeps as they are: the memory search's vectors, keyed by each
 * text and model, stay right for any save and are rebuilt slowly.
 */
const CACHES = new Set([".state/kazusa/memory-vectors.sqlite"]);
const SQLITE_LOGS = ["-wal", "-shm", "-journal"] as const;
/** The world update being resolved: a game is never saved in the middle of one. */
const UPDATE_REPORT = ".state/kazusa/world-update/report.json";

/** The world's databases, relative to it with `/`: what a save adds of `.state`. */
export function stateDatabases(world: string): string[] {
  const found: string[] = [];
  const walk = (dir: string, rel: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const relative = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!(rel === ".state" && UNSAVED.has(entry.name)))
          walk(path.join(dir, entry.name), relative);
      } else if (
        entry.isFile() &&
        entry.name.endsWith(".sqlite") &&
        !CACHES.has(relative)
      ) {
        found.push(relative);
      }
    }
  };
  walk(path.join(world, ".state"), ".state");
  return found.sort();
}

/**
 * Folds every leftover write-ahead log into its database, so the file alone is
 * the database. Only with the Gateway stopped: it holds them open otherwise.
 */
function settleDatabases(world: string): void {
  for (const db of stateDatabases(world)) {
    const file = path.join(world, db);
    if (!existsSync(`${file}-wal`)) continue;
    const handle = new DatabaseSync(file);
    try {
      const { busy } = handle
        .prepare("PRAGMA wal_checkpoint(TRUNCATE)")
        .get() as { busy: number };
      if (busy) throw new Error(`${db} is still open elsewhere.`);
    } finally {
      handle.close();
    }
  }
}

const SHARED_DB = ".state/state/openclaw.sqlite";

function readRow(world: string, sql: string, ...params: string[]) {
  const file = path.join(world, SHARED_DB);
  if (!existsSync(file)) return undefined;
  const handle = new DatabaseSync(file, { readOnly: true });
  try {
    return handle.prepare(sql).get(...params) as
      Record<string, unknown> | undefined;
  } finally {
    handle.close();
  }
}

/** The world's clock as the Gateway last kept it (Kazusa's `clock` store). */
function storedSimTime(world: string): number | null {
  try {
    const row = readRow(
      world,
      "SELECT value_json FROM plugin_state_entries WHERE plugin_id = 'kazusa' AND namespace LIKE '%clock' AND entry_key = 'primary'",
    );
    const simTime = row
      ? (JSON.parse(String(row.value_json)) as { simTime?: unknown }).simTime
      : undefined;
    if (typeof simTime === "number") return simTime;
  } catch {
    // A world that never ran has no clock kept yet.
  }
  return configuredStart(world);
}

/** Where a new world's time begins (`plugins.entries.kazusa.config.clock`). */
function configuredStart(world: string): number | null {
  try {
    const config = JSON.parse(
      readFileSync(path.join(world, "openclaw.json"), "utf8"),
    ) as {
      plugins?: {
        entries?: { kazusa?: { config?: { clock?: { startAt?: unknown } } } };
      };
    };
    const at = config.plugins?.entries?.kazusa?.config?.clock?.startAt;
    const time = typeof at === "string" ? Date.parse(at) : Number.NaN;
    return Number.isFinite(time) ? time : null;
  } catch {
    return null;
  }
}

/**
 * What belongs to this machine and its owner, not to a game, which a load keeps
 * as it is: OpenClaw's machine state (provider keys and their health, model
 * catalogs, update checks) and Kazusa's settings (model picks, the embedding
 * model, context budgets). `openclaw.json` isn't split yet: a save holds it
 * whole, the cast with this machine's settings.
 */
const MACHINE: readonly {
  readonly what: string;
  readonly table: string;
  readonly where: string;
}[] = [
  {
    what: "provider keys and machine state",
    table: "config_machine_state",
    where: "1",
  },
  {
    what: "model and context settings",
    table: "plugin_state_entries",
    where:
      "plugin_id = 'kazusa' AND namespace IN ('@retained.models', '@retained.embedding', '@retained.contextSettings')",
  },
  {
    what: "Discord links",
    table: "plugin_state_entries",
    where: "plugin_id = 'kazusa' AND namespace = '@retained.bridges'",
  },
];

type Rows = readonly Record<string, unknown>[];

/**
 * This machine's rows, table by table (undefined for one that can't be read);
 * undefined without a database.
 */
function readMachine(world: string): (Rows | undefined)[] | undefined {
  const file = path.join(world, SHARED_DB);
  if (!existsSync(file)) return undefined;
  const handle = new DatabaseSync(file, { readOnly: true });
  try {
    return MACHINE.map(({ table, where }) => {
      try {
        return handle.prepare(`SELECT * FROM ${table} WHERE ${where}`).all();
      } catch {
        return undefined;
      }
    });
  } finally {
    handle.close();
  }
}

/** Puts this machine's rows back over the save's; what couldn't be, said. */
function writeMachine(
  world: string,
  carried: (Rows | undefined)[] | undefined,
): string[] {
  const file = path.join(world, SHARED_DB);
  // A load cut short and run again finds no database: the save's stay.
  if (!carried || !existsSync(file)) return [];
  const warnings: string[] = [];
  const handle = new DatabaseSync(file);
  try {
    MACHINE.forEach(({ what, table, where }, index) => {
      const rows = carried[index];
      if (!rows) {
        warnings.push(
          `This machine's ${what} couldn't be read, so the save's are back.`,
        );
        return;
      }
      try {
        handle.exec("BEGIN");
        handle.exec(`DELETE FROM ${table} WHERE ${where}`);
        for (const row of rows) {
          const columns = Object.keys(row);
          handle
            .prepare(
              `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
            )
            .run(...(Object.values(row) as never[]));
        }
        handle.exec("COMMIT");
      } catch (error) {
        handle.exec("ROLLBACK");
        warnings.push(
          `This machine's ${what} couldn't be kept, so the save's are back: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    });
  } finally {
    handle.close();
  }
  return warnings;
}

// ----------------------------------------------------------------- saves

/** A new save's ref: when it was made, so names never clash. */
export function newSaveRef(git: Git, now = new Date()): string {
  const stamp = now
    .toISOString()
    .replace(/\.\d+Z$/, "Z")
    .replace(/:/g, "-");
  let ref = `${SAVES}${stamp}`;
  for (let n = 2; commitOf(git, ref); n++) ref = `${SAVES}${stamp}-${n}`;
  return ref;
}

/** Whether `ref` is a save's: under `refs/saves/`, nothing climbing out. */
const isSaveRef = (ref: string): boolean =>
  ref.startsWith(SAVES) && !ref.slice(SAVES.length).includes("..");

/**
 * The line of the creator's history the world follows: `main` until checkpoints
 * are branches of their own (worlds.md §4.7). Kept in each save so a later
 * Kazusa can tell which line a save is on.
 */
const FOLLOWED_BRANCH = "main";

/**
 * Saves the game under `ref`: a commit whose parent is the creator's commit
 * `play` stands on, holding the world folders as they are, `openclaw.json` and
 * every database. Built through a temporary index, so `play`, the real index
 * and the files are untouched. The Gateway must have stopped cleanly.
 */
export function saveGame(
  git: Git,
  world: string,
  ref: string,
  save: {
    readonly kind: SaveKind;
    /** The player's name for it; none when they gave none. */
    readonly name?: string | null;
    readonly kazusaVersion?: string | null;
  },
): string {
  if (!isSaveRef(ref)) throw new Error(`${ref} isn't a save.`);
  if (existsSync(path.join(world, UPDATE_REPORT)))
    throw new Error(
      "A world update is still open. Finish it, or load a save, before saving.",
    );
  const head = commitOf(git, PLAY);
  if (!head) throw new Error("This world isn't standing on a release.");
  // Read first: even a read-only look at a database leaves a new log beside it.
  const simTime = storedSimTime(world);
  settleDatabases(world);
  const name = save.name?.replace(/\s+/g, " ").trim();
  const worldVersion = versionOf(git);
  const trailers = [
    `${KIND}: ${save.kind}`,
    ...(name ? [`${NAME}: ${name}`] : []),
    ...(simTime === null ? [] : [`${SIM_TIME}: ${simTime}`]),
    ...(worldVersion ? [`${WORLD_VERSION}: ${worldVersion}`] : []),
    `${BRANCH}: ${FOLLOWED_BRANCH}`,
    ...(save.kazusaVersion ? [`${KAZUSA_VERSION}: ${save.kazusaVersion}`] : []),
  ];
  const index = path.join(world, ".git", "kazusa-save-index");
  // Only one save runs at a time: a lock left here is a killed git's.
  for (const leftover of [index, `${index}.lock`])
    rmSync(leftover, { force: true });
  let tree: string;
  try {
    git(["read-tree", head], { index });
    // The world folders by name: nothing else of the folder, such as
    // `.state/.env`, ever gets in, whatever git ignores. One that's neither
    // here nor in the commit would fail git's pathspec check.
    const standing = new Set(
      text(git, ["ls-tree", "--name-only", head]).split("\n"),
    );
    const parts = WORLD_FILES.filter(
      (part) => standing.has(part) || existsSync(path.join(world, part)),
    );
    if (parts.length) git(["add", "--all", "--", ...parts], { index });
    // What the clone ignores, added by hand.
    git(["add", "--force", "--pathspec-from-file=-", "--pathspec-file-nul"], {
      index,
      input: ["openclaw.json", ...stateDatabases(world)].join("\0"),
    });
    tree = text(git, ["write-tree"], { index });
  } finally {
    rmSync(index, { force: true });
  }
  // The subject is for `git log`; the trailers are what's read back.
  const message = `${name || (save.kind === "autosave" ? "Autosave" : "Save")}\n\n${trailers.join("\n")}\n`;
  const commit = text(git, ["commit-tree", tree, "-p", head, "-m", message]);
  git(["update-ref", ref, commit]);
  return commit;
}

/**
 * Fills the autosave slot with the world as setup left it, before its first
 * start: the creator's release, this machine's config and keys, no play. So
 * there's always something to load. Only for a world that never ran (no
 * character has a database yet) and only once.
 */
export function autosaveStart(
  git: Git,
  world: string,
  kazusaVersion?: string | null,
): boolean {
  if (commitOf(git, AUTOSAVE)) return false;
  if (stateDatabases(world).some((db) => db.startsWith(".state/agents/")))
    return false;
  saveGame(git, world, AUTOSAVE, {
    kind: "autosave",
    name: WORLD_START,
    kazusaVersion,
  });
  return true;
}

/** The game's saves, newest first. */
export function listSaves(git: Git): GameSave[] {
  const fields = [
    "%(refname)",
    "%(objectname)",
    "%(creatordate:iso-strict)",
    "%(parent)",
    ...[KIND, NAME, SIM_TIME, WORLD_VERSION, BRANCH, KAZUSA_VERSION].map(
      (key) => `%(trailers:key=${key},valueonly,separator=)`,
    ),
  ];
  let listed: string;
  try {
    listed = text(git, [
      "for-each-ref",
      "--sort=-creatordate",
      `--format=${fields.join("%00")}`,
      SAVES,
    ]);
  } catch {
    return [];
  }
  const versions = releaseVersions(git);
  const saves: GameSave[] = [];
  for (const line of listed.split("\n")) {
    const [
      ref,
      commit,
      savedAt,
      parent,
      kind,
      name,
      simTime,
      worldVersion,
      branch,
      kazusaVersion,
    ] = line.split("\0");
    if (!ref || (kind !== "save" && kind !== "autosave")) continue;
    const base = parent?.split(" ")[0] ?? "";
    const time = Number.parseInt(simTime ?? "", 10);
    saves.push({
      ref,
      commit,
      base,
      name: name || null,
      kind,
      savedAt,
      simTime: Number.isFinite(time) ? time : null,
      version: worldVersion || versions.get(base) || null,
      branch: branch || null,
      kazusaVersion: kazusaVersion || null,
    });
  }
  return saves;
}

/** Release versions by the commit each names. */
function releaseVersions(git: Git): Map<string, string> {
  const versions = new Map<string, string>();
  try {
    for (const line of text(git, [
      "for-each-ref",
      "--format=%(refname:short)%00%(objectname)%00%(*objectname)",
      "refs/tags/",
    ]).split("\n")) {
      const [tag, own, named] = line.split("\0");
      if (tag && RELEASE_TAG.test(tag))
        versions.set(named || own, tag.replace(/^v/, ""));
    }
  } catch {
    // No tags: no versions shown.
  }
  return versions;
}

/** The save `ref` names, if it's a game save. */
function findSave(git: Git, ref: string): GameSave | undefined {
  return listSaves(git).find((save) => save.ref === ref);
}

/**
 * Puts the game back as `ref` saved it: its files, config and databases, and
 * `play` on the commit the world stood on then, so the save's differences are
 * working changes again. This machine's keys and settings stay (`MACHINE`), as
 * do caches; what couldn't be kept is returned. Only with the Gateway stopped.
 */
export function loadGame(git: Git, world: string, ref: string): string[] {
  const save = findSave(git, ref);
  if (!save) throw new Error(`There's no save ${ref}.`);
  const head = commitOf(git, PLAY);
  if (!head) throw new Error("This world isn't standing on a release.");
  const machine = readMachine(world);
  // Every database of the game being left goes, logs first: an old log over
  // another database corrupts it, and one the save lacks isn't the save's.
  for (const db of stateDatabases(world))
    for (const suffix of [...SQLITE_LOGS, ""])
      rmSync(path.join(world, `${db}${suffix}`), { force: true });
  // From the commit the world stands on to the save: world files written since
  // go (git's exclude rules keep the rest), then the save's are written over.
  git(["read-tree", head]);
  const parts = WORLD_FILES.filter((part) =>
    existsSync(path.join(world, part)),
  );
  if (parts.length) git(["clean", "-d", "--force", "--quiet", "--", ...parts]);
  git(["read-tree", "-u", "--reset", save.commit]);
  standOn(git, save.base);
  // No save holds an open update: the world is back from before it.
  rmSync(path.join(world, UPDATE_REPORT), { force: true });
  return writeMachine(world, machine);
}

/**
 * Deletes a save and frees what only it held: database versions no other save
 * keeps. Refs only, so the Gateway may be running. Objects from the last hour
 * stay, so a save being written or a download under way loses nothing; they go
 * at a later delete.
 */
export function deleteSave(git: Git, world: string, ref: string): void {
  // A load may be reading this one; the frontend's route stages one at a time.
  if (isRunning(readRequest(world)))
    throw new Error("The world is saving or loading. Delete once it's done.");
  if (!findSave(git, ref)) throw new Error(`There's no save ${ref}.`);
  git(["update-ref", "-d", ref]);
  try {
    git(["gc", "--prune=1.hour.ago", "--quiet"]);
  } catch {
    // Deleted all the same; the space comes back at the next delete.
  }
}

// ------------------------------------------------------------ the request

/**
 * Where the save or load the frontend asked for is kept, with how it's going:
 * written by the frontend's command (`scripts/world.mjs`), carried out by the
 * Gateway's owner (`scripts/dev.mjs`), which moves it through its phases, like
 * `.update/pending.json` for Kazusa's own updates. One at a time.
 */
const requestPath = (world: string): string =>
  path.join(world, ".state", "kazusa", "save-request.json");

export const isRunning = (request: SaveRequest | undefined): boolean =>
  Boolean(request && request.phase !== "done" && request.phase !== "failed");

export function readRequest(world: string): SaveRequest | undefined {
  try {
    return JSON.parse(readFileSync(requestPath(world), "utf8")) as SaveRequest;
  } catch {
    return undefined;
  }
}

export function writeRequest(world: string, request: SaveRequest): void {
  const file = requestPath(world);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(`${file}.tmp`, JSON.stringify(request, null, 2));
  renameSync(`${file}.tmp`, file);
}

/**
 * Asks the Gateway's owner to save the game, or to load `ref`. A load may undo
 * a world update still open; a save waits until it's finished.
 */
export function stageRequest(
  git: Git,
  world: string,
  op:
    | {
        readonly op: "save";
        readonly name?: string;
        /** Into the slot kept for before a world update, named for it. */
        readonly beforeUpdate?: boolean;
      }
    | {
        readonly op: "load";
        readonly ref: string;
      },
): SaveRequest {
  if (isRunning(readRequest(world)))
    throw new Error("The world is already saving or loading.");
  let name: string | undefined;
  let ref: string | undefined;
  let kind: SaveKind | undefined;
  if (op.op === "load") {
    const save = findSave(git, op.ref);
    if (!save) throw new Error("That save is gone.");
    name = save.name ?? undefined;
    ref = save.ref;
  } else {
    if (existsSync(path.join(world, UPDATE_REPORT)))
      throw new Error(
        "A world update is still open. Finish it, or load a save, first.",
      );
    name = op.name?.replace(/\s+/g, " ").trim() || undefined;
    if (op.beforeUpdate) {
      const release = downloadedRelease(git);
      if (!release) throw new Error("There's no new version to update to.");
      name = `Before update to ${release.version}`;
      ref = BEFORE_UPDATE;
      kind = "autosave";
    }
  }
  const request: SaveRequest = {
    id: randomUUID(),
    op: op.op,
    ...(name ? { name } : {}),
    ...(ref ? { ref } : {}),
    ...(kind ? { kind } : {}),
    phase: "waiting",
    at: Date.now(),
  };
  writeRequest(world, request);
  return request;
}

/**
 * The save made for this update, if the player made one: the slot before an
 * update, standing on `base`, the commit the update starts from (`play` until
 * it moves).
 */
export function saveBeforeUpdate(
  git: Git,
  base = commitOf(git, PLAY),
): GameSave | undefined {
  const save = findSave(git, BEFORE_UPDATE);
  return save && save.base === base ? save : undefined;
}
