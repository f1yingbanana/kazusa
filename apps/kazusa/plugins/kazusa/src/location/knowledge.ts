import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { z } from "zod";
import { readFrontmatter } from "../markdown/frontmatter.ts";
import type { Place, WorldMap } from "./map.ts";

/** Personal wiki place cards: `<workspace>/wiki/entities/places/<id>.md`. */
const PLACE_CARD = z.object({
  place_id: z.string().optional(),
  aliases: z.array(z.string()).default([]),
});

export interface PlaceCard {
  readonly placeId: string;
  readonly aliases: readonly string[];
}

const cardsDir = (workspaceDir: string): string =>
  path.join(workspaceDir, "wiki", "entities", "places");

/** The character's mental map. Unreadable cards are skipped, never fatal. */
export async function readPlaceCards(
  workspaceDir: string,
  warn: (message: string) => void,
): Promise<PlaceCard[]> {
  const dir = cardsDir(workspaceDir);
  let files: string[];
  try {
    files = (await fs.readdir(dir)).filter((file) => file.endsWith(".md"));
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return [];
    throw error;
  }
  const cards = await Promise.all(
    files.sort().map(async (file): Promise<PlaceCard | undefined> => {
      try {
        const { data } = readFrontmatter(
          await fs.readFile(path.join(dir, file), "utf8"),
          PLACE_CARD,
        );
        return {
          placeId: data.place_id ?? file.slice(0, -".md".length),
          aliases: data.aliases,
        };
      } catch (error: unknown) {
        warn(`Location: unreadable place card ${file}: ${String(error)}`);
        return undefined;
      }
    }),
  );
  return cards.filter((card): card is PlaceCard => card !== undefined);
}

/**
 * Starts a card for a place the character has taken in, once they move on to
 * their next activity there. The character, or sleep consolidation, writes what
 * they make of it; an existing card is never touched.
 */
export async function writePlaceStub(
  workspaceDir: string,
  place: Place,
  at: number,
): Promise<boolean> {
  const dir = cardsDir(workspaceDir);
  const target = path.join(dir, `${place.id}.md`);
  try {
    await fs.access(target);
    return false;
  } catch {
    // No card yet.
  }
  await fs.mkdir(dir, { recursive: true });
  const frontmatter = YAML.stringify({
    pageType: "entity",
    entityType: "place",
    place_id: place.id,
    name: place.name,
    learned: "been there",
    first_visited_iso: new Date(at).toISOString(),
  });
  const temporary = path.join(dir, `.${place.id}.${randomUUID()}.tmp`);
  await fs.writeFile(temporary, `---\n${frontmatter}---\n`, { flag: "wx" });
  await fs.rename(temporary, target);
  return true;
}

/** Places whose name or alias appears in the text: heard of, if not known. */
export function placesNamedIn(map: WorldMap, text: string): string[] {
  const haystack = text.toLowerCase();
  if (!haystack) return [];
  return map.order.filter((id) => {
    const place = map.places.get(id)!;
    return [place.name, ...place.aliases].some(
      (name) => name.length >= 3 && haystack.includes(name.toLowerCase()),
    );
  });
}
