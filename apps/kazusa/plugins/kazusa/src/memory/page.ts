import path from "node:path";
import YAML from "yaml";
import { z } from "zod";

export type PageKind = "place" | "person" | "concept" | "day";
export type Certainty = "sure" | "think so" | "suspect" | "doubt it";
export type Renown = "private" | "local" | "known" | "famous";

export interface Note {
  readonly date: string;
  readonly source: string;
  readonly certainty: Certainty;
  readonly text: string;
}

export interface HistoryLine {
  readonly date: string;
  readonly news: boolean;
  readonly text: string;
}

export interface Section {
  readonly title: string;
  readonly text: string;
  /** Character ids from a `Known by:` first line; empty means unrestricted. */
  readonly knownBy: readonly string[];
}

/** One Markdown file of either wiki, read in layers (memory.md §3.2). */
export interface Page {
  readonly id: string;
  readonly kind: PageKind;
  readonly name: string;
  readonly aliases: readonly string[];
  /** L0: `summary`, else the lead's first sentence. */
  readonly summary: string;
  /** L1: the text between the H1 and the first `##`. */
  readonly lead: string;
  /** L2: `##` sections that have no structure of their own. */
  readonly sections: readonly Section[];
  readonly notes: readonly Note[];
  readonly history: readonly HistoryLine[];
  readonly openThreads: readonly string[];
  /** `## What they think of me`, the character's guess (§3.5). */
  readonly theyThinkOfMe?: string;
  /**
   * What it belongs to (a club, a school, a district), first the nearest. A
   * person knows each of theirs at "familiar", or "intimate" when close.
   */
  readonly groups: readonly Group[];
  readonly renown?: Renown;
  readonly knownBy: readonly string[];
  readonly parent?: string;
  readonly home?: string;
  readonly relation?: string;
  /** How a person is addressed, when it differs from the id (`user:sensei`). */
  readonly personId?: string;
  readonly seen?: string;
  readonly touched: readonly string[];
  readonly links: readonly string[];
  /** Everything lint should say about this file alone. */
  readonly problems: readonly string[];
}

/** A group a page belongs to; a person who is close knows it well. */
export interface Group {
  readonly ref: string;
  readonly close: boolean;
}

const text = z.union([z.string(), z.number()]).transform(String).optional();
const texts = z
  .union([z.array(z.union([z.string(), z.number()])), z.string()])
  .transform((value) =>
    (Array.isArray(value) ? value : value.split(",")).map((item) =>
      String(item).trim(),
    ),
  )
  .optional();

/**
 * `groups: [A, B]`, or `groups: { A: close, B: member }` where closeness
 * matters, as for a person's club beside their school.
 */
const groups = z
  .union([
    texts,
    z.record(z.string(), z.enum(["close", "member"])).transform((value) =>
      Object.entries(value).map(([ref, how]) => ({
        ref: ref.trim(),
        close: how === "close",
      })),
    ),
  ])
  .optional()
  .transform((value): Group[] =>
    (value ?? []).flatMap((item) =>
      typeof item === "string"
        ? item
          ? [{ ref: item, close: false }]
          : []
        : item.ref
          ? [item]
          : [],
    ),
  );

/**
 * The fields Kazusa reads. Anything else in front matter is the author's own:
 * kept as written and never read, so it belongs in the page's text instead.
 */
const FRONTMATTER = z.looseObject({
  name: text,
  aliases: texts,
  summary: text,
  groups,
  renown: z.enum(["private", "local", "known", "famous"]).optional(),
  known_by: texts,
  parent: text,
  home: text,
  relation: text,
  peer_id: text,
  seen: text,
  touched: texts,
  connections: z.array(z.looseObject({ to: z.string() })).optional(),
});

const NOTE =
  /^- (\d{4}-\d{2}-\d{2}) · (.+?) · (sure|think so|suspect|doubt it) — (.+)$/;
const HISTORY = /^- (\d{4}-\d{2}-\d{2})( · news)? — (.+)$/;
const KNOWN_BY = /^Known by:\s*(.+)$/i;
const OPENING = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
/** Frontmatter numbers a card must not carry; relationships are words. */
const NUMBER_FIELDS = ["familiarity", "affinity", "trust"];

export function firstSentence(value: string): string {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.match(/^.+?[.!?。！？](?=\s|$)/u)?.[0] ?? flat;
}

/** Non-empty lines, each wrapped bullet joined back into one line. */
function bulletLines(body: string): string[] {
  const lines: string[] = [];
  for (const line of body.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const last = lines.at(-1);
    // A long bullet goes on, indented, on the lines under it.
    if (/^\s+\S/.test(line) && last !== undefined && /^[-*]\s/.test(last))
      lines[lines.length - 1] = `${last} ${line.trim()}`;
    else lines.push(line.trim());
  }
  return lines;
}

const listItems = (body: string): string[] =>
  bulletLines(body)
    .map((line) => line.match(/^[-*]\s+(.+)$/)?.[1]?.trim())
    .filter((item): item is string => Boolean(item));

/** The kind a page has by where it lives, in either wiki. */
export function pageKind(relative: string): PageKind {
  const parts = relative.split(path.sep);
  if (parts[0] === "days") return "day";
  if (parts[0] === "entities" && parts[1] === "places") return "place";
  if (parts[0] === "entities" && parts[1] === "characters") return "person";
  return "concept";
}

/** Never throws: a broken page still has an id, a body and a lint problem. */
export function parsePage(raw: string, relative: string): Page {
  const problems: string[] = [];
  const id = path.basename(relative, ".md");
  const opening = raw.match(OPENING);
  let data: z.infer<typeof FRONTMATTER> = { groups: [] };
  if (opening) {
    try {
      const parsed = FRONTMATTER.safeParse(YAML.parse(opening[1]) ?? {});
      if (parsed.success) data = parsed.data;
      else
        problems.push(
          `front matter: ${parsed.error.issues
            .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
            .join("; ")}`,
        );
    } catch (error: unknown) {
      problems.push(`front matter is not YAML: ${String(error)}`);
    }
    for (const field of NUMBER_FIELDS) {
      if ((data as Record<string, unknown>)[field] !== undefined)
        problems.push(`\`${field}\` is a number; use \`relation\` words`);
    }
  }

  const body = raw.slice(opening?.[0].length ?? 0);
  const lines = body.split(/\r?\n/);
  let heading: string | undefined;
  let current: string[] = [];
  let title: string | undefined;
  let fenced = false;
  const blocks: Array<{ heading?: string; body: string }> = [];
  const flush = (): void => {
    blocks.push({ heading, body: current.join("\n").trim() });
    current = [];
  };
  for (const line of lines) {
    if (/^(```|~~~)/.test(line)) fenced = !fenced;
    if (!fenced && title === undefined && !heading && /^# /.test(line)) {
      title = line.slice(2).trim();
      continue;
    }
    const opened = fenced ? undefined : line.match(/^## +(.+?)\s*$/);
    if (opened) {
      flush();
      heading = opened[1];
      continue;
    }
    current.push(line);
  }
  flush();

  const sections: Section[] = [];
  const notes: Note[] = [];
  const history: HistoryLine[] = [];
  let openThreads: string[] = [];
  let theyThinkOfMe: string | undefined;
  let lead = "";
  for (const block of blocks) {
    if (block.heading === undefined) {
      lead = block.body;
      continue;
    }
    switch (block.heading.toLowerCase()) {
      case "notes":
        for (const line of bulletLines(block.body)) {
          const match = line.match(NOTE);
          if (match) {
            notes.push({
              date: match[1],
              source: match[2],
              certainty: match[3] as Certainty,
              text: match[4],
            });
          } else {
            problems.push(`malformed note: ${line.trim().slice(0, 80)}`);
          }
        }
        break;
      case "history":
        for (const line of bulletLines(block.body)) {
          const match = line.match(HISTORY);
          if (match) {
            history.push({
              date: match[1],
              news: Boolean(match[2]),
              text: match[3],
            });
          } else {
            problems.push(`malformed history: ${line.trim().slice(0, 80)}`);
          }
        }
        break;
      case "open threads":
        openThreads = listItems(block.body);
        break;
      case "what they think of me":
        theyThinkOfMe = block.body.replace(/\s+/g, " ").trim() || undefined;
        break;
      default: {
        // `Known by:` is its own paragraph, however many lines it wraps to.
        const [first = "", ...rest] = block.body.split(/\r?\n\s*\r?\n/);
        const restricted = first.replace(/\s+/g, " ").match(KNOWN_BY);
        sections.push(
          restricted
            ? {
                title: block.heading,
                text: rest.join("\n\n").trim(),
                knownBy: restricted[1]
                  .split(",")
                  .map((who) => who.trim())
                  .filter(Boolean),
              }
            : { title: block.heading, text: block.body, knownBy: [] },
        );
      }
    }
  }

  const links = new Set<string>();
  for (const match of body.matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g))
    links.add(match[1].trim());
  for (const link of data.connections ?? []) links.add(link.to);

  const name = data.name ?? title ?? id;
  return {
    id,
    kind: pageKind(relative),
    name,
    aliases: [
      ...new Set(
        (data.aliases ?? []).filter(
          (alias): alias is string => Boolean(alias) && alias !== name,
        ),
      ),
    ],
    summary: data.summary ?? firstSentence(lead),
    lead,
    sections,
    notes,
    history,
    openThreads,
    ...(theyThinkOfMe ? { theyThinkOfMe } : {}),
    groups: data.groups,
    ...(data.renown ? { renown: data.renown } : {}),
    knownBy: data.known_by ?? [],
    ...(data.parent ? { parent: data.parent } : {}),
    ...(data.home ? { home: data.home } : {}),
    ...(data.relation ? { relation: data.relation } : {}),
    ...(data.peer_id && data.peer_id !== id ? { personId: data.peer_id } : {}),
    ...(data.seen ? { seen: data.seen } : {}),
    touched: data.touched ?? [],
    links: [...links],
    problems,
  };
}
