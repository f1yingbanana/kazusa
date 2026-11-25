/**
 * Ranking for the ⌘K palette: what someone most likely meant by what they
 * typed. How well the name matches comes first; what kind of thing it is only
 * breaks ties within a tier, so an exact place beats a character whose name
 * merely contains the words.
 */

/** What a result is, which also says how wanted it usually is. */
export type ResultKind =
  "character" | "chat" | "place" | "group" | "command" | "page" | "observed";

/**
 * Within one tier of match: the cast first (the world is about them, and people
 * who have a page but aren't simulated read as characters too), then your own
 * conversations, then groups (the factions a world is organised around: few,
 * and what a bare faction name usually means), then places (hundreds, and often
 * named after the group they belong to), then the app's own sections and
 * settings, then lore, and others' conversations last: there are hundreds, and
 * every name is in some. Someone only watching has no conversations of their
 * own, so for them others' take that place (`weights`).
 */
export const KIND_WEIGHT: Readonly<Record<ResultKind, number>> = {
  character: 9,
  chat: 8,
  group: 7,
  place: 6,
  command: 5,
  page: 4,
  observed: 2,
};

/** Tiers, far enough apart that kind and boost never cross them. */
const TIER = {
  exact: 600,
  start: 500,
  words: 400,
  inside: 300,
  context: 150,
} as const;

export interface SearchEntry {
  /** Unique across all entries. */
  readonly key: string;
  readonly kind: ResultKind;
  readonly name: string;
  /** Other names it goes by; matched like the name, a little lower. */
  readonly aliases?: readonly string[];
  /**
   * Text about it that isn't a name (a summary, the area a place is in, the
   * people in a chat): a match here only counts when nothing better does.
   */
  readonly context?: readonly string[];
  /**
   * Small nudge within a tier and kind, between -1 and 1: watched or offstage,
   * a larger area over a room in it, a talk going on now over one that ended.
   */
  readonly boost?: number;
}

export interface RankedEntry<E extends SearchEntry = SearchEntry> {
  readonly entry: E;
  readonly score: number;
  /** The match was on its name or an alias, not only on its context. */
  readonly named: boolean;
}

/**
 * Lowercase, compatibility forms folded (full-width letters, ligatures), and
 * accents dropped from Latin letters only: kana keep their marks.
 */
export function normalize(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/(\p{Script=Latin})\p{M}+/gu, "$1")
    .normalize("NFC")
    .toLowerCase()
    .replace(/[\s_-]+/g, " ")
    .trim();
}

/** `[[id|words]]` reads as its words, `[[id]]` as the id spelled out. */
export function plainLinks(text: string): string {
  return text.replace(
    /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
    (_, id: string, words?: string) => words ?? id.replace(/[_-]+/g, " "),
  );
}

function words(text: string): string[] {
  return text.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/** Every query word starts some word of the text. */
function wordsStart(query: readonly string[], text: string): boolean {
  const own = words(text);
  return query.every((q) => own.some((word) => word.startsWith(q)));
}

/** How well one name matches, as a tier, or 0. */
function nameTier(query: string, tokens: readonly string[], name: string) {
  if (!name) return 0;
  if (name === query) return TIER.exact;
  if (name.startsWith(query)) return TIER.start;
  if (tokens.length && wordsStart(tokens, name)) return TIER.words;
  if (name.includes(query)) return TIER.inside;
  return 0;
}

interface Prepared {
  readonly name: string;
  readonly aliases: readonly string[];
  readonly context: string;
}

/** Entries are rebuilt only when the data changes; keystrokes reuse these. */
const prepared = new WeakMap<SearchEntry, Prepared>();

function prepare(entry: SearchEntry): Prepared {
  let ready = prepared.get(entry);
  if (!ready) {
    ready = {
      name: normalize(entry.name),
      aliases: (entry.aliases ?? []).map(normalize),
      context: normalize(plainLinks((entry.context ?? []).join(" "))),
    };
    prepared.set(entry, ready);
  }
  return ready;
}

/** The entry's score for an already normalized query, or 0 for no match. */
function scoreEntry(
  query: string,
  tokens: readonly string[],
  entry: SearchEntry,
  weights: Readonly<Record<ResultKind, number>>,
): { score: number; named: boolean } {
  const { name, aliases, context } = prepare(entry);
  const byName = nameTier(query, tokens, name);
  const byAlias = Math.max(
    0,
    ...aliases.map((alias) => nameTier(query, tokens, alias) - 5),
  );
  let tier = Math.max(byName, byAlias);
  const named = tier > 0;
  if (!named) {
    if (tokens.length && wordsStart(tokens, context)) tier = TIER.context;
    else if (context.includes(query)) tier = TIER.context - 50;
  }
  if (!tier) return { score: 0, named };
  const boost = Math.max(-1, Math.min(1, entry.boost ?? 0));
  return { score: tier + weights[entry.kind] * 10 + boost * 5, named };
}

/**
 * Matches for `query`, best first; ties go to the shorter, then the A–Z name.
 * `weights` replaces how wanted some kinds are, for one kind of viewer.
 */
export function rank<E extends SearchEntry>(
  query: string,
  entries: readonly E[],
  weights?: Partial<Record<ResultKind, number>>,
): RankedEntry<E>[] {
  const q = normalize(query);
  if (!q) return [];
  const tokens = words(q);
  const kinds = { ...KIND_WEIGHT, ...weights };
  const found: RankedEntry<E>[] = [];
  for (const entry of entries) {
    const { score, named } = scoreEntry(q, tokens, entry, kinds);
    if (score > 0) found.push({ entry, score, named });
  }
  return found.sort(
    (a, b) =>
      b.score - a.score ||
      a.entry.name.length - b.entry.name.length ||
      a.entry.name.localeCompare(b.entry.name),
  );
}

export interface ResultGroup<E extends SearchEntry = SearchEntry> {
  readonly kind: ResultKind;
  readonly results: readonly RankedEntry<E>[];
  /** Matches left out past the group's limit. */
  readonly more: number;
}

/** How many of each kind the palette shows at most. */
export const GROUP_LIMITS: Record<ResultKind, number> = {
  character: 8,
  chat: 6,
  place: 8,
  group: 5,
  command: 6,
  page: 5,
  observed: 5,
};

/**
 * Ranked matches by kind, each kind capped, the kinds ordered by their best
 * match: the group holding the top result comes first.
 */
export function groupRanked<E extends SearchEntry>(
  ranked: readonly RankedEntry<E>[],
  limits: Record<ResultKind, number> = GROUP_LIMITS,
): ResultGroup<E>[] {
  const byKind = new Map<ResultKind, RankedEntry<E>[]>();
  for (const one of ranked) {
    const list = byKind.get(one.entry.kind);
    if (list) list.push(one);
    else byKind.set(one.entry.kind, [one]);
  }
  // `ranked` is best first, so each list is too, and so is Map order.
  return [...byKind].map(([kind, all]) => ({
    kind,
    results: all.slice(0, limits[kind]),
    more: Math.max(0, all.length - limits[kind]),
  }));
}
