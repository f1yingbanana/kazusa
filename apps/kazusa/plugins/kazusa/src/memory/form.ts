import YAML from "yaml";
import type { WikiPageForm, WikiPageFormFields } from "@kazusa/client";
import type { PageKind } from "./page.ts";

/*
 * A page as the Wiki's form edits it, and back: the front matter fields Kazusa
 * reads, the opening, and the sections with who knows each. Fields Kazusa
 * keeps but the form doesn't show (a place's map and connections, what sleep
 * writes) stay as they were; anything else is the author's own, shown so it
 * can be moved into the text, where it is read like everything else.
 */

/** Fields the form edits, by the kind of page and whose wiki. */
function formKeys(kind: PageKind, personal: boolean): readonly string[] {
  const common = ["name", "aliases", "summary", "groups", "renown", "known_by"];
  if (personal) return ["name", "aliases", "summary", "relation"];
  if (kind === "person") return [...common, "home"];
  if (kind === "place") return [...common, "parent", "backdrop"];
  if (kind === "concept") return [...common, "parent"];
  return ["name", "summary"];
}

/** Read by Kazusa, set elsewhere (the map, a night's sleep): kept as written. */
const KEPT = new Set([
  "place_id",
  "entry_minutes",
  "connections",
  "map",
  "seen",
  "touched",
  "peer_id",
]);

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

function groupsOf(value: unknown): WikiPageFormFields["groups"] {
  if (value && typeof value === "object" && !Array.isArray(value))
    return Object.entries(value as Record<string, unknown>).map(
      ([ref, how]) => ({ ref: ref.trim(), close: how === "close" }),
    );
  return asList(value).map((ref) => ({ ref, close: false }));
}

/** How a value the form doesn't read looks in the text it can move into. */
function display(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(display).join(", ");
  return YAML.stringify(value, { lineWidth: 0 }).trim();
}

/** A page's text split into what the form edits. */
export function splitPage(
  text: string,
  kind: PageKind,
  personal: boolean,
): Pick<WikiPageForm, "fields" | "kept" | "other" | "lead" | "sections"> {
  const opening = OPENING.exec(text);
  let front: Record<string, unknown> = {};
  if (opening) {
    try {
      const parsed: unknown = YAML.parse(opening[1]);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
        front = parsed as Record<string, unknown>;
    } catch {
      // Broken front matter reads as none; lint says so.
    }
  }
  const keys = formKeys(kind, personal);
  const fields: WikiPageFormFields = {
    aliases: asList(front.aliases),
    groups: groupsOf(front.groups),
    knownBy: asList(front.known_by),
  };
  const set = (key: keyof WikiPageFormFields, value: string | undefined) => {
    if (value !== undefined) (fields as Record<string, unknown>)[key] = value;
  };
  for (const key of keys) {
    if (key === "name") set("name", asText(front.name));
    if (key === "summary") set("summary", asText(front.summary));
    if (key === "renown") set("renown", asText(front.renown));
    if (key === "home") set("home", asText(front.home));
    if (key === "parent") set("parent", asText(front.parent));
    if (key === "backdrop") set("backdrop", asText(front.backdrop));
    if (key === "relation") set("relation", asText(front.relation));
  }
  const kept = Object.keys(front).filter((key) => KEPT.has(key));
  const other = Object.entries(front)
    .filter(([key]) => !KEPT.has(key) && !keys.includes(key))
    .map(([key, value]) => ({ key, value: display(value) }));

  // The body: an H1, the opening, then `##` sections, fences left whole.
  const body = text.slice(opening?.[0].length ?? 0);
  const blocks: { title?: string; lines: string[] }[] = [{ lines: [] }];
  let fenced = false;
  let titled = false;
  for (const line of body.split(/\r?\n/)) {
    if (/^(```|~~~)/.test(line)) fenced = !fenced;
    if (!fenced && !titled && blocks.length === 1 && /^# /.test(line)) {
      titled = true;
      if (!fields.name) fields.name = line.slice(2).trim();
      continue;
    }
    const heading = fenced ? undefined : /^## +(.+?)\s*$/.exec(line);
    if (heading) blocks.push({ title: heading[1], lines: [] });
    else blocks.at(-1)!.lines.push(line);
  }
  const [lead, ...rest] = blocks;
  return {
    fields,
    kept,
    other,
    lead: lead.lines.join("\n").trim(),
    sections: rest.map((block) => {
      const textOf = block.lines.join("\n").trim();
      const [first = "", ...after] = textOf.split(/\r?\n\s*\r?\n/);
      const restricted = KNOWN_BY.exec(first.replace(/\s+/g, " "));
      return restricted
        ? {
            title: block.title ?? "",
            knownBy: restricted[1]
              .split(",")
              .map((who) => who.trim())
              .filter(Boolean),
            text: after.join("\n\n").trim(),
          }
        : { title: block.title ?? "", knownBy: [], text: textOf };
    }),
  };
}

/**
 * The page's text from the form: its fields in a fixed order, then what Kazusa
 * keeps from `original`, then the author's own fields unless `moveOther` puts
 * them into a Details section at the end.
 */
export function composePage(
  original: string,
  form: Pick<WikiPageForm, "fields" | "lead" | "sections">,
  moveOther: boolean,
  kind: PageKind,
  personal: boolean,
): string {
  const was = splitPage(original, kind, personal);
  const opening = OPENING.exec(original);
  let front: Record<string, unknown> = {};
  try {
    const parsed: unknown = opening ? YAML.parse(opening[1]) : undefined;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
      front = parsed as Record<string, unknown>;
  } catch {
    front = {};
  }
  const { fields } = form;
  const groups = fields.groups.filter(({ ref }) => ref.trim());
  const out: Record<string, unknown> = {};
  const put = (key: string, value: unknown) => {
    if (value === undefined || value === "") return;
    if (Array.isArray(value) && value.length === 0) return;
    out[key] = value;
  };
  const keys = formKeys(kind, personal);
  for (const key of keys) {
    if (key === "name") put("name", fields.name?.trim());
    if (key === "aliases") put("aliases", fields.aliases);
    if (key === "summary") put("summary", fields.summary?.trim());
    if (key === "groups")
      put(
        "groups",
        groups.some(({ close }) => close)
          ? Object.fromEntries(
              groups.map(({ ref, close }) => [
                ref.trim(),
                close ? "close" : "member",
              ]),
            )
          : groups.map(({ ref }) => ref.trim()),
      );
    if (key === "renown") put("renown", fields.renown);
    if (key === "known_by") put("known_by", fields.knownBy);
    if (key === "home") put("home", fields.home?.trim());
    if (key === "parent") put("parent", fields.parent?.trim());
    if (key === "backdrop") put("backdrop", fields.backdrop?.trim());
    if (key === "relation") put("relation", fields.relation?.trim());
  }
  for (const key of was.kept) out[key] = front[key];
  if (!moveOther) for (const { key } of was.other) out[key] = front[key];

  const sections = [...form.sections];
  if (moveOther && was.other.length) {
    const facts = was.other.map(({ key, value }) => {
      const label = key.replace(/[_-]+/g, " ");
      return `- ${label.charAt(0).toUpperCase()}${label.slice(1)}: ${value}`;
    });
    const details = sections.findIndex(({ title }) => title === "Details");
    if (details >= 0)
      sections[details] = {
        ...sections[details],
        text: [sections[details].text, ...facts].filter(Boolean).join("\n"),
      };
    else
      sections.push({ title: "Details", knownBy: [], text: facts.join("\n") });
  }

  const head = Object.keys(out).length
    ? `---\n${YAML.stringify(out, { lineWidth: 0 })}---\n\n`
    : "";
  const parts = [`# ${fields.name?.trim() || "Untitled"}`];
  if (form.lead.trim()) parts.push(form.lead.trim());
  for (const section of sections) {
    const lines = [`## ${section.title.trim() || "Untitled"}`];
    if (section.knownBy.length)
      lines.push(`Known by: ${section.knownBy.join(", ")}`);
    if (section.text.trim()) lines.push(section.text.trim());
    parts.push(lines.join("\n\n"));
  }
  return `${head}${parts.join("\n\n")}\n`;
}
