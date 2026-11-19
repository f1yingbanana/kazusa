import path from "node:path";
import YAML from "yaml";
import { z } from "zod";

/** A character, everything else, or a day of a character's diary. */
export type PageKind = "person" | "concept" | "day";
export type Certainty = "sure" | "think so" | "suspect" | "doubt it";
/** How well a group knows a page: who has heard of it, knows it, or is close. */
export type Level = "heard of" | "knows" | "close";
export const LEVELS: readonly Level[] = ["heard of", "knows", "close"];
/** Deprecated: how widely a page was known before `everyone` (`legacy.ts`). */
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
  /**
   * Ids from a `Known by:` first line: a part only the page's own character
   * knows (their inner voice). Empty: anyone close to it.
   */
  readonly knownBy: readonly string[];
}

/** Links a character can follow from a page, by how well they must know it. */
export interface TieredLinks {
  /** In the summary: anyone who has heard of it. */
  readonly heard: readonly string[];
  /** In the opening, and a place's routes: anyone who knows it. */
  readonly knows: readonly string[];
  /** In its sections: those close to it. */
  readonly close: readonly string[];
}

/** One Markdown file of either wiki, read in layers (memory.md §3.2). */
export interface Page {
  readonly id: string;
  readonly kind: PageKind;
  /** Where it is, relative to its wiki's root. */
  readonly path: string;
  /** The file's length in characters, front matter included. */
  readonly length: number;
  /** The place component: it is on the map (`place_id`). */
  readonly place: boolean;
  /** The group component: people can be in it (`group: true`). */
  readonly group: boolean;
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
  /** `known`: the groups whose members know it, and how well. */
  readonly known: readonly Group[];
  /** How well everyone knows it, if everyone has at least heard of it. */
  readonly everyone?: Level;
  /** `in`, on a character's page: the groups they are in, and how closely. */
  readonly in: readonly Group[];
  /** Deprecated: `groups` in a world not yet upgraded (`legacy.ts`). */
  readonly legacyGroups: readonly Group[];
  /** Deprecated: read only in a world not yet upgraded (`legacy.ts`). */
  readonly renown?: Renown;
  /** Deprecated: the only characters who knew it, before upgrading. */
  readonly knownBy: readonly string[];
  readonly parent?: string;
  readonly home?: string;
  readonly relation?: string;
  /** How a person is addressed, when it differs from the id (`user:sensei`). */
  readonly personId?: string;
  readonly seen?: string;
  readonly touched: readonly string[];
  /** Every page it links to, in any part. */
  readonly links: readonly string[];
  readonly linksAt: TieredLinks;
  /** Everything lint should say about this file alone. */
  readonly problems: readonly string[];
}

/** A group and a level: how well its members know a page. */
export interface Group {
  readonly ref: string;
  readonly level: Level;
}

/** The group every character is in. */
export const EVERYONE = "everyone";

const text = z.union([z.string(), z.number()]).transform(String).optional();
const texts = z
  .union([z.array(z.union([z.string(), z.number()])), z.string()])
  .transform((value) =>
    (Array.isArray(value) ? value : value.split(",")).map((item) =>
      String(item).trim(),
    ),
  )
  .optional();

const level = z
  .union([z.string(), z.number()])
  .transform((value) => String(value).trim().toLowerCase())
  // The words the editor shows for involvement read as their levels, and
  // `member` is how worlds made before levels wrote "knows".
  .pipe(
    z.enum([
      "heard of",
      "knows",
      "close",
      "member",
      "associate",
      "close member",
      "know well",
    ]),
  )
  .transform(
    (value): Level =>
      (({
        member: "knows",
        associate: "heard of",
        "close member": "close",
        "know well": "close",
      })[value as string] as Level | undefined) ?? (value as Level),
  );

/**
 * A level as a page may write it, the editor's words included (`member`,
 * `associate`, `close member`, `know well`); `undefined` when it isn't one.
 */
export function levelOf(value: unknown): Level | undefined {
  const read = level.safeParse(value);
  return read.success ? read.data : undefined;
}

/**
 * `known: { everyone: heard of, gehenna: knows, prefect_team: close }`; a plain
 * list means its members know it.
 */
const groups = z
  .union([
    texts.transform((refs) =>
      (refs ?? []).map((ref): Group => ({ ref, level: "knows" })),
    ),
    z.record(z.string(), level).transform((value) =>
      Object.entries(value).map(([ref, how]) => ({
        ref: ref.trim(),
        level: how,
      })),
    ),
  ])
  .optional()
  .transform((value): Group[] => (value ?? []).filter(({ ref }) => ref));

/**
 * The fields Kazusa reads. Anything else in front matter is the author's own:
 * kept as written and never read, so it belongs in the page's text instead.
 */
const FRONTMATTER = z.looseObject({
  name: text,
  aliases: texts,
  summary: text,
  known: groups,
  in: groups,
  group: z.boolean().optional().catch(undefined),
  place_id: text,
  groups,
  renown: z
    .enum(["private", "local", "known", "famous"])
    .optional()
    .catch(undefined),
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * Front matter without what failed to parse: in a map of groups, only the
 * entries whose level isn't one (`known: { gehenna: clsoe }`); else the whole
 * field. `undefined` when the front matter isn't a map at all.
 */
function withoutIssues(
  raw: unknown,
  issues: readonly { readonly path: readonly PropertyKey[] }[],
): Record<string, unknown> | undefined {
  if (!isRecord(raw)) return undefined;
  const kept: Record<string, unknown> = { ...raw };
  for (const { path: where } of issues) {
    const field = where[0];
    if (field === undefined) continue;
    const value = kept[String(field)];
    const entries = isRecord(value)
      ? Object.entries(value).filter(([, how]) => level.safeParse(how).success)
      : [];
    if (entries.length && entries.length < Object.keys(value ?? {}).length)
      kept[String(field)] = Object.fromEntries(entries);
    else delete kept[String(field)];
  }
  return kept;
}
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

function everyoneOf(list: readonly Group[]): { everyone?: Level } {
  const found = list.find(({ ref }) => ref.toLowerCase() === EVERYONE);
  return found ? { everyone: found.level } : {};
}

/** The kind a page has by where it lives, in either wiki and either layout. */
export function pageKind(relative: string): PageKind {
  const parts = relative.split(/[\\/]/);
  if (parts[0] === "days") return "day";
  if (parts[0] === "characters") return "person";
  if (parts[0] === "entities" && parts[1] === "characters") return "person";
  return "concept";
}

/** Whether a page lives where a world not yet upgraded keeps places. */
const olderPlace = (relative: string): boolean =>
  /^entities[\\/]places[\\/]/.test(relative);

const LINK = /\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g;
const linksIn = (text: string): string[] =>
  [...text.matchAll(LINK)].map((match) => match[1].trim());

/** `[[id|words]]` as its words, `[[id]]` as `name(id)`: what a reader sees. */
export function plainLinks(
  text: string,
  name: (id: string) => string = (id) => id,
): string {
  return text.replace(
    /\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g,
    (_, id: string, words?: string) => words?.trim() || name(id.trim()),
  );
}

/** Never throws: a broken page still has an id, a body and a lint problem. */
/**
 * A `##` section, and who it is known by when its first paragraph says so
 * (`Known by: <ids>`, however many lines it wraps to).
 */
function sectionOf(title: string, body: string): Section {
  const [first = "", ...rest] = body.split(/\r?\n\s*\r?\n/);
  const restricted = first.replace(/\s+/g, " ").match(KNOWN_BY);
  return restricted
    ? {
        title,
        text: rest.join("\n\n").trim(),
        knownBy: restricted[1]
          .split(",")
          .map((who) => who.trim())
          .filter(Boolean),
      }
    : { title, text: body, knownBy: [] };
}

export function parsePage(raw: string, relative: string): Page {
  const problems: string[] = [];
  const id = path.basename(relative, ".md");
  const opening = raw.match(OPENING);
  let data: z.infer<typeof FRONTMATTER> = { groups: [], known: [], in: [] };
  if (opening) {
    try {
      const raw: unknown = YAML.parse(opening[1]) ?? {};
      const parsed = FRONTMATTER.safeParse(raw);
      if (parsed.success) data = parsed.data;
      else {
        problems.push(
          `front matter: ${parsed.error.issues
            .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
            .join("; ")}`,
        );
        // One bad entry goes alone: the rest of the front matter still holds.
        const kept = withoutIssues(raw, parsed.error.issues);
        const again = kept && FRONTMATTER.safeParse(kept);
        if (again?.success) data = again.data;
      }
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
        // A History of dated lines is events; one written as prose is just
        // a section, read like any other.
        if (!bulletLines(block.body).some((line) => HISTORY.test(line))) {
          sections.push(sectionOf(block.heading, block.body));
          break;
        }
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
      default:
        sections.push(sectionOf(block.heading, block.body));
    }
  }

  const linksAt: TieredLinks = {
    heard: linksIn(data.summary ?? ""),
    knows: [
      ...linksIn(lead),
      ...(data.connections ?? []).map((link) => link.to),
    ],
    // A part only the page's own character knows is never followed.
    close: sections
      .filter((section) => !section.knownBy.length)
      .flatMap((section) => linksIn(section.text)),
  };
  const links = new Set([
    ...linksIn(data.summary ?? ""),
    ...linksIn(body),
    ...(data.connections ?? []).map((link) => link.to),
  ]);

  const name = data.name ?? title ?? id;
  return {
    id,
    kind: pageKind(relative),
    path: relative.split(/[\\/]/).join("/"),
    place: data.place_id !== undefined || olderPlace(relative),
    group: data.group === true,
    length: raw.length,
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
    known: data.known.filter(({ ref }) => ref.toLowerCase() !== EVERYONE),
    ...everyoneOf(data.known),
    in: data.in.filter(({ ref }) => ref.toLowerCase() !== EVERYONE),
    legacyGroups: data.groups,
    ...(data.renown ? { renown: data.renown } : {}),
    knownBy: data.known_by ?? [],
    ...(data.parent ? { parent: data.parent } : {}),
    ...(data.home ? { home: data.home } : {}),
    ...(data.relation ? { relation: data.relation } : {}),
    ...(data.peer_id && data.peer_id !== id ? { personId: data.peer_id } : {}),
    ...(data.seen ? { seen: data.seen } : {}),
    touched: data.touched ?? [],
    links: [...links],
    linksAt,
    problems,
  };
}
