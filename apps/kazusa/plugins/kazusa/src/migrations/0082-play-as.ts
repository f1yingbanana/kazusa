import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { StatRecord } from "@kazusa/client";
import { writeWhole } from "../editor/files.ts";
import type { Operator } from "../identity.ts";
import type { LocationRecord } from "../location/location.ts";
import type { FamiliarityRecord, Uses } from "../memory/familiarity.ts";
import type { StateStore } from "../state.ts";
import { characterFile, charactersDir } from "../wiki-layout.ts";
import type { Migration } from "./index.ts";

/**
 * #82, play as any character: the person at the keyboard (`user:<x>`) no longer
 * lives in the world; the character `<x>` whose World Wiki page was theirs
 * does, and the person plays them. What moves over from `user:<x>` to `<x>`:
 *
 * - The wikis: characters' `peer_id: user:<x>` lines go, `[[user:<x>]]` links
 *   point at `[[<x>]]`, and their own page no longer claims `user:<x>`;
 * - States others hold toward them;
 * - Where they were on the map, unless `<x>` is somewhere already;
 * - How familiar others are with them;
 * - And, in a world that was played this way, the person plays `<x>`.
 *
 * Not moved: chats with characters and their records in characters' ledgers.
 * Re-keying the message database and OpenClaw's session ledgers touches too
 * much to do safely; those chats stay readable, read-only, with everyone
 * else's.
 */
export interface PlayAsDeps {
  readonly operator: Operator;
  /** The World Wiki root (`shared/wiki`). */
  readonly worldWiki: string;
  /** Every character's own wiki folder. */
  readonly ownWikis: () => readonly string[];
  readonly isAgent: (id: string) => boolean;
  readonly stats: StateStore<StatRecord>;
  readonly locations: StateStore<LocationRecord>;
  readonly familiarity: StateStore<FamiliarityRecord>;
  /** Chats the operator is in besides their console: how the world was played. */
  readonly oldChats: () => Promise<number>;
  readonly playing: () => Promise<string | undefined>;
  readonly play: (id: string) => Promise<void>;
}

export function playAsMigration(deps: PlayAsDeps): Migration {
  return { id: "0082-play-as", run: () => migrate(deps) };
}

/**
 * The character whose page was the operator's: named after them, or claiming
 * them.
 */
export function characterOf(
  worldWiki: string,
  operator: string,
): string | undefined {
  const named = operator.replace(/^user:/, "");
  if (existsSync(characterFile(worldWiki, named))) return named;
  const dir = charactersDir(worldWiki);
  if (!existsSync(dir)) return undefined;
  const claim = new RegExp(
    `^character_id:\\s*["']?${escape(operator)}["']?\\s*$`,
    "m",
  );
  for (const file of readdirSync(dir))
    if (
      file.endsWith(".md") &&
      claim.test(readFileSync(path.join(dir, file), "utf8"))
    )
      return file.slice(0, -".md".length);
  return undefined;
}

async function migrate(deps: PlayAsDeps): Promise<string | undefined> {
  const { operator } = deps;
  const old = operator.id;
  const id = characterOf(deps.worldWiki, old);
  if (!id) return undefined;
  const done: string[] = [];

  let held = 0;
  for (const { key, value } of await deps.stats.entries()) {
    const toward = value.toward[old];
    if (!toward) continue;
    const { [old]: _gone, ...rest } = value.toward;
    await deps.stats.register(key, {
      ...value,
      toward: { ...rest, [id]: { ...toward, ...rest[id] } },
    });
    held++;
  }
  if (held) done.push(`states ${held} hold toward them`);

  const where = await deps.locations.lookup(old);
  if (where && !(await deps.locations.lookup(id))) {
    await deps.locations.register(id, {
      placeId: where.placeId,
      since: where.since,
    });
    done.push(`where they were`);
  }

  let familiar = 0;
  for (const { key, value } of await deps.familiarity.entries()) {
    const uses = value[old];
    if (!uses) continue;
    const { [old]: _gone, ...rest } = value;
    await deps.familiarity.register(key, {
      ...rest,
      [id]: rest[id] ? merged(rest[id], uses) : uses,
    });
    familiar++;
  }
  if (familiar) done.push(`${familiar} who know them`);

  // Played this way before: the person goes on as them.
  const played = Boolean(where) || (await deps.oldChats()) > 0;
  if (played && deps.isAgent(id) && !(await deps.playing())) {
    await deps.play(id);
    done.push(`the person plays ${id}`);
  }

  // Last: a page claiming `character_id: user:<x>` is how `<x>` is found, so
  // until everything above is done the claim stays, and a retry after a
  // failure finds them again.
  const pages = rewriteWikis([deps.worldWiki, ...deps.ownWikis()], old, id);
  if (pages) done.push(`${pages} wiki pages`);

  return done.length ? `${old} is ${id}: ${done.join(", ")}` : undefined;
}

/**
 * Points `old`'s mentions at `id` in every page under `roots`; how many
 * changed.
 */
function rewriteWikis(
  roots: readonly string[],
  old: string,
  id: string,
): number {
  const peer = new RegExp(
    `^peer_id:\\s*["']?${escape(old)}["']?\\s*\\r?\\n`,
    "gm",
  );
  const claim = new RegExp(
    `^character_id:\\s*["']?${escape(old)}["']?\\s*\\r?\\n`,
    "gm",
  );
  const link = new RegExp(`\\[\\[${escape(old)}(\\]\\]|\\|)`, "g");
  let changed = 0;
  for (const root of roots)
    for (const file of markdownUnder(root)) {
      const text = readFileSync(file, "utf8");
      const next = text
        .replace(peer, "")
        .replace(claim, "")
        .replace(link, `[[${id}$1`);
      if (next === text) continue;
      writeWhole(file, next);
      changed++;
    }
  return changed;
}

function markdownUnder(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith(".md"))
    .map((file) => path.join(root, file));
}

/** Two records of one person's uses as one. */
function merged(a: Uses, b: Uses): Uses {
  const [later, earlier] = a.since >= b.since ? [a, b] : [b, a];
  return {
    ...later,
    recent: [...earlier.recent, ...later.recent].sort((x, y) => x - y),
    count: a.count + b.count,
    first: Math.min(a.first, b.first),
  };
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
