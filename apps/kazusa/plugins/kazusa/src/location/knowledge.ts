import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { newPlaceDir, placeDirs } from "../wiki-layout.ts";
import YAML from "yaml";
import { z } from "zod";
import { readFrontmatter } from "../markdown/frontmatter.ts";
import type { Place, WorldMap } from "./map.ts";

/** Personal wiki place cards: their page on a place, in either layout. */
const PLACE_CARD = z.object({
  place_id: z.string().optional(),
  aliases: z.array(z.string()).default([]),
});

export interface PlaceCard {
  readonly placeId: string;
  readonly aliases: readonly string[];
}

const cardsDir = (workspaceDir: string): string =>
  newPlaceDir(path.join(workspaceDir, "wiki"));

/** The character's mental map. Unreadable cards are skipped, never fatal. */
export async function readPlaceCards(
  workspaceDir: string,
  warn: (message: string) => void,
): Promise<PlaceCard[]> {
  const files: string[] = [];
  for (const dir of placeDirs(path.join(workspaceDir, "wiki"))) {
    try {
      for (const file of await fs.readdir(dir))
        if (file.endsWith(".md")) files.push(path.join(dir, file));
    } catch (error: unknown) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT")
        continue;
      throw error;
    }
  }
  // Their pages on anything: the map keeps those on its places.
  const cards = await Promise.all(
    files.sort().map(async (filePath): Promise<PlaceCard | undefined> => {
      const file = path.basename(filePath);
      try {
        const { data } = readFrontmatter(
          await fs.readFile(filePath, "utf8"),
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
