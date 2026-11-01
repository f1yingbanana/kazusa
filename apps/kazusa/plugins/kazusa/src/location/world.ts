import { existsSync, readdirSync, readFileSync, watch } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { readFrontmatter } from "../markdown/frontmatter.ts";
import type { LintFinding } from "../memory/lint.ts";
import { buildMap, parsePlace, type WorldMap } from "./map.ts";

/** The map plus where each participant lives. */
export interface World {
  readonly map: WorldMap;
  readonly homes: ReadonlyMap<string, string>;
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
 * Reads the World Wiki. Returns `undefined` for a world without places, and
 * throws for a broken map: that is an operator error, never a character's.
 */
export function loadWorld(wikiDir: string): World | undefined {
  const placesDir = path.join(wikiDir, "entities", "places");
  const files = markdownFiles(placesDir);
  if (files.length === 0) return undefined;
  const map = buildMap(
    files.map((file) => {
      try {
        return parsePlace(readFileSync(path.join(placesDir, file), "utf8"));
      } catch (error: unknown) {
        throw new Error(`Invalid place ${file}: ${String(error)}`, {
          cause: error,
        });
      }
    }),
  );
  const homes = new Map<string, string>();
  const charactersDir = path.join(wikiDir, "entities", "characters");
  for (const file of markdownFiles(charactersDir)) {
    const { data } = readFrontmatter(
      readFileSync(path.join(charactersDir, file), "utf8"),
      CHARACTER_HOME,
    );
    if (data.home === undefined) continue;
    if (!map.places.has(data.home)) {
      throw new Error(`Character ${file}: unknown home ${data.home}`);
    }
    homes.set(data.character_id ?? file.slice(0, -".md".length), data.home);
  }
  return { map, homes };
}

/** What keeps the map on disk from loading, for `wiki_lint`. */
export function lintMap(wikiDir: string): LintFinding[] {
  try {
    loadWorld(wikiDir);
    return [];
  } catch (error: unknown) {
    return [{ level: "error", page: "world/map", message: String(error) }];
  }
}

interface WorldHandlers {
  readonly warn: (message: string) => void;
  /** The map or a home changed on disk and is now in use. */
  readonly onChange: () => void;
}

interface WorldCell {
  world: World | undefined;
  handlers: WorldHandlers;
}

/**
 * Writes to these come in bursts (several pages for one new place, an editor's
 * temp-file rename), and a burst can be briefly inconsistent.
 */
const SETTLE_MS = 200;
const WORLD_CELLS = Symbol.for("kazusa.location.worlds");

function worldCells(): Map<string, WorldCell> {
  const scope = globalThis as { [WORLD_CELLS]?: Map<string, WorldCell> };
  return (scope[WORLD_CELLS] ??= new Map<string, WorldCell>());
}

/** Keeps the map in use when a change to it doesn't load. */
function refresh(cell: WorldCell, wikiDir: string): boolean {
  try {
    cell.world = loadWorld(wikiDir);
    return true;
  } catch (error: unknown) {
    cell.handlers.warn(
      `Location: keeping the current map, this change doesn't load: ${String(error)}`,
    );
    return false;
  }
}

function watchWiki(cell: WorldCell, wikiDir: string): void {
  if (!existsSync(wikiDir)) return;
  let settling: NodeJS.Timeout | undefined;
  try {
    watch(wikiDir, { recursive: true, persistent: false }, (_event, file) => {
      if (file && !/^entities[\\/](places|characters)[\\/]/.test(file)) return;
      clearTimeout(settling);
      settling = setTimeout(() => {
        if (refresh(cell, wikiDir)) cell.handlers.onChange();
      }, SETTLE_MS);
    }).on("error", (error) => {
      cell.handlers.warn(
        `Location: stopped watching the map: ${String(error)}`,
      );
    });
  } catch (error: unknown) {
    cell.handlers.warn(`Location: can't watch the map: ${String(error)}`);
  }
}

/**
 * The world as it is on disk now, so a new place needs no reload. The plugin
 * registers many times per process, and one watcher serves them all. Only the
 * first load throws: after that a broken edit must not stop every character.
 */
export function sharedWorld(
  wikiDir: string,
  handlers: WorldHandlers,
): () => World | undefined {
  const cells = worldCells();
  let cell = cells.get(wikiDir);
  if (cell) {
    cell.handlers = handlers;
    refresh(cell, wikiDir);
  } else {
    cell = { world: loadWorld(wikiDir), handlers };
    cells.set(wikiDir, cell);
    watchWiki(cell, wikiDir);
  }
  const current = cell;
  return () => current.world;
}
