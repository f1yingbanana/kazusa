import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import type { Certainty } from "./page.ts";

const MAX_ATTEMPTS = 3;

const hash = (text: string): string =>
  createHash("sha256").update(text).digest("hex");
const read = (file: string): string | undefined =>
  existsSync(file) ? readFileSync(file, "utf8") : undefined;

/**
 * Applies one operation to a file: read, change, and if someone else wrote
 * meanwhile, start over from what they wrote, so a human edit always survives.
 */
export function applyOperation(
  file: string,
  operation: (current: string | undefined) => string,
): void {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const before = read(file);
    const next = operation(before);
    const current = read(file);
    if ((before && hash(before)) !== (current && hash(current))) continue;
    mkdirSync(path.dirname(file), { recursive: true });
    const temporary = path.join(
      path.dirname(file),
      `.${path.basename(file)}.${randomUUID()}.tmp`,
    );
    writeFileSync(temporary, next, { flag: "wx" });
    renameSync(temporary, file);
    return;
  }
  throw new Error(`${path.basename(file)} kept changing; try again.`);
}

const oneLine = (text: string): string => text.replace(/\s+/g, " ").trim();

export interface NewNote {
  readonly date: string;
  readonly source: string;
  readonly certainty: Certainty;
  readonly text: string;
}

/** The newest note goes first, under `## Notes`, which is made if missing. */
export function withNote(raw: string, note: NewNote): string {
  const line = `- ${note.date} · ${note.source} · ${note.certainty} — ${oneLine(note.text)}`;
  const heading = raw.match(/^## Notes[ \t]*\r?\n+/m);
  if (heading?.index !== undefined) {
    const at = heading.index + heading[0].length;
    return `${raw.slice(0, at)}${line}\n${raw.slice(at)}`;
  }
  return `${raw.trimEnd()}\n\n## Notes\n\n${line}\n`;
}

/** A plan goes under its day's heading in `MEMORY.md`, which is made if missing. */
export function withPlan(raw: string, date: string, plan: string): string {
  const title = `## Plans recorded for ${date}`;
  const at = raw.indexOf(title);
  const line = `- ${oneLine(plan)}`;
  if (at < 0) return `${raw.trimEnd()}\n\n${title}\n\n${line}\n`;
  const rest = raw.slice(at + title.length);
  const next = rest.search(/^## /m);
  const end = next < 0 ? raw.length : at + title.length + next;
  const section = raw.slice(at, end).trimEnd();
  return `${raw.slice(0, at)}${section}\n${line}\n${next < 0 ? "" : "\n"}${raw.slice(end)}`;
}

/** The whole of a page that does not exist yet. */
export function newPage(name: string, learned: string): string {
  return `---\nname: ${JSON.stringify(name)}\nlearned: ${JSON.stringify(learned)}\n---\n\n# ${name}\n`;
}

const OPENING = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

/** Sets one simple front matter field, leaving the rest as it was written. */
export function withField(raw: string, field: string, value: string): string {
  const opening = raw.match(OPENING);
  const line = `${field}: ${value}`;
  if (!opening) return `---\n${line}\n---\n\n${raw}`;
  const pattern = new RegExp(`^${field}:.*$`, "m");
  const head = pattern.test(opening[1])
    ? opening[1].replace(pattern, line)
    : `${opening[1]}\n${line}`;
  return `---\n${head}\n---\n${raw.slice(opening[0].length)}`;
}

/** Replaces a page's lead, the text between the H1 and the first section. */
export function withLead(raw: string, lead: string): string {
  const opening = raw.match(OPENING)?.[0] ?? "";
  const body = raw.slice(opening.length);
  const title = body.match(/^\s*# .+\r?\n/)?.[0] ?? "";
  const rest = body.slice(title.length);
  const section = rest.search(/^## /m);
  const tail = section < 0 ? "" : rest.slice(section);
  return `${opening}${title ? `${title.trimEnd()}\n\n` : "\n"}${lead.trim()}\n${tail ? `\n${tail}` : ""}`;
}

/** Replaces one `##` section's body, or adds the section before `## Notes`. */
export function withSection(raw: string, title: string, body: string): string {
  const at = raw.search(new RegExp(`^## ${title}[ \\t]*$`, "im"));
  const block = `## ${title}\n\n${body.trim()}\n`;
  if (at >= 0) {
    const after = raw.slice(at + 3).search(/^## /m);
    const end = after < 0 ? raw.length : at + 3 + after;
    return `${raw.slice(0, at)}${block}${after < 0 ? "" : "\n"}${raw.slice(end)}`;
  }
  const notes = raw.search(/^## Notes[ \t]*$/m);
  return notes >= 0
    ? `${raw.slice(0, notes)}${block}\n${raw.slice(notes)}`
    : `${raw.trimEnd()}\n\n${block}`;
}

/** Keeps the newest notes, and always what they have always known. */
export function withNoteCap(raw: string, cap: number): string {
  const heading = raw.match(/^## Notes[ \t]*\r?\n+/m);
  if (heading?.index === undefined) return raw;
  const start = heading.index + heading[0].length;
  const next = raw.slice(start).search(/^## /m);
  const end = next < 0 ? raw.length : start + next;
  const lines = raw.slice(start, end).split(/\r?\n/).filter(Boolean);
  if (lines.length <= cap) return raw;
  const newest = [...lines].sort((a, b) =>
    b.slice(2, 12).localeCompare(a.slice(2, 12)),
  );
  const kept = newest.filter(
    (line, at) => at < cap || line.includes(" · always known · "),
  );
  return `${raw.slice(0, start)}${kept.join("\n")}\n${next < 0 ? "" : "\n"}${raw.slice(end)}`;
}

/** Drops `## Plans recorded for <date>` sections for days already past. */
export function withoutPlansBefore(raw: string, date: string): string {
  return raw.replace(
    /^## Plans recorded for (\d{4}-\d{2}-\d{2})[^\n]*\n[\s\S]*?(?=^## |(?![\s\S]))/gm,
    (section: string, day: string) => (day < date ? "" : section),
  );
}
