import {
  statMeaning,
  statMoved,
  statStanding,
  statStride,
  statValue,
  statWord,
  type StatAuthor,
  type StatCatalog,
  type StatDefinition,
  type StatEntry,
  type StatRecord,
  type StatValue,
} from "@kazusa/client";
import { z } from "zod";

/** The keyed store's key for the world's own states. */
export const WORLD_KEY = "world";

export const EMPTY_RECORD: StatRecord = { own: {}, toward: {} };

/** Which value a change is about: a subject's own, or theirs toward someone. */
export interface StatTarget {
  readonly name: string;
  readonly toward?: string;
}

export function entryOf(
  record: StatRecord | undefined,
  { name, toward }: StatTarget,
): StatEntry | undefined {
  return toward === undefined
    ? record?.own[name]
    : record?.toward[toward]?.[name];
}

/** The record with one entry set, or removed: back to the state's initial. */
export function withEntry(
  record: StatRecord | undefined,
  { name, toward }: StatTarget,
  entry: StatEntry | undefined,
): StatRecord {
  const { own, toward: pairs } = record ?? EMPTY_RECORD;
  const put = (entries: Readonly<Record<string, StatEntry>> = {}) => {
    const { [name]: _gone, ...rest } = entries;
    return entry ? { ...rest, [name]: entry } : rest;
  };
  if (toward === undefined) return { own: put(own), toward: pairs };
  const { [toward]: theirs, ...others } = pairs;
  const next = put(theirs);
  return {
    own,
    toward: Object.keys(next).length ? { ...others, [toward]: next } : others,
  };
}

/**
 * One value as the prompt says it: its word, and what the word means. Whoever
 * holds it (`own`) also reads how near the next band a number stands.
 */
function line(stat: StatDefinition, value: StatValue, own = true): string {
  const meaning = statMeaning(stat, value);
  const word = own ? statStanding(stat, value) : statWord(stat, value);
  return `${stat.name}: ${word}${meaning ? ` (${meaning})` : ""}`;
}

/** Someone a character's states toward are shown or reviewed for. */
export interface StatPerson {
  readonly id: string;
}

/** The same, as the prompt labels them. */
export interface LabelledPerson extends StatPerson {
  readonly label: string;
}

export interface StatsView {
  /** Their own states: the world's, and their outfit if they have any. */
  readonly catalog: StatCatalog;
  readonly record: StatRecord | undefined;
  readonly world: StatRecord | undefined;
  /** People their states toward are shown for. */
  readonly toward: readonly LabelledPerson[];
  /**
   * People standing with them, whose visible states they can see. Each catalog
   * is that person's own, so the player's has the player's states.
   */
  readonly present: readonly {
    readonly label: string;
    readonly catalog: StatCatalog;
    readonly record: StatRecord | undefined;
  }[];
}

/**
 * What a character reads of the world's states this turn: their own, those
 * toward the people at hand, what shows on the people with them (the player's
 * own states among them), and the world's. Nothing when there is none to see.
 */
export function statsText(view: StatsView): string | undefined {
  const shown = view.catalog.filter(({ shown }) => shown !== "nobody");
  const on = (subject: StatDefinition["on"]) =>
    shown.filter((stat) => stat.on === subject);
  // Every state a line names, said once below however many lines name it.
  const named = new Map<string, StatDefinition>();
  const says = (stat: StatDefinition, value: StatValue, own = true) => {
    if (!named.has(stat.name)) named.set(stat.name, stat);
    return line(stat, value, own);
  };
  const lines: string[] = [];
  const own = on("character").map((stat) =>
    says(stat, statValue(stat, view.record?.own[stat.name])),
  );
  if (own.length) lines.push(own.join(" · "));
  for (const { id, label } of view.toward) {
    const theirs = on("pair").map((stat) =>
      says(stat, statValue(stat, view.record?.toward[id]?.[stat.name])),
    );
    if (theirs.length) lines.push(`Toward ${label}: ${theirs.join(" · ")}`);
  }
  // On others, only what stands out: everyone at their initial says nothing.
  for (const { label, catalog, record } of view.present) {
    const visible = catalog
      .filter(
        (stat) =>
          (stat.on === "character" || stat.on === "player") &&
          stat.shown === "everyone",
      )
      .flatMap((stat) => {
        const value = statValue(stat, record?.own[stat.name]);
        return value === stat.initial ? [] : [says(stat, value, false)];
      });
    if (visible.length) lines.push(`${label}: ${visible.join(" · ")}`);
  }
  const world = on("world").map((stat) =>
    says(stat, statValue(stat, view.world?.own[stat.name])),
  );
  if (world.length) lines.push(`The world: ${world.join(" · ")}`);
  if (!lines.length) return undefined;
  return [
    ...lines,
    "What these are:",
    ...[...named.values()].map(
      ({ name, description }) => `- ${name}: ${description}`,
    ),
  ].join("\n");
}

/** States a character changes themselves, while awake. */
export function ownChoices(catalog: StatCatalog): StatDefinition[] {
  return catalog.filter(
    (stat) => stat.on === "character" && stat.changedBy === "character",
  );
}

/**
 * How a state with bands is moved, as a model is told. A fine one says so: read
 * as a whole word per step, "up" looks too big to give and the state never
 * moves.
 */
function howMoved(stat: StatDefinition): string {
  const stride = statStride(stat);
  return stride < 2
    ? 'To move it a step, give "up" or "down".'
    : `It moves in small steps, about ${stride} from one of these to the next: give "up" or "down" for a step.`;
}

/** One state as a model is told of it: what it is and what it can be. */
export function describeStat(stat: StatDefinition): string {
  const values =
    stat.kind === "choice"
      ? `One of: ${stat.values
          .map(({ name, description }) =>
            description ? `${name} (${description})` : name,
          )
          .join(", ")}.`
      : stat.bands?.length
        ? `From lowest to highest: ${stat.bands
            .map(({ name, description }) =>
              description ? `${name} (${description})` : name,
            )
            .join(", ")}. ${howMoved(stat)}`
        : `A number from ${stat.min} to ${stat.max}: give the new number, or a change like "-3".`;
  return `${stat.name}: ${stat.description} ${values}`;
}

/**
 * `start_task`'s `changes`, or nothing when they have no state they set
 * themselves. Named once in prose, like desires: models fill listed properties
 * like a form. Its wording is `kazusa-tools#start_task.changes`; this is its
 * `{data}`.
 */
export function changesParameter(
  catalog: StatCatalog,
): Record<string, unknown> | undefined {
  const stats = ownChoices(catalog);
  if (!stats.length) return undefined;
  return {
    type: "object",
    description: stats.map(describeStat).join("\n"),
    propertyNames: { enum: stats.map(({ name }) => name) },
    additionalProperties: { type: ["string", "number"] },
  };
}

export interface StatChange {
  readonly stat: StatDefinition;
  readonly toward?: string;
  readonly value: StatValue;
}

/**
 * What a character's `changes` come to: only states that are theirs to set,
 * with a value the state can hold, that differs from where it stands. The rest
 * is dropped, never refused: a refusal costs a whole retry.
 */
export function ownChanges(
  catalog: StatCatalog,
  record: StatRecord | undefined,
  changes: unknown,
): StatChange[] {
  if (!changes || typeof changes !== "object" || Array.isArray(changes))
    return [];
  return ownChoices(catalog).flatMap((stat) => {
    const current = statValue(stat, record?.own[stat.name]);
    const value = statMoved(
      stat,
      current,
      (changes as Record<string, unknown>)[stat.name],
    );
    return value === undefined || value === current ? [] : [{ stat, value }];
  });
}

/** States a night's sleep reviews: how the day left them. */
function reviewed(catalog: StatCatalog): StatDefinition[] {
  return catalog.filter(
    (stat) => stat.on !== "world" && stat.changedBy === "reviewed",
  );
}

/**
 * What a sleeping character is shown of the states their sleep reviews: what
 * each is, where their own stand, and where those toward each person of the day
 * stand. Nothing when the world has none to review.
 */
export function reviewText(
  catalog: StatCatalog,
  record: StatRecord | undefined,
  people: readonly LabelledPerson[],
): string | undefined {
  const stats = reviewed(catalog);
  const own = stats.filter(({ on }) => on === "character");
  const toward = people.flatMap(({ id, label }) => {
    const theirs = stats.filter((stat) => stat.on === "pair");
    return theirs.length ? [{ id, label, stats: theirs }] : [];
  });
  const pair = stats.filter((stat) =>
    toward.some(({ stats: theirs }) => theirs.includes(stat)),
  );
  if (!own.length && !pair.length) return undefined;
  // What each value means is said once above, not on every person's line.
  const stands = (stat: StatDefinition, towardId?: string) =>
    `${stat.name}: ${statStanding(
      stat,
      statValue(
        stat,
        entryOf(record, {
          name: stat.name,
          ...(towardId ? { toward: towardId } : {}),
        }),
      ),
    )}`;
  return [
    [...own, ...pair].map(describeStat).join("\n"),
    ...(own.length
      ? [`Yours now: ${own.map((stat) => stands(stat)).join(" · ")}`]
      : []),
    ...toward.map(
      ({ id, label, stats: theirs }) =>
        `Toward ${label}: ${theirs.map((stat) => stands(stat, id)).join(" · ")}`,
    ),
  ].join("\n");
}

const VALUES = z.record(z.string(), z.unknown());
const REVIEW = z.object({
  own: VALUES.optional().catch(undefined),
  toward: z.record(z.string(), VALUES).optional().catch(undefined),
});

/**
 * What a night's `states` change: only states sleep reviews, toward people of
 * the day, with a value the state can hold that differs from where it stands.
 * The rest is dropped.
 */
export function reviewedChanges(
  catalog: StatCatalog,
  record: StatRecord | undefined,
  answer: unknown,
  people: readonly StatPerson[],
): StatChange[] {
  const parsed = REVIEW.safeParse(answer);
  if (!parsed.success) return [];
  const stats = reviewed(catalog);
  const changes = (
    values: Readonly<Record<string, unknown>> | undefined,
    person?: StatPerson,
  ): StatChange[] =>
    stats.flatMap((stat) => {
      if (person ? stat.on !== "pair" : stat.on !== "character") return [];
      const toward = person ? { toward: person.id } : {};
      const current = statValue(
        stat,
        entryOf(record, { name: stat.name, ...toward }),
      );
      const value = statMoved(stat, current, values?.[stat.name]);
      return value === undefined || value === current
        ? []
        : [{ stat, value, ...toward }];
    });
  return [
    ...changes(parsed.data.own),
    ...Object.entries(parsed.data.toward ?? {}).flatMap(([id, values]) => {
      const person = people.find((entry) => entry.id === id);
      return person ? changes(values, person) : [];
    }),
  ];
}

export function entry(value: StatValue, at: number, by: StatAuthor): StatEntry {
  return { value, at, by };
}
