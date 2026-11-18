import type { Depth, Knowledge, WorldModel } from "./knowledge.ts";
import type { Page, Renown } from "./page.ts";

/*
 * Deprecated: how a world in the older format (pages under `entities/`) said
 * who knows a page (`renown`, `known_by`, groups a page sat in with its
 * parents). It is read this way until it updates to a release of its template
 * in the two-folder layout, so nobody knows less meanwhile. Remove once worlds
 * have updated.
 */

const DEFAULT_RENOWN: Readonly<Record<Page["kind"], Renown>> = {
  person: "local",
  concept: "known",
  day: "private",
};
/** What a page left unsaid meant: places were known to their own. */
const defaultRenown = (page: Page): Renown =>
  page.place ? "local" : DEFAULT_RENOWN[page.kind];

const RENOWN_DEPTH: Readonly<Record<Renown, Depth>> = {
  private: "none",
  local: "none",
  known: "heard of",
  famous: "familiar",
};

/** What a page written in levels meant the older way. */
const EVERYONE_RENOWN = {
  "heard of": "known",
  knows: "famous",
  close: "famous",
} as const;

const DEPTHS: readonly Depth[] = ["none", "heard of", "familiar", "intimate"];
const atLeast = (a: Knowledge, b: Knowledge): Knowledge =>
  DEPTHS.indexOf(b.depth) > DEPTHS.indexOf(a.depth) ? b : a;

interface Anchor {
  readonly id: string;
  readonly depth: Depth;
  readonly why: string;
  /** Only this page, not what lies under it. */
  readonly exact?: boolean;
  /** One of their groups, not their home. */
  readonly group?: boolean;
}

/** The page, then everything it sits in: parents and groups. */
function chain(world: WorldModel, id: string): ReadonlySet<string> {
  const seen = new Set<string>();
  const queue = [id];
  while (queue.length) {
    const next = queue.shift()!;
    if (seen.has(next)) continue;
    seen.add(next);
    const page = world.pages.get(next);
    if (!page) continue;
    for (const up of [
      page.parent,
      ...page.legacyGroups.map(({ ref }) => ref),
    ]) {
      const resolved = world.resolve(up);
      if (resolved) queue.push(resolved);
    }
  }
  return seen;
}

function anchors(world: WorldModel, character: Page): Anchor[] {
  const found: Anchor[] = [];
  for (const { ref, level } of character.legacyGroups) {
    const id = world.resolve(ref);
    if (id)
      found.push({
        id,
        depth: level === "close" ? "intimate" : "familiar",
        why: level === "close" ? `close in ${ref}` : `in ${ref}`,
        group: true,
      });
  }
  const home = world.resolve(character.home);
  if (home) {
    const parent = world.resolve(world.pages.get(home)?.parent);
    // Living on a campus root makes that place home, not every room in it.
    found.push(
      parent
        ? { id: parent, depth: "intimate", why: "around their home" }
        : { id: home, depth: "intimate", why: "their home", exact: true },
    );
  }
  return found;
}

/** A character's depth on a page, the older way. */
export function legacyDepth(
  world: WorldModel,
  characterId: string,
  page: Page,
  experience: Knowledge,
): Knowledge {
  if (page.knownBy.length)
    return page.knownBy.includes(characterId)
      ? { depth: "intimate", why: "`known_by` names them" }
      : atLeast(
          { depth: "none", why: "`known_by` does not name them" },
          experience,
        );
  const character = world.pages.get(characterId);
  const written =
    page.renown ?? (page.everyone ? EVERYONE_RENOWN[page.everyone] : undefined);
  const renown = written ?? defaultRenown(page);
  if (renown === "private")
    return character && world.resolve(character.home) === page.id
      ? { depth: "intimate", why: "they live here" }
      : atLeast({ depth: "none", why: "private" }, experience);
  let best = atLeast(
    {
      depth: RENOWN_DEPTH[renown],
      why: written ? `renown ${renown}` : `default renown ${renown}`,
    },
    experience,
  );
  if (!character) return best;
  const reach = chain(world, page.id);
  // An author writing `local` means its nearest group, not everything above.
  const nearest = world.resolve(page.legacyGroups[0]?.ref);
  const narrow = page.renown === "local" && nearest;
  for (const anchor of anchors(world, character)) {
    if (narrow && anchor.id !== nearest && anchor.id !== page.id) continue;
    if (anchor.exact ? anchor.id === page.id : reach.has(anchor.id))
      best = atLeast(best, {
        depth: anchor.depth,
        why: anchor.why,
        ...(anchor.group ? { through: anchor.id } : {}),
      });
  }
  return best;
}

/** Whether `look_up` finds it, the older way. */
export function legacyPublic(page: Page): boolean {
  if (page.knownBy.length) return false;
  const renown =
    page.renown ??
    (page.everyone ? EVERYONE_RENOWN[page.everyone] : undefined) ??
    defaultRenown(page);
  return renown === "known" || renown === "famous";
}
