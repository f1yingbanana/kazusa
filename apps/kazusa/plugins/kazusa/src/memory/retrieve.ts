import { DEPTHS, type Depth, type Knowledge } from "./knowledge.ts";
import { personalScope, type MemoryIndex, type SearchHit } from "./index.ts";
import { NAME_LIKE_WORDS, STOPWORDS } from "./index.ts";
import type { HistoryLine, Note, Page } from "./page.ts";
import { ONLY_WHAT_YOU_KNOW } from "../turn.ts";

export interface RetrievalRequest {
  readonly agentId: string;
  /** What is happening to them now: the stimulus. */
  readonly stimulus: string;
  /** Lower-weight text to recognize names in: task, recent records. */
  readonly background?: string;
  /** Ids in front of them: people here, senders, the current place. */
  readonly seeds?: readonly string[];
  /** People they owe a reply: on their mind, but not who they face now. */
  readonly unanswered?: readonly string[];
  /**
   * What is physically in front of them. Contact shows a stranger's lead and an
   * unknown place, whatever their depth.
   */
  readonly contact?: readonly string[];
  /** The stimulus as a vector; absent means keywords only. */
  readonly queryVector?: Float32Array;
  /** Sim time, for what counts as recent. */
  readonly now: number;
}

export type Signal =
  "seed" | "mention" | "keyword" | "semantic" | "news" | "graph" | "salience";

/** A personal page and the world page with one id, as one thing they know. */
export interface Entity {
  readonly id: string;
  readonly personal?: Page;
  readonly world?: Page;
  readonly knowledge: Knowledge;
  readonly signals: readonly Signal[];
  readonly score: number;
  /** The text that brought it up, when it isn't already its lead. */
  readonly matched?: string;
  /** Dated world events they have seen or heard, newest first. */
  readonly history: readonly HistoryLine[];
}

const WEIGHTS: Readonly<Record<Signal, number>> = {
  seed: 4,
  mention: 3,
  keyword: 1.5,
  semantic: 1.5,
  news: 1,
  graph: 1,
  salience: 0.5,
};
const RANK_CONSTANT = 10;
/** Keyword hits this far below the best are noise. */
const KEYWORD_FLOOR = 0.3;
const MAX_KEYWORD_PAGES = 8;
const PERSONAL_BOOST = 1.5;
/** Below this cosine, text-embedding-3-small is mostly finding shared register. */
const SEMANTIC_FLOOR = 0.38;
const MAX_SEMANTIC_PAGES = 6;
const MAX_GRAPH_PER_SOURCE = 4;
const RECENT_MS = 3 * 86_400_000;
const MAX_NEWS_PAGES = 2;

const isOrdinaryWord = (word: string): boolean =>
  STOPWORDS.has(word) || NAME_LIKE_WORDS.has(word);

const normalized = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

const isLatin = (text: string): boolean =>
  /^[\p{Script=Latin}\p{N} ]+$/u.test(text);

/** A person's name works by first or family name alone, written capitalized. */
function namesOf(page: Page): Array<{ name: string; capitalized: boolean }> {
  const names = [page.name, ...page.aliases].map((name) => ({
    name,
    capitalized: false,
  }));
  // A one-word id is an ordinary word until someone writes it as a name.
  names.push({ name: page.id, capitalized: !/[-_]/.test(page.id) });
  if (page.kind === "person") {
    for (const part of page.name.split(/\s+/)) {
      if (part !== page.name) names.push({ name: part, capitalized: true });
    }
  }
  return names;
}

/** Who and what this text names, most mentions first. */
export function mentionsIn(text: string, candidates: Iterable<Page>): string[] {
  const exact = new Map<string, Set<string>>();
  const capitalized = new Map<string, Set<string>>();
  /** Too short to trust unless written exactly so, like `HQ`. */
  const verbatim = new Map<string, Set<string>>();
  const nonLatin: Array<[string, string]> = [];
  for (const page of candidates) {
    for (const { name, capitalized: needsCapital } of namesOf(page)) {
      const key = normalized(name);
      if (key.length < 2) continue;
      if (!isLatin(key)) {
        if (key.length >= 2) nonLatin.push([key, page.id]);
        continue;
      }
      if (key.length < 3) {
        if (/^\p{Lu}+$/u.test(name)) {
          const owners = verbatim.get(name) ?? new Set<string>();
          owners.add(page.id);
          verbatim.set(name, owners);
        }
        continue;
      }
      const map = needsCapital ? capitalized : exact;
      const owners = map.get(key) ?? new Set<string>();
      owners.add(page.id);
      map.set(key, owners);
    }
  }
  const counts = new Map<string, number>();
  const hit = (id: string): void => {
    counts.set(id, (counts.get(id) ?? 0) + 1);
  };
  const words = [...text.matchAll(/[\p{L}\p{N}]+/gu)].map((match) => ({
    word: match[0],
    lower: match[0].toLowerCase(),
    startsSentence:
      match.index === 0 || /[.!?\n]\s*$/.test(text.slice(0, match.index)),
  }));
  for (let start = 0; start < words.length; start++) {
    for (let size = 5; size >= 1; size--) {
      if (start + size > words.length) continue;
      const span = words.slice(start, start + size);
      const key = span.map(({ lower }) => lower).join(" ");
      const owners = exact.get(key);
      if (owners) {
        for (const id of owners) hit(id);
        start += size - 1;
        break;
      }
      if (size !== 1) continue;
      const [only] = span;
      for (const id of verbatim.get(only.word) ?? []) hit(id);
      if (
        !/^\p{Lu}/u.test(only.word) ||
        (only.startsSentence && isOrdinaryWord(only.lower))
      )
        continue;
      for (const id of capitalized.get(key) ?? []) hit(id);
    }
  }
  const flat = normalized(text);
  for (const [key, id] of nonLatin) if (flat.includes(key)) hit(id);
  return [...counts]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([id]) => id);
}

/** What was actually said: the words of each line, without its envelope. */
export function spokenText(stimulus: string): string {
  return stimulus
    .split(/\r?\n/)
    .filter(
      (line) =>
        !/^[A-Z][^:]{0,40}:$/.test(line.trim()) && line !== ONLY_WHAT_YOU_KNOW,
    )
    .map((line) => line.replace(/^\s*-\s*\[[^\]]*\]\s*(?:\([^)]*\))?:?\s*/, ""))
    .join("\n");
}

/** Who sent the lines of a delivery, from `- [Name \`id` time] …`. */
export function sendersOf(stimulus: string): string[] {
  return [
    ...new Set(
      [
        ...stimulus.matchAll(/^\s*-\s*\[[^\]`]*`((?:user:)?[^`]+)`[^\]]*\]/gm),
      ].map((match) => match[1]),
    ),
  ];
}

const notesByDate = (page: Page): Note[] =>
  [...page.notes].sort((a, b) => b.date.localeCompare(a.date));

const stripPlayerPrefix = (id: string): string => id.replace(/^user:/, "");

/**
 * Prefetch (memory.md §7.2): deterministic, no model, no tool. Every signal
 * only ever sees what this character could know.
 */
export function retrieve(
  index: MemoryIndex,
  request: RetrievalRequest,
): Entity[] {
  const { agentId } = request;
  const world = index.world();
  const personal = index.personal(agentId);
  const scope = personalScope(agentId);

  const contact = new Set((request.contact ?? []).map(stripPlayerPrefix));
  const knowledgeOf = (id: string): Knowledge => {
    const known = world.depth(agentId, id, personal.has(id));
    return contact.has(id) && DEPTHS.indexOf(known.depth) < 2
      ? { depth: "familiar", why: "it is right in front of them" }
      : known;
  };
  const today = new Date(request.now).toISOString().slice(0, 10);
  /** News once it breaks, and what they have been there to see. */
  const heardOf = (pageId: string, line: HistoryLine): boolean => {
    if (line.date > today) return false;
    const seen = personal.get(pageId)?.seen;
    if (seen && line.date <= seen) return true;
    return line.news && knowledgeOf(pageId).depth !== "none";
  };
  const eligible = (id: string): boolean =>
    id !== agentId &&
    (personal.has(id) ||
      (world.pages.has(id) && knowledgeOf(id).depth !== "none"));
  const pageOf = (id: string): Page | undefined =>
    personal.get(id) ?? world.pages.get(id);

  const lists = new Map<Signal, string[]>();
  const matched = new Map<string, string>();

  lists.set(
    "seed",
    [...new Set((request.seeds ?? []).map(stripPlayerPrefix))].filter(
      (id) => pageOf(id) && eligible(id),
    ),
  );

  const candidates = new Map<string, Page>();
  for (const page of world.pages.values()) {
    if (eligible(page.id)) candidates.set(page.id, page);
  }
  for (const page of personal.values()) {
    // Their own name for a thing and the world's both bring it to mind.
    const worldPage = world.pages.get(page.id);
    candidates.set(
      page.id,
      worldPage
        ? {
            ...page,
            aliases: [
              ...new Set([
                ...page.aliases,
                ...worldPage.aliases,
                worldPage.name,
              ]),
            ],
          }
        : page,
    );
  }
  const backticked = [
    ...`${request.stimulus}\n${request.background ?? ""}`.matchAll(
      /`((?:user:)?[a-z0-9][a-z0-9_-]*)`/g,
    ),
  ].map((match) => stripPlayerPrefix(match[1]));
  lists.set("mention", [
    ...new Set([
      ...mentionsIn(spokenText(request.stimulus), candidates.values()),
      ...backticked.filter((id) => pageOf(id) && eligible(id)),
      ...mentionsIn(request.background ?? "", candidates.values()),
    ]),
  ]);

  // Keywords: only chunks this character's depth lets them read.
  const visible = (hit: SearchHit): boolean => {
    if (hit.scope === scope) return true;
    if (hit.pageId === agentId) return false;
    if (hit.layer === "H")
      return heardOf(hit.pageId, {
        date: hit.date ?? "",
        news: hit.news ?? false,
        text: hit.text,
      });
    if (hit.knownBy.length) return hit.knownBy.includes(agentId);
    const depth = knowledgeOf(hit.pageId).depth;
    const needed: Depth =
      hit.layer === "L0"
        ? "heard of"
        : hit.layer === "L1"
          ? "familiar"
          : "intimate";
    return DEPTHS.indexOf(depth) >= DEPTHS.indexOf(needed);
  };
  // Their own mind answers before common knowledge does.
  const hits = index
    .search(agentId, spokenText(request.stimulus))
    .filter(visible)
    .map((hit) =>
      hit.scope === scope ? { ...hit, score: hit.score * PERSONAL_BOOST } : hit,
    )
    .sort((a, b) => b.score - a.score);
  const best = hits[0]?.score ?? 0;
  const keywords: string[] = [];
  for (const hit of hits) {
    if (hit.score < best * KEYWORD_FLOOR) break;
    if (!keywords.includes(hit.pageId)) {
      if (keywords.length >= MAX_KEYWORD_PAGES) continue;
      keywords.push(hit.pageId);
    }
    // A page's name matching should not hide the detail that matched too.
    if (hit.layer !== "L0" && !matched.has(hit.pageId))
      matched.set(hit.pageId, hit.text);
  }
  lists.set("keyword", keywords);

  if (request.queryVector) {
    const semantic: string[] = [];
    for (const hit of index
      .nearest(agentId, request.queryVector)
      .filter(visible)) {
      if (hit.score < SEMANTIC_FLOOR) break;
      if (semantic.includes(hit.pageId)) continue;
      semantic.push(hit.pageId);
      if (!matched.has(hit.pageId) && hit.layer !== "L0")
        matched.set(hit.pageId, hit.text);
      if (semantic.length >= MAX_SEMANTIC_PAGES) break;
    }
    lists.set("semantic", semantic);
  }

  // Graph: one hop from what is already in front of them, their own links first.
  const sources = [
    ...(lists.get("seed") ?? []),
    ...(lists.get("mention") ?? []),
  ];
  const graph: string[] = [];
  for (const source of new Set(sources)) {
    const own = personal.get(source);
    const canon = world.pages.get(source);
    const neighbors = [
      ...(own?.links ?? []),
      ...(own?.touched ?? []),
      ...(canon?.parent ? [canon.parent] : []),
      ...[...personal.values()]
        .filter(
          (page) =>
            page.links.includes(source) || page.touched.includes(source),
        )
        .map((page) => page.id),
    ]
      .map((reference) => world.resolve(reference) ?? reference)
      .filter((id) => id !== source && pageOf(id) && eligible(id));
    graph.push(...[...new Set(neighbors)].slice(0, MAX_GRAPH_PER_SOURCE));
  }
  lists.set("graph", [...new Set(graph)]);

  // Salience: what is unfinished or recent in their own mind.
  const recentSince = new Date(request.now - RECENT_MS)
    .toISOString()
    .slice(0, 10);
  lists.set("salience", [
    ...new Set([
      ...(request.unanswered ?? [])
        .map(stripPlayerPrefix)
        .filter((id) => pageOf(id) && eligible(id)),
      ...[...personal.values()]
        .filter(
          (page) =>
            page.openThreads.length > 0 ||
            (notesByDate(page)[0]?.date ?? "") >= recentSince,
        )
        .sort(
          (a, b) =>
            (notesByDate(b)[0]?.date ?? "").localeCompare(
              notesByDate(a)[0]?.date ?? "",
            ) || b.openThreads.length - a.openThreads.length,
        )
        .map((page) => page.id),
    ]),
  ]);

  // News finds them whether or not anyone mentions it.
  lists.set(
    "news",
    [...world.pages.values()]
      .flatMap((page) =>
        page.history
          .filter(
            (line) =>
              line.news && line.date >= recentSince && heardOf(page.id, line),
          )
          .map((line) => ({ id: page.id, date: line.date })),
      )
      .filter(({ id }) => eligible(id))
      .sort((a, b) => b.date.localeCompare(a.date))
      .map(({ id }) => id)
      .filter((id, at, ids) => ids.indexOf(id) === at)
      .slice(0, MAX_NEWS_PAGES),
  );

  const scores = new Map<string, number>();
  const signals = new Map<string, Signal[]>();
  for (const [signal, ids] of lists) {
    ids.forEach((id, rank) => {
      scores.set(
        id,
        (scores.get(id) ?? 0) + WEIGHTS[signal] / (RANK_CONSTANT + rank),
      );
      signals.set(id, [...(signals.get(id) ?? []), signal]);
    });
  }

  return [...scores]
    .sort((a, b) => {
      const seedA = signals.get(a[0])!.includes("seed") ? 1 : 0;
      const seedB = signals.get(b[0])!.includes("seed") ? 1 : 0;
      return seedB - seedA || b[1] - a[1] || a[0].localeCompare(b[0]);
    })
    .map(([id, score]): Entity => {
      const own = personal.get(id);
      const canon = world.pages.get(id);
      const text = matched.get(id);
      return {
        id,
        ...(own ? { personal: own } : {}),
        ...(canon ? { world: canon } : {}),
        knowledge: knowledgeOf(id),
        signals: signals.get(id)!,
        score,
        ...(text ? { matched: text } : {}),
        history: (canon?.history ?? [])
          .filter((line) => heardOf(id, line))
          .sort((a, b) => b.date.localeCompare(a.date)),
      };
    });
}

/** The request one brain turn makes: shared with the evaluation. */
export function brainRequest(turn: {
  readonly agentId: string;
  readonly prompt: string;
  readonly task?: string;
  readonly here?: readonly string[];
  readonly awaiting?: readonly string[];
  readonly now: number;
}): RetrievalRequest {
  return {
    agentId: turn.agentId,
    stimulus: turn.prompt,
    background: turn.task ?? "",
    seeds: [...sendersOf(turn.prompt), ...(turn.here ?? [])],
    contact: turn.here ?? [],
    unanswered: turn.awaiting ?? [],
    now: turn.now,
  };
}
