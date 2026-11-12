import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, watch } from "node:fs";
import path from "node:path";
import { z, ZodError } from "zod";
import { readFrontmatter } from "../markdown/frontmatter.ts";
import type { LintFinding } from "../memory/lint.ts";
import {
  backdropsBeside,
  readBackdrops,
  type BackdropLibrary,
} from "../scene/backdrops.ts";
import {
  buildMap,
  parsePlace,
  type MapProblem,
  type Place,
  type WorldMap,
} from "./map.ts";

/** The map plus where each participant lives. */
export interface World {
  readonly map: WorldMap;
  readonly homes: ReadonlyMap<string, string>;
  /** Which place each page file holds, so an edited `place_id` is a rename. */
  readonly files: ReadonlyMap<string, string>;
  /** The map's own, and pages and homes it had to leave out. */
  readonly problems: readonly MapProblem[];
  /** The backdrop sets places can name (`shared/backdrops/`). */
  readonly backdrops: BackdropLibrary;
  /** Changes with any page or backdrop the map reads, and only then. */
  readonly version: string;
}

const CHARACTER_HOME = z.object({
  character_id: z.string().optional(),
  home: z.string().optional(),
});

const markdownFiles = (dir: string): string[] =>
  existsSync(dir)
    ? readdirSync(dir)
        .filter((file) => file.endsWith(".md"))
        .sort()
    : [];

/**
 * Reads the World Wiki, and the backdrop library its places name. Returns
 * `undefined` for a world without places. A broken page never stops the rest
 * loading: it is left out and named in `problems`.
 */
export function loadWorld(
  wikiDir: string,
  backdropsDir = backdropsBeside(wikiDir),
): World | undefined {
  const placesDir = path.join(wikiDir, "entities", "places");
  const problems: MapProblem[] = [];
  const files = new Map<string, string>();
  const places: Place[] = [];
  const version = createHash("sha256");
  const read = (dir: string, file: string): string => {
    const text = readFileSync(path.join(dir, file), "utf8");
    version.update(`${dir}/${file}\0${text}\0`);
    return text;
  };
  for (const file of markdownFiles(placesDir)) {
    try {
      const place = parsePlace(read(placesDir, file));
      places.push(place);
      files.set(file, place.id);
    } catch (error: unknown) {
      problems.push({
        place: file.slice(0, -".md".length),
        message: `left off the map, its front matter doesn't parse: ${error instanceof ZodError ? z.prettifyError(error) : String(error)}`,
      });
    }
  }
  // Pages, none of them usable: the map in use stays, and lint says why.
  if (places.length === 0 && problems.length > 0)
    throw new Error(
      `No place page loads:\n- ${problems.map(({ place, message }) => `${place}: ${message}`).join("\n- ")}`,
    );
  if (places.length === 0) return undefined;
  const backdrops = readBackdrops(backdropsDir);
  version.update(`${backdropsDir}\0${backdrops.key}\0`);
  const map = buildMap(places, new Set(backdrops.sets.keys()));
  problems.push(...map.problems);
  const homes = new Map<string, string>();
  const charactersDir = path.join(wikiDir, "entities", "characters");
  for (const file of markdownFiles(charactersDir)) {
    let data: z.infer<typeof CHARACTER_HOME>;
    try {
      ({ data } = readFrontmatter(read(charactersDir, file), CHARACTER_HOME));
    } catch {
      // The card's own lint says what is wrong with it.
      continue;
    }
    if (data.home === undefined) continue;
    const id = data.character_id ?? file.slice(0, -".md".length);
    if (!map.places.has(data.home)) {
      problems.push({
        message: `${id}'s home ${data.home} isn't on the map, so they have none for now`,
      });
      continue;
    }
    homes.set(id, data.home);
  }
  return {
    map,
    homes,
    files,
    problems,
    backdrops,
    version: version.digest("hex"),
  };
}

/** What's wrong with the map on disk, for `wiki_lint`. */
export function lintMap(wikiDir: string): LintFinding[] {
  try {
    return (loadWorld(wikiDir)?.problems ?? []).map(({ place, message }) => ({
      level: "error",
      page: place === undefined ? "world/map" : `world/${place}`,
      message,
    }));
  } catch (error: unknown) {
    return [{ level: "error", page: "world/map", message: String(error) }];
  }
}

/** What a reload changed, for whoever stands somewhere that's gone. */
export interface WorldChange {
  readonly before: World | undefined;
  readonly after: World | undefined;
  /** Old place id to new, for places that kept going under a new id. */
  readonly renames: ReadonlyMap<string, string>;
}

interface WorldHandlers {
  readonly warn: (message: string) => void;
  /** The map or a home changed on disk and is now in use. */
  readonly onChange: (change: WorldChange) => void;
}

interface WorldCell {
  world: World | undefined;
  handlers: WorldHandlers;
  /** Renames announced before their files land: `{ old: new }`. */
  readonly pendingRenames: Map<string, string>;
  /** Problems last logged, so an unchanged one isn't logged per reload. */
  logged: string;
}

/**
 * Writes to these come in bursts (several pages for one new place, an editor's
 * temp-file rename), and a burst can be briefly inconsistent.
 */
const SETTLE_MS = 200;
const WORLD_CELLS = Symbol.for("kazusa.location.world-cells");

function worldCells(): Map<string, WorldCell> {
  const scope = globalThis as { [WORLD_CELLS]?: Map<string, WorldCell> };
  return (scope[WORLD_CELLS] ??= new Map<string, WorldCell>());
}

/**
 * Places gone under one id and present under another: a page whose `place_id`
 * was edited, or a rename announced ahead of its files.
 */
function renamesBetween(
  cell: WorldCell,
  before: World | undefined,
  after: World | undefined,
): Map<string, string> {
  const renames = new Map<string, string>();
  if (!before || !after) return renames;
  const gone = (id: string) => !after.map.places.has(id);
  const added = (id: string) =>
    after.map.places.has(id) && !before.map.places.has(id);
  for (const [from, to] of cell.pendingRenames) {
    if (!gone(from) || !after.map.places.has(to)) continue;
    renames.set(from, to);
    cell.pendingRenames.delete(from);
  }
  for (const [file, from] of before.files) {
    const to = after.files.get(file);
    if (to !== undefined && to !== from && gone(from) && added(to))
      renames.set(from, to);
  }
  return renames;
}

/** Reads the map again; an unreadable folder keeps the one in use. */
function refresh(cell: WorldCell, wikiDir: string): void {
  const before = cell.world;
  try {
    cell.world = loadWorld(wikiDir);
  } catch (error: unknown) {
    cell.handlers.warn(
      `Location: keeping the current map, the new one doesn't load: ${String(error)}`,
    );
    return;
  }
  const problems = (cell.world?.problems ?? [])
    .map(({ place, message }) => `${place ?? "map"}: ${message}`)
    .join("\n- ");
  if (problems && problems !== cell.logged)
    cell.handlers.warn(`Location: the map works around:\n- ${problems}`);
  cell.logged = problems;
  const renames = renamesBetween(cell, before, cell.world);
  // The first load counts as a change: places may have gone while stopped.
  if (before?.version !== cell.world?.version || renames.size > 0)
    cell.handlers.onChange({ before, after: cell.world, renames });
}

/**
 * Watches the wiki's places and characters, and the backdrop library beside it,
 * from the moment that library appears if it isn't there at start (the first
 * import usually runs with the Gateway up).
 */
function watchWiki(cell: WorldCell, wikiDir: string): void {
  let settling: NodeJS.Timeout | undefined;
  const settle = (): void => {
    clearTimeout(settling);
    settling = setTimeout(() => refresh(cell, wikiDir), SETTLE_MS);
  };
  const follow = (
    dir: string,
    what: string,
    relevant: (file: string) => boolean,
  ): void => {
    if (!existsSync(dir)) {
      awaitFolder(dir, what, () => {
        settle();
        follow(dir, what, relevant);
      });
      return;
    }
    try {
      watch(dir, { recursive: true, persistent: false }, (_event, file) => {
        if (file && !relevant(file)) return;
        settle();
      }).on("error", (error) => {
        cell.handlers.warn(
          `Location: stopped watching the ${what}: ${String(error)}`,
        );
      });
    } catch (error: unknown) {
      cell.handlers.warn(`Location: can't watch the ${what}: ${String(error)}`);
    }
  };
  /** Calls `then` once when `dir` appears in its parent, if the parent is there. */
  const awaitFolder = (dir: string, what: string, then: () => void): void => {
    const parent = path.dirname(dir);
    if (!existsSync(parent)) return;
    try {
      const watcher = watch(parent, { persistent: false }, (_event, file) => {
        if (file !== path.basename(dir) || !existsSync(dir)) return;
        watcher.close();
        then();
      }).on("error", () => watcher.close());
      // Made between the check above and the watch: no event will come.
      if (existsSync(dir)) {
        watcher.close();
        then();
      }
    } catch (error: unknown) {
      cell.handlers.warn(
        `Location: can't wait for the ${what} folder: ${String(error)}`,
      );
    }
  };
  follow(wikiDir, "map", (file) =>
    /^entities[\\/](places|characters)[\\/]/.test(file),
  );
  follow(backdropsBeside(wikiDir), "backdrops", () => true);
}

export interface SharedWorld {
  /** The world in use now. */
  (): World | undefined;
  /** Reads the map now, without waiting for the watcher. */
  reload(): void;
  /**
   * The place `from` goes on as `to`: whoever is there stays, once the files
   * say so. Call before writing them; the result takes it back.
   */
  expectRename(from: string, to: string): () => void;
}

/**
 * The world as it is on disk now, so a new place needs no reload. The plugin
 * registers many times per process, and one watcher serves them all.
 */
export function sharedWorld(
  wikiDir: string,
  handlers: WorldHandlers,
): SharedWorld {
  const cells = worldCells();
  let cell = cells.get(wikiDir);
  if (cell) {
    cell.handlers = handlers;
  } else {
    cell = {
      world: undefined,
      handlers,
      pendingRenames: new Map(),
      logged: "",
    };
    cells.set(wikiDir, cell);
    watchWiki(cell, wikiDir);
  }
  refresh(cell, wikiDir);
  const current = cell;
  return Object.assign(() => current.world, {
    reload: () => {
      refresh(current, wikiDir);
    },
    expectRename: (from: string, to: string) => {
      current.pendingRenames.set(from, to);
      return () => {
        if (current.pendingRenames.get(from) === to)
          current.pendingRenames.delete(from);
      };
    },
  });
}
