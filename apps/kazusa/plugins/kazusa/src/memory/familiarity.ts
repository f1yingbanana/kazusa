import { KeyedAsyncQueue } from "openclaw/plugin-sdk/core";
import { cachedStore, type StateStore } from "../state.ts";
import type { Page } from "./page.ts";

/**
 * How familiar a character is with the people and places in their life: their
 * working knowledge, the few they always have in mind (`People you know`,
 * `Places you know`). It counts what they actually do with someone or somewhere
 * (going there, talking with them, noting something down), never being shown
 * it, which would feed itself. Scored with ACT-R's base-level activation, which
 * weighs recency and frequency together and fades with sim time: home and a
 * best friend stay on top, a café seen once drifts away.
 *
 * Machine state, so a keyed store, never Markdown: one record per character.
 */
export interface Uses {
  /** The latest uses, oldest first, sim time. */
  readonly recent: readonly number[];
  /** Every use counted, the recent ones included. */
  readonly count: number;
  /** The first use, sim time. */
  readonly first: number;
  /** When the latest use's episode began. */
  readonly since: number;
}

export type FamiliarityRecord = Readonly<Record<string, Uses>>;

export interface FamiliarityConfig {
  /** ACT-R's decay `d`: higher forgets faster. */
  readonly decay: number;
  /** Uses kept exactly; older ones are estimated from the count. */
  readonly recent: number;
  /**
   * One use per episode this long: ten days of contact count ten times, ten
   * hours at one party once (the spacing effect). A later contact within the
   * episode moves its time on.
   */
  readonly episodeHours: number;
}

const HOUR_MS = 3_600_000;
/** A use a moment ago counts as a minute old, not as infinitely strong. */
const MIN_AGE_HOURS = 1 / 60;

/** The page id an entity has in a wiki: the player's without `user:`. */
export const pageIdOf = (id: string): string => id.replace(/^user:/, "");

/** A chat this small is people you talk with, not an audience you post to. */
const FAMILIAR_CHAT_SIZE = 6;

/**
 * Who a message makes familiar to whom: every recipient knows the sender a
 * little better, and the sender each member of a small chat. Only characters
 * keep familiarity; the player has no brain.
 */
export function usesOfMessage(
  sender: string,
  audience: readonly string[],
): ReadonlyArray<readonly [agentId: string, ids: readonly string[]]> {
  const others = audience.filter((id) => id !== sender);
  return [
    ...others.map((id) => [id, [sender]] as const),
    ...(others.length <= FAMILIAR_CHAT_SIZE ? [[sender, others] as const] : []),
  ].filter(([agentId]) => !agentId.startsWith("user:"));
}

/**
 * `record` with `id` used at `at`: a new use when its episode is over, else the
 * episode's time moved on to `at`; itself when nothing changes (no later than
 * the last use, or within the hour, which recency can't tell apart).
 */
export function withUse(
  record: FamiliarityRecord,
  id: string,
  at: number,
  config: FamiliarityConfig,
): FamiliarityRecord {
  const previous = record[id];
  const last = previous?.recent.at(-1);
  if (previous && last !== undefined) {
    if (at - last < HOUR_MS) return record;
    if (at - previous.since < config.episodeHours * HOUR_MS)
      return {
        ...record,
        [id]: { ...previous, recent: [...previous.recent.slice(0, -1), at] },
      };
  }
  return {
    ...record,
    [id]: {
      recent: [...(previous?.recent ?? []), at].slice(-config.recent),
      count: (previous?.count ?? 0) + 1,
      first: previous?.first ?? at,
      since: at,
    },
  };
}

/**
 * ACT-R base-level activation, `ln Σ age^-d` over every use, with the uses not
 * kept estimated as spread evenly from the first to the oldest kept (Petrov's
 * hybrid approximation). Higher is more familiar.
 */
export function activation(uses: Uses, now: number, decay: number): number {
  const age = (at: number): number =>
    Math.max(MIN_AGE_HOURS, (now - at) / HOUR_MS);
  let sum = uses.recent.reduce((total, at) => total + age(at) ** -decay, 0);
  const older = uses.count - uses.recent.length;
  const oldestKept = uses.recent[0];
  if (older > 0 && oldestKept !== undefined) {
    const from = age(uses.first);
    const to = age(oldestKept);
    sum +=
      from > to
        ? (older * (from ** (1 - decay) - to ** (1 - decay))) /
          ((1 - decay) * (from - to))
        : older * to ** -decay;
  }
  return Math.log(sum);
}

/**
 * When their own page last moved (seen, or its newest note), as one use: so a
 * world with no history yet still ranks what they last touched first.
 */
function fromPage(page: Page): number | undefined {
  const dates = [page.seen ?? "", ...page.notes.map((note) => note.date)]
    .filter((date) => /^\d{4}-\d{2}-\d{2}/.test(date))
    .sort();
  const latest = dates.at(-1);
  return latest === undefined
    ? undefined
    : Date.parse(`${latest.slice(0, 10)}T12:00:00Z`);
}

export interface FamiliarityService {
  /** They did something with these (went there, spoke, noted it) at `at`. */
  readonly use: (
    agentId: string,
    ids: readonly string[],
    at: number,
  ) => Promise<void>;
  /**
   * How familiar each thing is at `now`, by page id: everything they used, and
   * their own pages by when they last moved. Unknown ids are absent.
   */
  readonly scores: (
    agentId: string,
    now: number,
    pages: Iterable<Page>,
  ) => Promise<ReadonlyMap<string, number>>;
}

// Plugin registrations share the retained store, so serialize their writes too.
const QUEUE = Symbol.for("kazusa.memory.familiarity");
function sharedQueue(): KeyedAsyncQueue {
  const scope = globalThis as { [QUEUE]?: KeyedAsyncQueue };
  return (scope[QUEUE] ??= new KeyedAsyncQueue());
}

export function createFamiliarity(
  store: StateStore<FamiliarityRecord>,
  config: FamiliarityConfig,
): FamiliarityService {
  const records = cachedStore("familiarity", store);
  return {
    use: (agentId, ids, at) =>
      sharedQueue().enqueue(agentId, async () => {
        const before = (await records.lookup(agentId)) ?? {};
        let after = before;
        for (const id of new Set(ids.map(pageIdOf)))
          if (id !== pageIdOf(agentId)) after = withUse(after, id, at, config);
        if (after !== before) await records.register(agentId, after);
      }),
    scores: async (agentId, now, pages) => {
      const record = (await records.lookup(agentId)) ?? {};
      const latest = new Map<string, number>();
      for (const page of pages) {
        const at = fromPage(page);
        if (at !== undefined && at <= now) latest.set(page.id, at);
      }
      const scores = new Map<string, number>();
      for (const id of new Set([...latest.keys(), ...Object.keys(record)])) {
        // A page that moved since their last use counts as one more use.
        const pageAt = latest.get(id);
        const uses =
          pageAt === undefined ? record : withUse(record, id, pageAt, config);
        const own = uses[id];
        if (own) scores.set(id, activation(own, now, config.decay));
      }
      return scores;
    },
  };
}
