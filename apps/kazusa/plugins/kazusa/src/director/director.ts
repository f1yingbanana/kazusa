import { z } from "zod";
import YAML from "yaml";

/** How many characters the director watches at once, at most. */
export const MAX_WATCHED = 4;
/** How long a watch's `for` may be, as the decision model reads it. */
const MAX_FOR = 400;

/** A character the director is watching, and what for. */
export interface Watch {
  readonly who: string;
  readonly for?: string;
}

const NOTEBOOK = z.object({
  watching: z.array(z.unknown()).optional(),
  promised: z.array(z.unknown()).optional(),
});
/** How many promised beats are checked at once, at most. */
export const MAX_PROMISED = 4;
/** How long a promised beat may be, as the decision model reads it. */
const MAX_BEAT = 300;
/**
 * The director's settings in its notebook: the `---` block that holds
 * `watching:` or `promised:`. Front matter by rule, but a model editing the
 * file may leave it anywhere, so the first such block counts wherever it is.
 */
function settingsBlock(notebook: string): string | undefined {
  for (const block of notebook.matchAll(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*$/gm))
    if (/^(?:watching|promised):/m.test(block[1] ?? "")) return block[1];
  return undefined;
}

function settingsOf(notebook: string): z.infer<typeof NOTEBOOK> {
  const block = settingsBlock(notebook);
  if (!block) return {};
  try {
    return NOTEBOOK.catch({}).parse(YAML.parse(block) ?? {});
  } catch {
    return {};
  }
}

const ENTRY = z.union([
  z.string().transform((who) => ({ who, for: undefined })),
  z.object({
    who: z.coerce.string(),
    for: z.coerce.string().optional(),
  }),
]);

/**
 * The characters the director's notebook (its `MEMORY.md`) watches: front
 * matter `watching:`, each `{ who, for }` or just an id, the first
 * `MAX_WATCHED` only. Anything else in the file is the director's own.
 */
export function watchingIn(notebook: string): Watch[] {
  const data = settingsOf(notebook);
  const watches: Watch[] = [];
  // A model writes this YAML by hand, and an unquoted "Watch: ..." in a `for:`
  // breaks it all; read the same shape line by line then.
  const entries = data.watching ?? looseWatching(notebook);
  for (const entry of entries) {
    const parsed = ENTRY.safeParse(entry);
    if (!parsed.success) continue;
    const who = parsed.data.who.trim();
    if (!who || watches.some((watch) => watch.who === who)) continue;
    const why = (parsed.data.for ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_FOR);
    watches.push({ who, ...(why ? { for: why } : {}) });
    if (watches.length >= MAX_WATCHED) break;
  }
  return watches;
}

/**
 * `watching:` read line by line, for front matter YAML won't parse: `- who:
 * <id>` (or `- <id>`) starts an entry, `for:` takes the rest of its line and
 * any deeper-indented lines after it.
 */
function looseWatching(notebook: string): unknown[] {
  const front = settingsBlock(notebook);
  if (!front) return [];
  const lines = front.split(/\r?\n/);
  const start = lines.findIndex((line) => /^watching:\s*$/.test(line));
  if (start < 0) return [];
  const entries: { who: string; for?: string }[] = [];
  let reading: "for" | undefined;
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break;
    const item = line.match(/^\s*-\s+(?:who:\s*)?(.+?)\s*$/);
    const why = line.match(/^\s+for:\s*(.*)$/);
    const who = line.match(/^\s+who:\s*(.+?)\s*$/);
    const last = entries.at(-1);
    if (item) {
      entries.push({ who: item[1].replace(/^["']|["']$/g, "") });
      reading = undefined;
    } else if (who && last) last.who = who[1]!;
    else if (why && last) {
      last.for = why[1].replace(/^["']|["']$/g, "");
      reading = "for";
    } else if (reading && last && line.trim())
      last.for = `${last.for ?? ""} ${line.trim()}`;
  }
  return entries;
}

/**
 * The beats the director promised the user (front matter `promised:`, each a
 * line one could see happen), the first `MAX_PROMISED` only. Code checks them
 * against the page, so the director doesn't grade its own plan.
 */
export function promisedIn(notebook: string): string[] {
  const data = settingsOf(notebook);
  // "They argue: raised voices" is a mapping to YAML: read such lists as lines.
  const entries = data.promised?.every((entry) => typeof entry === "string")
    ? data.promised
    : looseList(notebook, "promised");
  const beats: string[] = [];
  for (const entry of entries) {
    const beat = (typeof entry === "string" ? entry : "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_BEAT);
    if (beat && !beats.includes(beat)) beats.push(beat);
    if (beats.length >= MAX_PROMISED) break;
  }
  return beats;
}

/** A front matter list of strings, read line by line (`- text`). */
function looseList(notebook: string, key: string): string[] {
  const front = settingsBlock(notebook);
  if (!front) return [];
  const lines = front.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `${key}:`);
  if (start < 0) return [];
  const items: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break;
    const item = line.match(/^\s*-\s+(.+?)\s*$/);
    if (item) items.push(item[1].replace(/^["']|["']$/g, ""));
    else if (items.length && line.trim())
      items[items.length - 1] += ` ${line.trim()}`;
  }
  return items;
}
