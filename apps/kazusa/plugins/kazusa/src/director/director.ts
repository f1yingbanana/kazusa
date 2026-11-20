import { z } from "zod";
import type { JournalEvent } from "@kazusa/client";
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
});
/**
 * The director's settings in its notebook: the `---` block that holds
 * `watching:`. Front matter by rule, but a model editing the file may leave it
 * anywhere, so the first such block counts wherever it is.
 */
function settingsBlock(notebook: string): string | undefined {
  for (const block of notebook.matchAll(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*$/gm))
    if (/^watching:/m.test(block[1] ?? "")) return block[1];
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

/** Something that happened in the world, as the director's digest lists it. */
export interface Happening {
  readonly at: number;
  readonly who: string;
  /** `started` an activity, or `delayed` it. */
  readonly kind: "started" | "delayed";
  readonly text: string;
  readonly where?: string;
}

/** What a journal event says happened, for the digest, if anything. */
export function happeningOf(event: JournalEvent): Happening | undefined {
  const who = event.actors[0];
  if (!who) return undefined;
  if (event.kind === "task.started")
    return {
      at: event.simTime,
      who,
      kind: "started",
      text: event.payload.description,
      ...(event.payload.where ? { where: event.payload.where } : {}),
    };
  if (event.kind === "task.delayed" && event.payload.reason)
    return {
      at: event.simTime,
      who,
      kind: "delayed",
      text: event.payload.reason,
    };
  return undefined;
}

/** How much the digest keeps, at most: a day of a busy world. */
const KEPT = 4_000;

/**
 * The world's happenings since the process started, newest last, shared by
 * every copy of the plugin in the process (each copy may broadcast).
 */
const SHARED = Symbol.for("kazusa.director.happenings");
export function sharedHappenings(): Happening[] {
  const scope = globalThis as { [SHARED]?: Happening[] };
  return (scope[SHARED] ??= []);
}

export function recordHappening(
  happenings: Happening[],
  happening: Happening,
): void {
  happenings.push(happening);
  if (happenings.length > KEPT) happenings.splice(0, happenings.length - KEPT);
}

/**
 * The happenings in `(since, until]` the digest shows: every one of the
 * watched, then the newest of the rest up to `limit` in all, oldest first; and
 * how many of the rest were left out.
 */
export function digestOf(
  happenings: readonly Happening[],
  options: {
    readonly since: number;
    readonly until: number;
    readonly watched: ReadonlySet<string>;
    readonly skip: ReadonlySet<string>;
    readonly limit: number;
  },
): { readonly shown: Happening[]; readonly more: number } {
  const window = happenings.filter(
    (happening) =>
      happening.at > options.since &&
      happening.at <= options.until &&
      !options.skip.has(happening.who),
  );
  const watched = window.filter((happening) =>
    options.watched.has(happening.who),
  );
  const rest = window.filter(
    (happening) => !options.watched.has(happening.who),
  );
  const room = Math.max(0, options.limit - watched.length);
  const kept = rest.slice(Math.max(0, rest.length - room));
  const shown = [...watched, ...kept].sort((a, b) => a.at - b.at);
  return { shown, more: rest.length - kept.length };
}
