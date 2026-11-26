import { legacyDepth, legacyPublic } from "./legacy.ts";
import { LEVELS, type Level, type Page } from "./page.ts";

/** Ordered: each depth also sees everything the ones before it see. */
export const DEPTHS = ["none", "heard of", "familiar", "intimate"] as const;
export type Depth = (typeof DEPTHS)[number];

export interface Knowledge {
  readonly depth: Depth;
  /** In the author's terms, for the explainer. */
  readonly why: string;
  /** The group they know it through, when that is all that connects them. */
  readonly through?: string;
}

const atLeast = (a: Knowledge, b: Knowledge): Knowledge =>
  DEPTHS.indexOf(b.depth) > DEPTHS.indexOf(a.depth) ? b : a;

/** The depth each level of a page's `groups` gives its members. */
/** The closer of two levels. */
const higher = (a: Level | undefined, b: Level): Level =>
  a !== undefined && LEVELS.indexOf(a) >= LEVELS.indexOf(b) ? a : b;

export const LEVEL_DEPTH: Readonly<Record<Level, Depth>> = {
  "heard of": "heard of",
  knows: "familiar",
  close: "intimate",
};

const normalize = (name: string): string =>
  name
    .toLowerCase()
    .replace(/^user:/, "")
    .trim();

/**
 * The canon as one character could know it: pages by id, names resolved, and
 * each page's chain of what it belongs to. Pure over the parsed world pages.
 */
export class WorldModel {
  readonly pages: ReadonlyMap<string, Page>;
  private readonly names = new Map<string, string[]>();
  /** Two pages with one id: only the last is reachable. */
  readonly duplicates: Array<readonly [string, string, string]> = [];

  constructor(pages: Iterable<Page>) {
    const byId = new Map<string, Page>();
    for (const page of pages) {
      const other = byId.get(page.id);
      if (other) this.duplicates.push([page.id, other.kind, page.kind]);
      byId.set(page.id, page);
    }
    this.pages = byId;
    for (const page of byId.values()) {
      for (const name of [page.id, page.name, ...page.aliases]) {
        const key = normalize(name);
        const owners = this.names.get(key) ?? [];
        if (!owners.includes(page.id)) owners.push(page.id);
        this.names.set(key, owners);
      }
    }
  }

  /** A page id from an id, name or alias; the first owner if several. */
  resolve(reference: string | undefined): string | undefined {
    if (!reference) return undefined;
    if (this.pages.has(reference)) return reference;
    // A page whose id is the name wins over another's alias.
    const key = normalize(reference);
    if (this.pages.has(key)) return key;
    return this.names.get(key)?.[0];
  }

  /**
   * Whether the world is in two folders, `characters/` and `concepts/`, and
   * says who knows its pages with `known` and `in`. One that isn't yet is read
   * the older way until it updates to a release in the two-folder layout.
   */
  get upgraded(): boolean {
    // Older only while pages still live where the older layout kept them: a new
    // world with no characters yet is in two folders all the same.
    this.isUpgraded ??= ![...this.pages.values()].some((page) =>
      /^(entities|groups)\//.test(page.path),
    );
    return this.isUpgraded;
  }
  private isUpgraded?: boolean;

  /** Resolves `reference` when it names a group page (`group: true`). */
  group(reference: string | undefined): string | undefined {
    const id = this.resolve(reference);
    return id && this.pages.get(id)?.group ? id : undefined;
  }

  /** Whether `look_up` finds it: everyone has heard of it. */
  isPublic(page: Page): boolean {
    if (page.kind === "day") return false;
    return this.upgraded ? page.everyone !== undefined : legacyPublic(page);
  }

  /** Aliases two pages claim, for lint. */
  collisions(): ReadonlyArray<readonly [string, readonly string[]]> {
    return [...this.names].filter(([, owners]) => owners.length > 1);
  }

  /**
   * The page, then every place it sits in. Only a place has an area; an older
   * world also reads `parent` on its other pages.
   */
  chain(id: string): ReadonlySet<string> {
    const seen = new Set<string>();
    for (let next: string | undefined = id; next && !seen.has(next);) {
      seen.add(next);
      const page = this.pages.get(next);
      next =
        page && (page.place || !this.upgraded)
          ? this.resolve(page.parent)
          : undefined;
    }
    return seen;
  }

  /** The groups a character is in (`in`), by page id, and how closely. */
  memberships(person: Page): ReadonlyMap<string, Level> {
    const groups = new Map<string, Level>();
    if (!this.upgraded) {
      // Older worlds: every group a character's `groups` names.
      for (const { ref, level } of person.legacyGroups) {
        const id = this.resolve(ref);
        if (id) groups.set(id, higher(groups.get(id), level));
      }
      return groups;
    }
    // A group named twice (its id and its name): the closer of the two.
    for (const { ref, level } of person.in) {
      const id = this.group(ref);
      if (id) groups.set(id, higher(groups.get(id), level));
    }
    return groups;
  }

  private homesOf?: ReadonlySet<string>;

  /** Every page someone lives in. */
  homes(): ReadonlySet<string> {
    this.homesOf ??= new Set(
      [...this.pages.values()]
        .map((page) => this.resolve(page.home))
        .filter((id): id is string => Boolean(id)),
    );
    return this.homesOf;
  }

  /** The cast in a group, by id. */
  members(groupId: string): string[] {
    return [...this.pages.values()]
      .filter((page) => page.kind === "person")
      .filter((page) => this.memberships(page).has(groupId))
      .map(({ id }) => id);
  }

  /** §3.3. `experienced`: the character has a personal page with this id. */
  depth(characterId: string, pageId: string, experienced = false): Knowledge {
    if (characterId === pageId)
      return { depth: "intimate", why: "this is them" };
    let best: Knowledge = experienced
      ? { depth: "familiar", why: "they have their own page on it" }
      : { depth: "none", why: "nothing connects them to it" };
    const page = this.pages.get(pageId);
    if (!page) return best;
    if (!this.upgraded) return legacyDepth(this, characterId, page, best);
    if (page.everyone)
      best = atLeast(best, {
        depth: LEVEL_DEPTH[page.everyone],
        why: "known to everyone",
      });
    const character = this.pages.get(characterId);
    if (!character) return best;
    const mine = this.memberships(character);
    const applyGroup = (
      groupId: string | undefined,
      ref: string,
      level: Level,
    ) => {
      const involved = groupId ? mine.get(groupId) : undefined;
      if (!groupId || !involved) return;
      const reach =
        LEVELS.indexOf(level) < LEVELS.indexOf(involved) ? level : involved;
      best = atLeast(best, {
        depth: LEVEL_DEPTH[reach],
        why: `in ${this.pages.get(groupId)?.name ?? ref}`,
        through: groupId,
      });
    };
    // Through each entry in `known`: either an individual named directly or a
    // group they belong to (capped by their involvement in that group).
    for (const { ref, level } of page.known) {
      const targetId = this.resolve(ref);
      const target = targetId ? this.pages.get(targetId) : undefined;
      if (targetId === characterId && target?.kind === "person") {
        best = atLeast(best, {
          depth: LEVEL_DEPTH[level],
          why: "known directly",
        });
      }
      if (target?.group) applyGroup(targetId, ref, level);
    }
    // A character's own groups know them as closely as they are in it.
    if (page.kind === "person") {
      for (const { ref, level } of page.in)
        applyGroup(this.group(ref), ref, level);
    }
    // A group they're in: as close as they are in it.
    const own = mine.get(pageId);
    if (own)
      best = atLeast(best, { depth: LEVEL_DEPTH[own], why: "they are in it" });
    // Their home, and all around it: the place it is in and what is in that;
    // someone else's home only when it is known as more than a name (a
    // guardhouse someone sleeps in, not their bedroom).
    const home = this.resolve(character.home);
    const around = this.resolve(this.pages.get(home ?? "")?.parent);
    if (home === pageId)
      best = atLeast(best, { depth: "intimate", why: "their home" });
    else if (
      around &&
      this.chain(pageId).has(around) &&
      (!this.homes().has(pageId) ||
        [...page.known.map(({ level }) => level), page.everyone].some(
          (level) => level === "knows" || level === "close",
        ))
    )
      best = atLeast(best, { depth: "intimate", why: "around their home" });
    return best;
  }

  /** The author's sanity check: how much of the world one character knows. */
  footprint(
    characterId: string,
    experienced: ReadonlySet<string> = new Set(),
  ): Readonly<Record<Depth, readonly string[]>> {
    const footprint: Record<Depth, string[]> = {
      none: [],
      "heard of": [],
      familiar: [],
      intimate: [],
    };
    for (const id of this.pages.keys()) {
      if (id === characterId) continue;
      footprint[this.depth(characterId, id, experienced.has(id)).depth].push(
        id,
      );
    }
    return footprint;
  }
}
