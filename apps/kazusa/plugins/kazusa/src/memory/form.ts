import YAML from "yaml";
import type { WikiPageForm, WikiPageFormFields } from "@kazusa/client";
import { EVERYONE, levelOf, type Level, type PageKind } from "./page.ts";

/*
 * A page as the Wiki's form edits it, and back: the front matter fields Kazusa
 * reads, then one field per level of detail (the summary, the opening, what
 * those close to it know, and on a character's own page what only they know).
 * The last two are Markdown whose `## Title` lines start each topic, which is
 * how the page keeps them. Fields Kazusa keeps but the form doesn't show (a
 * place's map and connections, what sleep writes) stay as they were; anything
 * else is the author's own, shown so it can be moved into the text.
 */

export interface PageSpot {
  readonly id: string;
  readonly kind: PageKind;
  /** In a character's own wiki, not the world's. */
  readonly personal: boolean;
}

/** Fields the form edits, by the kind of page and whose wiki. */
function formKeys({ kind, personal }: PageSpot): readonly string[] {
  if (personal) return ["name", "aliases", "summary", "relation"];
  const common = ["name", "aliases", "summary", "known"];
  if (kind === "person") return [...common, "in", "home"];
  // A concept's components: a group, a place and the place's fields.
  if (kind === "concept")
    return [
      ...common,
      "group",
      "place_id",
      "parent",
      "backdrop",
      "entry_minutes",
      "connections",
      "map",
    ];
  return ["name", "summary"];
}

/** The place component's fields, gone together when it is taken off. */
const PLACE_FIELDS = [
  "place_id",
  "parent",
  "backdrop",
  "entry_minutes",
  "connections",
  "map",
];

/** Whether the page can have parts only its own character knows. */
const hasOwnVoice = ({ kind, personal }: PageSpot): boolean =>
  kind === "person" && !personal;

/** Read by Kazusa, set elsewhere (the map, a night's sleep): kept as written. */
const KEPT = new Set([
  "seen",
  "touched",
  "peer_id",
  // Deprecated: kept as written until the world is upgraded (`legacy.ts`).
  "groups",
  "renown",
  "known_by",
]);

/** A topic written before any `## Title` gets this one. */
const UNTITLED = { close: "About", only: "Inner voice" } as const;

const OPENING = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
const KNOWN_BY = /^Known by:\s*(.+)$/i;

const asList = (value: unknown): string[] =>
  Array.isArray(value)
    ? value
        .map(String)
        .map((item) => item.trim())
        .filter(Boolean)
    : typeof value === "string"
      ? value
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
      : [];

const asText = (value: unknown): string | undefined =>
  typeof value === "string" || typeof value === "number"
    ? String(value).trim() || undefined
    : undefined;

/** A level as written, read the way pages read it; anything else is `knows`. */
const asLevel = (value: unknown): Level => levelOf(value) ?? "knows";

function groupsOf(value: unknown): WikiPageFormFields["groups"] {
  if (value && typeof value === "object" && !Array.isArray(value))
    return Object.entries(value as Record<string, unknown>).map(
      ([ref, how]) => ({
        ref: ref.trim().toLowerCase() === EVERYONE ? EVERYONE : ref.trim(),
        level: asLevel(how),
      }),
    );
  return asList(value).map((ref) => ({ ref, level: "knows" as const }));
}

type Route = NonNullable<WikiPageFormFields["connections"]>[number];

/** A place's routes, keeping only what the map can use. */
function routesOf(value: unknown): Route[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): Route[] => {
    if (!item || typeof item !== "object") return [];
    const { to, ways, note } = item as Record<string, unknown>;
    const kept = (Array.isArray(ways) ? ways : []).flatMap((way) => {
      const { by, minutes } = (way ?? {}) as Record<string, unknown>;
      return typeof by === "string" &&
        by.trim() &&
        typeof minutes === "number" &&
        minutes >= 0
        ? [{ by: by.trim(), minutes }]
        : [];
    });
    if (typeof to !== "string" || !to.trim() || !kept.length) return [];
    return [
      {
        to: to.trim(),
        ways: kept,
        ...(typeof note === "string" && note.trim()
          ? { note: note.trim() }
          : {}),
      },
    ];
  });
}

/** How a value the form doesn't read looks in the text it can move into. */
function display(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(display).join(", ");
  return YAML.stringify(value, { lineWidth: 0 }).trim();
}

function frontOf(text: string): Record<string, unknown> {
  const opening = OPENING.exec(text);
  try {
    const parsed: unknown = opening ? YAML.parse(opening[1]) : undefined;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
      return parsed as Record<string, unknown>;
  } catch {
    // Broken front matter reads as none; lint says so.
  }
  return {};
}

interface Topic {
  readonly title: string;
  readonly text: string;
}

/** `## Title` blocks of Markdown, fences left whole; `head` is before any. */
function topicsOf(markdown: string): { head: string; topics: Topic[] } {
  const blocks: { title?: string; lines: string[] }[] = [{ lines: [] }];
  let fenced = false;
  for (const line of markdown.split(/\r?\n/)) {
    if (/^(```|~~~)/.test(line)) fenced = !fenced;
    const heading = fenced ? undefined : /^## +(.+?)\s*$/.exec(line);
    if (heading) blocks.push({ title: heading[1], lines: [] });
    else blocks.at(-1)!.lines.push(line);
  }
  const [head, ...rest] = blocks;
  return {
    head: head.lines.join("\n").trim(),
    topics: rest.map((block) => ({
      title: block.title ?? "",
      text: block.lines.join("\n").trim(),
    })),
  };
}

/** Topics as one field: the first, if it has the untitled name, bare. */
function fieldOf(topics: readonly Topic[], untitled: string): string {
  return topics
    .map(({ title, text }, at) =>
      at === 0 && title === untitled
        ? text
        : [`## ${title}`, text].filter(Boolean).join("\n\n"),
    )
    .join("\n\n");
}

/** A field back as topics; what comes before any `## Title` is `untitled`. */
function topicsFrom(field: string, untitled: string): Topic[] {
  const { head, topics } = topicsOf(field);
  return [...(head ? [{ title: untitled, text: head }] : []), ...topics];
}

/**
 * Aliases as saved: a page renamed keeps its old name as one, so what names it
 * by that name (another page's `groups`, a link, a character's memory) still
 * finds it.
 */
function aliasesAfter(
  was: WikiPageFormFields,
  now: WikiPageFormFields,
): string[] {
  const aliases = now.aliases.map((alias) => alias.trim()).filter(Boolean);
  const old = was.name?.trim();
  const name = now.name?.trim();
  const known = (value: string) =>
    [name, ...aliases].some(
      (other) => other?.toLowerCase() === value.toLowerCase(),
    );
  return old && name && !known(old) ? [...aliases, old] : aliases;
}

/** A page's text split into what the form edits. */
export function splitPage(
  text: string,
  spot: PageSpot,
): Pick<WikiPageForm, "fields" | "kept" | "other" | "lead" | "close" | "only"> {
  const opening = OPENING.exec(text);
  const front = frontOf(text);
  const keys = formKeys(spot);
  const fields: WikiPageFormFields = {
    aliases: asList(front.aliases),
    groups: keys.includes("known") ? groupsOf(front.known) : [],
    ...(keys.includes("in") ? { in: groupsOf(front.in) } : {}),
    ...(keys.includes("group") ? { group: front.group === true } : {}),
    ...(keys.includes("place_id")
      ? { place: front.place_id !== undefined }
      : {}),
  };
  const set = (key: keyof WikiPageFormFields, value: string | undefined) => {
    if (value !== undefined) (fields as Record<string, unknown>)[key] = value;
  };
  for (const key of keys) {
    if (key === "name") set("name", asText(front.name));
    if (key === "summary") set("summary", asText(front.summary));
    if (key === "home") set("home", asText(front.home));
    if (key === "parent") set("parent", asText(front.parent));
    if (key === "backdrop") set("backdrop", asText(front.backdrop));
    if (key === "relation") set("relation", asText(front.relation));
    if (key === "entry_minutes" && typeof front.entry_minutes === "number")
      fields.entryMinutes = front.entry_minutes;
    if (key === "connections") fields.connections = routesOf(front.connections);
  }
  const kept = Object.keys(front).filter(
    (key) => KEPT.has(key) || (key === "map" && keys.includes(key)),
  );
  const other = Object.entries(front)
    .filter(([key]) => !KEPT.has(key) && !keys.includes(key))
    .map(([key, value]) => ({ key, value: display(value) }));

  // The body: an H1, the opening, then `##` topics.
  let body = text.slice(opening?.[0].length ?? 0);
  const title = /^\s*# +(.+?)\s*$/m.exec(body.split(/\r?\n## /)[0] ?? "");
  if (title) {
    if (!fields.name) fields.name = title[1];
    body = body.replace(title[0], "");
  }
  const { head, topics } = topicsOf(body);
  const close: Topic[] = [];
  const only: Topic[] = [];
  for (const topic of topics) {
    const [first = "", ...after] = topic.text.split(/\r?\n\s*\r?\n/);
    const who = KNOWN_BY.exec(first.replace(/\s+/g, " "))?.[1]
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean);
    // An older part naming others keeps its line, so saving changes nothing.
    if (hasOwnVoice(spot) && who?.length === 1 && who[0] === spot.id)
      only.push({ title: topic.title, text: after.join("\n\n").trim() });
    else close.push(topic);
  }
  return {
    fields,
    kept,
    other,
    lead: head,
    close: fieldOf(close, UNTITLED.close),
    only: fieldOf(only, UNTITLED.only),
  };
}

/**
 * The page's text from the form: its fields in a fixed order, then what Kazusa
 * keeps from `original`, then the author's own fields unless `moveOther` puts
 * them into a Details topic at the end.
 */
export function composePage(
  original: string,
  form: Pick<WikiPageForm, "fields" | "lead" | "close" | "only">,
  moveOther: boolean,
  spot: PageSpot,
): string {
  const was = splitPage(original, spot);
  const front = frontOf(original);
  const { fields } = form;
  const out: Record<string, unknown> = {};
  const put = (key: string, value: unknown) => {
    if (value === undefined || value === "") return;
    if (Array.isArray(value) && value.length === 0) return;
    if (value && typeof value === "object" && !Object.keys(value).length)
      return;
    out[key] = value;
  };
  for (const key of formKeys(spot)) {
    if (key === "name") put("name", fields.name?.trim());
    if (key === "aliases") put("aliases", aliasesAfter(was.fields, fields));
    if (key === "summary") put("summary", fields.summary?.trim());
    const rows = (list: WikiPageFormFields["groups"] | undefined) =>
      Object.fromEntries(
        (list ?? [])
          .filter(({ ref }) => ref.trim())
          .map(({ ref, level }) => [ref.trim(), level]),
      );
    if (key === "known") put("known", rows(fields.groups));
    if (key === "in")
      put(
        "in",
        rows(fields.in?.filter(({ ref }) => ref.toLowerCase() !== EVERYONE)),
      );
    if (key === "group" && fields.group) put("group", true);
    if (key === "home") put("home", fields.home?.trim());
    if (key === "relation") put("relation", fields.relation?.trim());
    // The place component: on, it keeps the map's own fields.
    if (fields.place && PLACE_FIELDS.includes(key)) {
      if (key === "place_id")
        put("place_id", asText(front.place_id) ?? spot.id);
      if (key === "parent") put("parent", fields.parent?.trim());
      if (key === "backdrop") put("backdrop", fields.backdrop?.trim());
      if (key === "entry_minutes") put("entry_minutes", fields.entryMinutes);
      if (key === "connections")
        put("connections", routesOf(fields.connections));
      if (key === "map") put("map", front.map);
    }
  }
  for (const key of was.kept) if (key !== "map") out[key] = front[key];
  if (!moveOther) for (const { key } of was.other) out[key] = front[key];

  const close = topicsFrom(form.close, UNTITLED.close);
  if (moveOther && was.other.length) {
    const facts = was.other.map(({ key, value }) => {
      const label = key.replace(/[_-]+/g, " ");
      return `- ${label.charAt(0).toUpperCase()}${label.slice(1)}: ${value}`;
    });
    const details = close.findIndex(({ title }) => title === "Details");
    if (details >= 0)
      close[details] = {
        ...close[details],
        text: [close[details].text, ...facts].filter(Boolean).join("\n"),
      };
    else close.push({ title: "Details", text: facts.join("\n") });
  }
  const only = hasOwnVoice(spot)
    ? topicsFrom(form.only, UNTITLED.only).map(({ title, text }) => ({
        title,
        text: [`Known by: ${spot.id}`, text].filter(Boolean).join("\n\n"),
      }))
    : [];

  const head = Object.keys(out).length
    ? `---\n${YAML.stringify(out, { lineWidth: 0 })}---\n\n`
    : "";
  // The heading stays as written (`# Club (部)`) until the name changes.
  const name = fields.name?.trim() || "Untitled";
  const written = /^\s*# +(.+?)\s*$/m.exec(
    original
      .slice(OPENING.exec(original)?.[0].length ?? 0)
      .split(/\r?\n## /)[0] ?? "",
  )?.[1];
  const parts = [
    `# ${written && name === was.fields.name?.trim() ? written : name}`,
  ];
  if (form.lead.trim()) parts.push(form.lead.trim());
  for (const { title, text } of [...close, ...only])
    parts.push(
      [`## ${title.trim() || "Untitled"}`, text.trim()]
        .filter(Boolean)
        .join("\n\n"),
    );
  return `${head}${parts.join("\n\n")}\n`;
}

/**
 * A character's page with their place in one group set (`level`) or taken out
 * (`undefined`). `names` are what the page may call the group by; the rest of
 * the page is kept as written.
 */
export function withMembership(
  text: string,
  group: string,
  names: readonly string[],
  level: Level | undefined,
): string {
  const opening = OPENING.exec(text);
  const front = frontOf(text);
  const body = text.slice(opening?.[0].length ?? 0);
  const said = new Set(names.map((name) => name.toLowerCase()));
  const groups = Object.fromEntries(
    groupsOf(front.in)
      .filter(({ ref }) => !said.has(ref.toLowerCase()))
      .map(({ ref, level: how }) => [ref, how]),
  );
  if (level) groups[group] = level;
  const out: Record<string, unknown> = {};
  let placed = false;
  for (const [key, value] of Object.entries(front)) {
    if (key === "in") {
      if (Object.keys(groups).length) out.in = groups;
      placed = true;
    } else out[key] = value;
  }
  if (!placed && Object.keys(groups).length) out.in = groups;
  return `---\n${YAML.stringify(out, { lineWidth: 0 })}---\n${body.startsWith("\n") ? "" : "\n"}${body}`;
}
