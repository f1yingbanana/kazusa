import { existsSync } from "node:fs";
import path from "node:path";

/*
 * Where a wiki keeps its pages: `characters/` and `concepts/`, a place being a
 * concept with the place component (`place_id`). A world in the older format
 * (deprecated) keeps `entities/characters/` and `entities/places/` instead,
 * until it updates to a release of its template in the two-folder layout.
 */

/** The folder of character pages, in either layout. */
export function charactersDir(wikiRoot: string): string {
  const older = path.join(wikiRoot, "entities", "characters");
  return !existsSync(path.join(wikiRoot, "characters")) && existsSync(older)
    ? older
    : path.join(wikiRoot, "characters");
}

/** A character's page, in either layout. */
export const characterFile = (wikiRoot: string, id: string): string =>
  path.join(charactersDir(wikiRoot), `${id.replace(/^user:/u, "")}.md`);

/** The folders that can hold place pages, in either layout. */
export function placeDirs(wikiRoot: string): string[] {
  return [
    path.join(wikiRoot, "concepts"),
    path.join(wikiRoot, "entities", "places"),
  ].filter((dir) => existsSync(dir));
}

/** Whether a page's text has the place component. */
export const hasPlace = (text: string): boolean =>
  /^---\r?\n[\s\S]*?^place_id:/mu.test(
    text.split(/\r?\n---(?:\r?\n|$)/u)[0] ?? "",
  );

/** Where a new place page goes: beside the others. */
export const newPlaceDir = (wikiRoot: string): string =>
  existsSync(path.join(wikiRoot, "characters")) ||
  !existsSync(path.join(wikiRoot, "entities"))
    ? path.join(wikiRoot, "concepts")
    : path.join(wikiRoot, "entities", "places");
