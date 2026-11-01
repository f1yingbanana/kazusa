import type { Page, Renown } from "./page.ts";

/** Ordered: each depth also sees everything the ones before it see. */
export const DEPTHS = ["none", "heard of", "familiar", "intimate"] as const;
export type Depth = (typeof DEPTHS)[number];

export interface Knowledge {
  readonly depth: Depth;
  /** In the author's terms, for the explainer. */
  readonly why: string;
}

const atLeast = (a: Knowledge, b: Knowledge): Knowledge =>
  DEPTHS.indexOf(b.depth) > DEPTHS.indexOf(a.depth) ? b : a;

const DEFAULT_RENOWN: Readonly<Record<Page["kind"], Renown>> = {
  place: "local",
  person: "local",
  concept: "known",
  day: "private",
};

const RENOWN_DEPTH: Readonly<Record<Renown, Depth>> = {
  private: "none",
  local: "none",
  known: "heard of",
  famous: "familiar",
};

const normalize = (name: string): string =>
  name
    .toLowerCase()
    .replace(/^user:/, "")
    .trim();

interface Anchor {
  readonly id: string;
  readonly depth: Depth;
  readonly why: string;
  /** Only this page, not what lies under it. */
  readonly exact?: boolean;
}

/**
 * Which fields on a character's card place them in the world, and how well that
 * makes them know what is under it. A world names its own: a city and a guild,
 * a company and a team.
 */
export type Anchors = Readonly<Record<string, Depth>>;
export const DEFAULT_ANCHORS: Anchors = {
  club: "intimate",
  school: "familiar",
};

/**
 * The canon as one character could know it: pages by id, names resolved, and
 * each page's chain of what it belongs to. Pure over the parsed world pages.
 */
export class WorldModel {
  readonly pages: ReadonlyMap<string, Page>;
  private readonly names = new Map<string, string[]>();
  readonly anchorFields: Anchors;
  /** Two pages with one id: only the last is reachable. */
  readonly duplicates: Array<readonly [string, string, string]> = [];

  constructor(pages: Iterable<Page>, anchors: Anchors = DEFAULT_ANCHORS) {
    this.anchorFields = anchors;
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
    return this.names.get(normalize(reference))?.[0];
  }

  /** Aliases two pages claim, for lint. */
  collisions(): ReadonlyArray<readonly [string, readonly string[]]> {
    return [...this.names].filter(([, owners]) => owners.length > 1);
  }

  /** The page, then everything it sits in: parents and communities. */
  chain(id: string): ReadonlySet<string> {
    const seen = new Set<string>();
    const queue = [id];
    while (queue.length) {
      const next = queue.shift()!;
      if (seen.has(next)) continue;
      seen.add(next);
      const page = this.pages.get(next);
      if (!page) continue;
      for (const up of [
        page.parent,
        page.community,
        ...(page.kind === "person"
          ? Object.keys(this.anchorFields).flatMap(
              (field) => page.fields[field] ?? [],
            )
          : []),
      ]) {
        const resolved = this.resolve(up);
        if (resolved) queue.push(resolved);
      }
    }
    return seen;
  }

  private anchors(character: Page): Anchor[] {
    const anchors: Anchor[] = [];
    for (const [field, depth] of Object.entries(this.anchorFields)) {
      for (const value of character.fields[field] ?? []) {
        const id = this.resolve(value);
        if (id) anchors.push({ id, depth, why: `their own ${field}` });
      }
    }
    const home = this.resolve(character.home);
    if (home) {
      const parent = this.resolve(this.pages.get(home)?.parent);
      // Living on a campus root makes that place home, not every room in it.
      anchors.push(
        parent
          ? { id: parent, depth: "intimate", why: "around their home" }
          : { id: home, depth: "intimate", why: "their home", exact: true },
      );
    }
    for (const [reference, depth] of Object.entries(character.knows)) {
      const id = this.resolve(reference);
      if (id && (DEPTHS as readonly string[]).includes(depth))
        anchors.push({
          id,
          depth: depth as Depth,
          why: `\`knows\` on their card`,
        });
    }
    return anchors;
  }

  /** §3.3. `experienced`: the character has a personal page with this id. */
  depth(characterId: string, pageId: string, experienced = false): Knowledge {
    const page = this.pages.get(pageId);
    if (characterId === pageId)
      return { depth: "intimate", why: "this is them" };
    const experience: Knowledge = experienced
      ? { depth: "familiar", why: "they have their own page on it" }
      : { depth: "none", why: "nothing connects them to it" };
    if (!page) return experience;
    if (page.knownBy.length) {
      return page.knownBy.includes(characterId)
        ? { depth: "intimate", why: "`known_by` names them" }
        : atLeast(
            { depth: "none", why: "`known_by` does not name them" },
            experience,
          );
    }
    const character = this.pages.get(characterId);
    const renown = page.renown ?? DEFAULT_RENOWN[page.kind];
    if (renown === "private") {
      return character && this.resolve(character.home) === pageId
        ? { depth: "intimate", why: "they live here" }
        : atLeast({ depth: "none", why: "private" }, experience);
    }
    let best = atLeast(
      {
        depth: RENOWN_DEPTH[renown],
        why: page.renown ? `renown ${renown}` : `default renown ${renown}`,
      },
      experience,
    );
    if (!character) return best;
    const chain = this.chain(pageId);
    // An author writing `local` means its own community, not the whole company.
    const nearest = this.resolve(page.community);
    const narrow = page.renown === "local" && nearest;
    for (const anchor of this.anchors(character)) {
      if (narrow && anchor.id !== nearest && anchor.id !== pageId) continue;
      if (anchor.exact ? anchor.id === pageId : chain.has(anchor.id))
        best = atLeast(best, { depth: anchor.depth, why: anchor.why });
    }
    return best;
  }

  /** Whether `##` section text is visible to this character at this depth. */
  sectionVisible(
    section: Page["sections"][number],
    characterId: string,
    depth: Depth,
  ): boolean {
    return section.knownBy.length
      ? section.knownBy.includes(characterId)
      : depth === "intimate";
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
