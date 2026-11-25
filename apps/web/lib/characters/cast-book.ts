import type { StatEntry, WikiListItem } from "@kazusa/client";

/** Where one character sits in the cast as the gallery orders it. */
export interface CastPlace {
  readonly index: number;
  readonly total: number;
  readonly prev: string | undefined;
  readonly next: string | undefined;
}

/**
 * The previous and next character in `order`, wrapping round, like turning a
 * page of a yearbook. Undefined when `id` isn't in it.
 */
export function placeInCast(
  order: readonly string[],
  id: string,
): CastPlace | undefined {
  const index = order.indexOf(id);
  if (index < 0) return undefined;
  const total = order.length;
  if (total < 2) return { index, total, prev: undefined, next: undefined };
  return {
    index,
    total,
    prev: order[(index - 1 + total) % total],
    next: order[(index + 1) % total],
  };
}

/** Someone a character keeps a page on, and how they stand toward them. */
export interface Acquaintance {
  readonly id: string;
  readonly name: string;
  /** Their page's summary: what they make of them, in their own words. */
  readonly take: string;
  /** Simulated, so their own view of the character can be read back. */
  readonly simulated: boolean;
  /** The states they hold toward them, by name; empty when none was set. */
  readonly toward: Readonly<Record<string, StatEntry>>;
}

/**
 * The people in a character's own wiki, those they hold a state toward first (a
 * relationship that has moved), then the rest of the cast, then people who
 * aren't simulated, each by name. Their own page and the system agent's are
 * left out: neither is someone they know.
 */
export function acquaintances({
  self,
  pages,
  simulated,
  toward,
  exclude = [],
}: {
  self: string;
  pages: readonly WikiListItem[];
  simulated: ReadonlySet<string>;
  toward: Readonly<Record<string, Readonly<Record<string, StatEntry>>>>;
  exclude?: readonly string[];
}): Acquaintance[] {
  const rank = (one: Acquaintance) =>
    Object.keys(one.toward).length ? 0 : one.simulated ? 1 : 2;
  return pages
    .filter(
      (page) =>
        page.kind === "person" &&
        page.id !== self &&
        !exclude.includes(page.id),
    )
    .map((page) => ({
      id: page.id,
      name: page.name,
      take: page.summary.trim(),
      simulated: simulated.has(page.id),
      toward: toward[page.id] ?? {},
    }))
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/** The paragraphs of a section kept only for the character themselves. */
export function privateTo(knownBy: readonly string[], self: string): boolean {
  return knownBy.length > 0 && knownBy.every((id) => id === self);
}
