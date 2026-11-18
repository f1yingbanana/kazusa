/**
 * One page per character, with only the front matter Kazusa reads: a
 * character's IDENTITY.md and SOUL.md fold into their World Wiki page (SOUL's
 * parts known only by them), `community`, `club` and `school` become `groups`,
 * `title` becomes `name`, `full_name` an alias, and fields nothing reads move
 * into a `## Details` section. `world_update` runs it when a world updates to a
 * release in the two-folder layout, on both sides, so the creator's cards and
 * play's changes to them meet on the page.
 */
import YAML from "yaml";

/** A page's kind, as the fold reads it. */
export type FoldKind = "person" | "place" | "concept" | "day";

/** A character's IDENTITY.md and SOUL.md texts, when they have them. */
export interface Card {
  readonly identity?: string | undefined;
  readonly soul?: string | undefined;
}

type Front = Record<string, unknown>;

/** What Kazusa reads, by kind; anything else moves into the text. */
const PLACE_FIELDS = [
  "parent",
  "backdrop",
  "place_id",
  "entry_minutes",
  "connections",
  "map",
];
const READ: Readonly<Record<FoldKind | "common", readonly string[]>> = {
  // The two-folder layout's fields too: a page already in it loses nothing.
  common: [
    "name",
    "aliases",
    "summary",
    "groups",
    "renown",
    "known_by",
    "known",
    "group",
  ],
  person: ["home", "in"],
  place: PLACE_FIELDS,
  concept: PLACE_FIELDS,
  day: [],
};

/** Bookkeeping nothing reads, and nobody needs to keep. */
const DROPPED = new Set([
  "pageType",
  "entityType",
  "conceptType",
  "id",
  "wiki_id",
  "character_id",
  "agent_id",
  "is_simulated_agent",
  "avatar",
  "avatarUrl",
]);

/** The two files a character's card was. */
export const CARD_FILES = ["IDENTITY.md", "SOUL.md"] as const;

const OPENING = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

/** Front matter and body; broken front matter is none. */
export function split(text: string): { front: Front; body: string } {
  const opening = OPENING.exec(text);
  let front: Front = {};
  if (opening) {
    try {
      const parsed: unknown = YAML.parse(opening[1]);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
        front = parsed as Front;
    } catch {
      front = {};
    }
  }
  return { front, body: text.slice(opening?.[0].length ?? 0) };
}

interface Sections {
  readonly heading: string | undefined;
  readonly lead: string;
  readonly sections: readonly { title: string; text: string }[];
}

/** A body as its H1, opening and `##` sections, fences left whole. */
export function sectionsOf(body: string): Sections {
  const blocks: { title: string | undefined; lines: string[] }[] = [
    { title: undefined, lines: [] },
  ];
  let heading: string | undefined;
  let fenced = false;
  for (const line of body.split(/\r?\n/)) {
    if (/^(```|~~~)/.test(line)) fenced = !fenced;
    if (
      !fenced &&
      heading === undefined &&
      blocks.length === 1 &&
      /^# /.test(line)
    ) {
      heading = line.slice(2).trim();
      continue;
    }
    const opened = fenced ? undefined : /^## +(.+?)\s*$/.exec(line);
    if (opened) blocks.push({ title: opened[1], lines: [] });
    else blocks.at(-1)!.lines.push(line);
  }
  const [lead, ...rest] = blocks;
  return {
    heading,
    lead: lead.lines.join("\n").trim(),
    sections: rest.map((block) => ({
      title: block.title!,
      text: block.lines.join("\n").trim(),
    })),
  };
}

const list = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean)
    : typeof value === "string"
      ? value
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
      : [];

/** A front matter value as text: a scalar as it reads, anything else as YAML. */
const asText = (value: unknown): string =>
  value !== null && typeof value === "object"
    ? YAML.stringify(value, { lineWidth: 0 }).trim()
    : String(value);

const isMap = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const display = (value: unknown): string =>
  typeof value === "string"
    ? value
    : Array.isArray(value)
      ? value.map(display).join(", ")
      : YAML.stringify(value, { lineWidth: 0 }).trim();

const label = (key: string): string => {
  const words = key.replace(/[_-]+/g, " ");
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
};

/**
 * One page in the new shape, or the page as it was when it needs nothing.
 * `card` is a character's IDENTITY.md and SOUL.md texts, when they have them.
 *
 * Nothing written on the page is lost: only its front matter is replaced, and
 * its text stays as it is, byte for byte. What the card adds, and fields Kazusa
 * doesn't read, are appended as sections after it; a section the page already
 * has isn't added again.
 */
export function convertPage(
  text: string,
  kind: FoldKind,
  id: string,
  card?: Card,
): string {
  const { front, body } = split(text);
  const page = sectionsOf(body);
  const identity = card?.identity ? split(card.identity) : undefined;
  const identityBody = identity ? sectionsOf(identity.body) : undefined;
  const soul = card?.soul ? sectionsOf(split(card.soul).body) : undefined;
  const fields: Front = { ...(identity?.front ?? {}), ...front };

  const out: Front = {};
  const name =
    fields.name ?? fields.title ?? page.heading ?? identityBody?.heading ?? id;
  out.name = asText(name).trim();
  const fullName =
    typeof fields.full_name === "string"
      ? fields.full_name.replace(/\s*\(([^)]*)\)\s*$/, "").trim()
      : undefined;
  const nativeName =
    typeof fields.full_name === "string"
      ? /\(([^)]+)\)\s*$/.exec(fields.full_name)?.[1]?.trim()
      : undefined;
  const aliases = [
    ...new Set(
      [
        ...list(fields.aliases),
        ...list(fields.handle),
        fullName,
        nativeName,
      ].filter(
        (alias): alias is string => Boolean(alias) && alias !== out.name,
      ),
    ),
  ];
  if (aliases.length) out.aliases = aliases;
  if (fields.summary) out.summary = asText(fields.summary).trim();

  // Groups: what it belongs to, the nearest first; a person's club is close.
  const groups: { ref: string; how: string | undefined }[] = [];
  const addGroup = (ref: unknown, how: string | undefined) => {
    if (!ref || groups.some((group) => group.ref === asText(ref).trim()))
      return;
    groups.push({ ref: asText(ref).trim(), how });
  };
  if (isMap(fields.groups))
    for (const [ref, how] of Object.entries(fields.groups))
      addGroup(ref, String(how));
  else for (const ref of list(fields.groups)) addGroup(ref, undefined);
  if (kind === "person") {
    for (const ref of list(fields.club)) addGroup(ref, "close");
    for (const ref of list(fields.school)) addGroup(ref, "member");
  }
  for (const ref of list(fields.community)) addGroup(ref, "member");
  if (groups.length)
    out.groups = groups.some((group) => group.how)
      ? Object.fromEntries(groups.map(({ ref, how }) => [ref, how ?? "member"]))
      : groups.map(({ ref }) => ref);
  if (fields.renown) out.renown = fields.renown;
  if (list(fields.known_by).length) out.known_by = list(fields.known_by);
  for (const key of READ[kind])
    if (fields[key] !== undefined && fields[key] !== null)
      out[key] = fields[key];

  const handled = new Set([
    ...READ.common,
    ...READ[kind],
    "title",
    "full_name",
    "handle",
    "community",
    ...(kind === "person" ? ["club", "school"] : []),
  ]);
  const unread = Object.entries(fields)
    .filter(([key]) => !handled.has(key) && !DROPPED.has(key))
    .filter(
      ([, value]) => value !== undefined && value !== null && value !== "",
    );
  const old = Object.keys(fields).some(
    (key) => !READ.common.includes(key) && !READ[kind].includes(key),
  );
  if (!old && !identityBody && !soul) return text;

  // What the card and the unread fields add, after the page's own text.
  const titles = new Set(page.sections.map((section) => section.title));
  const added: string[] = [];
  // Text the page already holds isn't added again, under any heading.
  const flat = (words: string) => words.replace(/\s+/g, " ").trim();
  const holds = flat(body);
  const add = (title: string, words: string, check = words) => {
    if (!words.trim() || holds.includes(flat(check).slice(0, 120))) return;
    let heading = title;
    for (let n = 2; titles.has(heading); n += 1) heading = `${title} (${n})`;
    titles.add(heading);
    added.push(`## ${heading}\n\n${words.trim()}`);
  };
  const lead = !page.lead && identityBody?.lead ? identityBody.lead : undefined;
  if (identityBody) {
    // Whatever of its opening the page doesn't already say, paragraph by
    // paragraph, and every section (a twin of one on the page under a new
    // heading, unless the page already holds its words).
    if (page.lead && identityBody.lead) {
      const missing = identityBody.lead
        .split(/\n\s*\n/)
        .filter((paragraph) => !holds.includes(flat(paragraph)));
      if (missing.length) add("About", missing.join("\n\n"));
    }
    for (const section of identityBody.sections)
      add(section.title, section.text);
  }
  if (soul) {
    const own = (words: string) => `Known by: ${id}\n\n${words}`;
    if (soul.lead) add("Inner voice", own(soul.lead), soul.lead);
    for (const section of soul.sections)
      add(
        titles.has(section.title) ? `${section.title} (inside)` : section.title,
        own(section.text),
        section.text,
      );
  }
  if (unread.length)
    add(
      "Details",
      unread
        .map(([key, value]) => `- ${label(key)}: ${display(value)}`)
        .join("\n"),
    );

  // The page's own text, untouched but for a heading or opening it lacked.
  let own = body.replace(/^\s+/, "");
  if (page.heading === undefined) own = `# ${String(out.name)}\n\n${own}`;
  if (lead) {
    const end = own.indexOf("\n", own.indexOf("# ")) + 1 || own.length;
    own = `${own.slice(0, end)}\n${lead}\n${own.slice(end)}`;
  }
  const tail = added.length ? `\n\n${added.join("\n\n")}` : "";
  return `---\n${YAML.stringify(out, { lineWidth: 0 })}---\n\n${own.trimEnd()}${tail}\n`;
}

/** A World Wiki page's kind for the fold, from its path under the wiki. */
export function foldKind(relative: string): FoldKind {
  const [first, second] = relative.split(/[\\/]/);
  if (first === "days") return "day";
  if (first === "characters") return "person";
  if (first === "entities" && second === "places") return "place";
  if (first === "entities" && second === "characters") return "person";
  return "concept";
}
