import { DEPTHS } from "./knowledge.ts";
import type { Entity, Signal } from "./retrieve.ts";
import type { Note, Page } from "./page.ts";

export interface RenderOptions {
  /** Whole entities are kept or dropped, never cut. */
  readonly maxTokens: number;
  readonly estimate: (text: string) => number;
  /** A person's name by id, for note sources. */
  readonly nameOf: (id: string) => string | undefined;
}

const MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");
const NOTES_SHOWN = 2;
const MATCHED_CHARS = 280;
const MAX_FULL = 5;
const MAX_ALSO = 6;
/** A word in common is weak evidence: a couple in full, the rest in passing. */
const MAX_KEYWORD_ONLY = 2;
/** Things only a recent signal surfaced stay one line. */
const FULL_SIGNALS: ReadonlySet<Signal> = new Set([
  "seed",
  "mention",
  "keyword",
  "semantic",
  "news",
]);

const flat = (text: string): string => text.replace(/\s+/g, " ").trim();

const shortDate = (date: string): string => {
  const [, month, day] = date.split("-");
  return `${MONTHS[Number(month) - 1]} ${Number(day)}`;
};

const label = (entity: Entity): string => {
  const page = (entity.personal ?? entity.world)!;
  const name = entity.world?.name ?? page.name;
  const id = page.personId ?? entity.world?.personId ?? entity.id;
  return `${name} \`${id}\``;
};

function noteLine(note: Note, nameOf: RenderOptions["nameOf"]): string {
  const told = note.source.match(/^told by (.+)$/)?.[1];
  const overheard = note.source.match(/^overheard (.+)$/)?.[1];
  const how = told
    ? `${nameOf(told) ?? told} told you`
    : overheard
      ? `you overheard ${nameOf(overheard) ?? overheard}`
      : ({
          "seen it": "you saw",
          "read it": "you read",
          "my guess": "your guess",
          "always known": "you've long known",
        }[note.source] ?? note.source);
  const hedge = note.certainty === "sure" ? "" : ` (${note.certainty})`;
  return `  · ${shortDate(note.date)}, ${how}: ${note.text}${hedge}`;
}

/** What they know of one thing, as deep as `depth` lets them. */
export function renderEntity(
  entity: Entity,
  nameOf: RenderOptions["nameOf"],
): string {
  const own: Page | undefined = entity.personal;
  const canon = entity.world;
  const relation = own?.relation ? ` (${own.relation})` : "";
  const familiar =
    DEPTHS.indexOf(entity.knowledge.depth) >= DEPTHS.indexOf("familiar");
  const view = own?.lead
    ? flat(own.lead)
    : canon && familiar && canon.lead
      ? flat(canon.lead)
      : (own?.summary ?? canon?.summary ?? "");
  const hedge =
    !own && entity.knowledge.depth === "heard of"
      ? " (you've only heard of it)"
      : "";
  const lines = [`${label(entity)}${relation}: ${view}${hedge}`];
  if (own?.theyThinkOfMe)
    lines[0] += ` You guess they think: ${own.theyThinkOfMe}`;
  if (own?.openThreads.length)
    lines[0] += ` Unfinished: ${own.openThreads.join("; ")}`;
  if (own) {
    const notes = [...own.notes].sort((a, b) => b.date.localeCompare(a.date));
    for (const note of notes.slice(0, NOTES_SHOWN))
      lines.push(noteLine(note, nameOf));
  }
  for (const line of entity.history.slice(0, NOTES_SHOWN))
    lines.push(
      `  · ${shortDate(line.date)}${line.news ? ", the news" : ""}: ${line.text}`,
    );
  if (entity.matched && !lines.join("\n").includes(flat(entity.matched))) {
    const excerpt = flat(entity.matched);
    lines.push(
      `  · ${excerpt.length > MATCHED_CHARS ? `${excerpt.slice(0, MATCHED_CHARS)}…` : excerpt}`,
    );
  }
  return lines.join("\n");
}

function oneLine(entity: Entity): string {
  const page = (entity.personal ?? entity.world)!;
  const about = entity.personal?.relation ?? flat(page.summary);
  return `${label(entity)}${about ? ` (${about})` : ""}`;
}

/** `On your mind`, whole entities only, most relevant first. */
export function renderOnYourMind(
  entities: readonly Entity[],
  options: RenderOptions,
): { readonly text: string; readonly ids: readonly string[] } {
  const parts: string[] = [];
  const ids: string[] = [];
  let remaining = options.maxTokens;
  const also: Entity[] = [];
  let full = 0;
  let keywordOnly = 0;
  for (const entity of entities) {
    const onlyKeyword = !entity.signals.some(
      (signal) => signal === "seed" || signal === "mention",
    );
    const worthAFullEntry =
      full < MAX_FULL &&
      !(onlyKeyword && keywordOnly >= MAX_KEYWORD_ONLY) &&
      entity.signals.some((signal) => FULL_SIGNALS.has(signal)) &&
      // The current place is already in Where you are; only a personal view adds.
      !(
        entity.world?.kind === "place" &&
        !entity.personal?.lead &&
        entity.signals.every((signal) => signal === "seed")
      );
    if (!worthAFullEntry) {
      also.push(entity);
      continue;
    }
    const text = renderEntity(entity, options.nameOf);
    const tokens = options.estimate(text);
    if (tokens > remaining) {
      also.push(entity);
      continue;
    }
    parts.push(text);
    ids.push(entity.id);
    remaining -= tokens;
    full++;
    if (onlyKeyword) keywordOnly++;
  }
  const line: string[] = [];
  for (const entity of also) {
    if (line.length >= MAX_ALSO) break;
    const text = oneLine(entity);
    const tokens = options.estimate(text);
    if (tokens > remaining) continue;
    line.push(text);
    ids.push(entity.id);
    remaining -= tokens;
  }
  if (line.length) parts.push(`Also: ${line.join(" · ")}`);
  return { text: parts.join("\n"), ids };
}

/** `People you know`: their own people pages, most recently touched first. */
export function renderRoster(
  pages: Iterable<Page>,
  limit: number,
  worldName: (id: string) => string | undefined,
): string {
  const people = [...pages]
    .filter((page) => page.kind === "person")
    .sort((a, b) => {
      const recent = (page: Page): string =>
        [page.seen ?? "", ...page.notes.map((note) => note.date)]
          .sort()
          .at(-1) ?? "";
      return recent(b).localeCompare(recent(a)) || a.id.localeCompare(b.id);
    })
    .slice(0, limit);
  return people
    .map((page) => {
      const name = worldName(page.id) ?? page.name;
      const id = page.personId ?? page.id;
      return `${name} \`${id}\`${page.relation ? ` (${page.relation})` : ""}`;
    })
    .join(" · ");
}
