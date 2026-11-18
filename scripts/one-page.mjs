#!/usr/bin/env node
/**
 * Brings a world to one page per character, with only the front matter Kazusa
 * reads:
 *
 * - A character's IDENTITY.md and SOUL.md fold into their World Wiki page, which
 *   their turns read instead: IDENTITY's sections become the page's sections,
 *   SOUL's become sections only they know (`Known by: <id>`). The two files
 *   stay where they are, unread.
 * - On every page, `community`, `club` and `school` become `groups` (a club is
 *   close), `title` becomes `name`, `full_name` an alias, and fields Kazusa
 *   doesn't read move into a `## Details` section, where characters read them.
 *
 *   Node scripts/one-page.mjs <world folder> # says what it would do node
 *   scripts/one-page.mjs <world folder> --write # does it
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

/** What Kazusa reads, by kind; anything else moves into the text. */
const READ = {
  common: ["name", "aliases", "summary", "groups", "renown", "known_by"],
  person: ["home"],
  place: [
    "parent",
    "backdrop",
    "place_id",
    "entry_minutes",
    "connections",
    "map",
  ],
  concept: ["parent"],
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

const OPENING = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

/** Front matter and body; broken front matter is none. */
export function split(text) {
  const opening = OPENING.exec(text);
  let front = {};
  if (opening) {
    try {
      const parsed = YAML.parse(opening[1]);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
        front = parsed;
    } catch {
      front = {};
    }
  }
  return { front, body: text.slice(opening?.[0].length ?? 0) };
}

/** A body as its H1, opening and `##` sections, fences left whole. */
export function sectionsOf(body) {
  const blocks = [{ title: undefined, lines: [] }];
  let heading;
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
    else blocks.at(-1).lines.push(line);
  }
  const [lead, ...rest] = blocks;
  return {
    heading,
    lead: lead.lines.join("\n").trim(),
    sections: rest.map((block) => ({
      title: block.title,
      text: block.lines.join("\n").trim(),
    })),
  };
}

const list = (value) =>
  Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean)
    : typeof value === "string"
      ? value
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
      : [];

const display = (value) =>
  typeof value === "string"
    ? value
    : Array.isArray(value)
      ? value.map(display).join(", ")
      : YAML.stringify(value, { lineWidth: 0 }).trim();

const label = (key) => {
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
export function convertPage(text, kind, id, card) {
  const { front, body } = split(text);
  const page = sectionsOf(body);
  const identity = card?.identity ? split(card.identity) : undefined;
  const identityBody = identity ? sectionsOf(identity.body) : undefined;
  const soul = card?.soul ? sectionsOf(split(card.soul).body) : undefined;
  const fields = { ...(identity?.front ?? {}), ...front };

  const out = {};
  const name =
    fields.name ?? fields.title ?? page.heading ?? identityBody?.heading ?? id;
  out.name = String(name).trim();
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
      ].filter((alias) => alias && alias !== out.name),
    ),
  ];
  if (aliases.length) out.aliases = aliases;
  if (fields.summary) out.summary = String(fields.summary).trim();

  // Groups: what it belongs to, the nearest first; a person's club is close.
  const groups = [];
  const addGroup = (ref, close) => {
    if (!ref || groups.some((group) => group.ref === ref)) return;
    groups.push({ ref: String(ref).trim(), close });
  };
  if (
    fields.groups &&
    typeof fields.groups === "object" &&
    !Array.isArray(fields.groups)
  )
    for (const [ref, how] of Object.entries(fields.groups))
      addGroup(ref, how === "close");
  else for (const ref of list(fields.groups)) addGroup(ref, false);
  if (kind === "person") {
    for (const ref of list(fields.club)) addGroup(ref, true);
    for (const ref of list(fields.school)) addGroup(ref, false);
  }
  for (const ref of list(fields.community)) addGroup(ref, false);
  if (groups.length)
    out.groups = groups.some((group) => group.close)
      ? Object.fromEntries(
          groups.map(({ ref, close }) => [ref, close ? "close" : "member"]),
        )
      : groups.map(({ ref }) => ref);
  if (fields.renown) out.renown = fields.renown;
  if (list(fields.known_by).length) out.known_by = list(fields.known_by);
  for (const key of READ[kind] ?? [])
    if (fields[key] !== undefined && fields[key] !== null)
      out[key] = fields[key];

  const handled = new Set([
    ...READ.common,
    ...(READ[kind] ?? []),
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
    (key) => !READ.common.includes(key) && !(READ[kind] ?? []).includes(key),
  );
  if (!old && !identityBody && !soul) return text;

  // What the card and the unread fields add, after the page's own text.
  const titles = new Set(page.sections.map((section) => section.title));
  const added = [];
  // Text the page already holds isn't added again, under any heading.
  const flat = (words) => words.replace(/\s+/g, " ").trim();
  const holds = flat(body);
  const add = (title, words, check = words) => {
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
    const own = (words) => `Known by: ${id}\n\n${words}`;
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
  if (page.heading === undefined) own = `# ${out.name}\n\n${own}`;
  if (lead) {
    const end = own.indexOf("\n", own.indexOf("# ")) + 1 || own.length;
    own = `${own.slice(0, end)}\n${lead}\n${own.slice(end)}`;
  }
  const tail = added.length ? `\n\n${added.join("\n\n")}` : "";
  return `---\n${YAML.stringify(out, { lineWidth: 0 })}---\n\n${own.trimEnd()}${tail}\n`;
}

function kindOf(relative) {
  const [first, second] = relative.split(path.sep);
  if (first === "days") return "day";
  if (first === "entities" && second === "places") return "place";
  if (first === "entities" && second === "characters") return "person";
  return "concept";
}

function pagesIn(dir) {
  const out = [];
  const walk = (at) => {
    for (const entry of readdirSync(at)) {
      if (entry.startsWith(".")) continue;
      const full = path.join(at, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith(".md") && entry !== "INDEX.md") out.push(full);
    }
  };
  if (existsSync(dir)) walk(dir);
  return out;
}

/** The character workspaces holding cards, the system agent's aside. */
export function oldCards(world, systemAgent) {
  const root = path.join(world, "workspaces");
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((id) => id !== systemAgent && !id.startsWith("."))
    .filter((id) =>
      CARD_FILES.some((file) => existsSync(path.join(root, id, file))),
    );
}

const CARD_FILES = ["IDENTITY.md", "SOUL.md"];

/**
 * Converts a world folder; returns the pages it changed, writing only with
 * `write`. With `keep`, the original of every page it changes, and every card
 * it folds in, is copied under that folder first, and the cards move there, so
 * the conversion runs once and anything can be put back by hand.
 */
export function convertWorld(world, write, { keep, systemAgent } = {}) {
  const wiki = path.join(world, "shared", "wiki");
  const changed = [];
  for (const file of pagesIn(wiki)) {
    const relative = path.relative(wiki, file);
    const kind = kindOf(relative);
    const id = path.basename(file, ".md");
    const workspace = path.join(world, "workspaces", id);
    const read = (name) => {
      const at = path.join(workspace, name);
      return existsSync(at) ? readFileSync(at, "utf8") : undefined;
    };
    const card =
      kind === "person" && id !== systemAgent
        ? { identity: read("IDENTITY.md"), soul: read("SOUL.md") }
        : undefined;
    const before = readFileSync(file, "utf8");
    const after = convertPage(before, kind, id, card);
    if (after === before) continue;
    changed.push(relative);
    if (!write) continue;
    if (keep) {
      const copy = path.join(keep, "shared", "wiki", relative);
      mkdirSync(path.dirname(copy), { recursive: true });
      copyFileSync(file, copy);
    }
    writeFileSync(file, after);
  }
  if (write && keep)
    for (const id of oldCards(world, systemAgent)) {
      const aside = path.join(keep, "workspaces", id);
      mkdirSync(aside, { recursive: true });
      for (const name of CARD_FILES) {
        const from = path.join(world, "workspaces", id, name);
        if (existsSync(from)) renameSync(from, path.join(aside, name));
      }
    }
  return changed;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [world, flag] = process.argv.slice(2);
  if (!world || !existsSync(path.join(world, "shared", "wiki"))) {
    console.error("Usage: node scripts/one-page.mjs <world folder> [--write]");
    process.exit(1);
  }
  const write = flag === "--write";
  const changed = convertWorld(path.resolve(world), write);
  console.log(
    `${write ? "Rewrote" : "Would rewrite"} ${changed.length} pages.${write ? "" : " Run again with --write to do it."}`,
  );
}
