import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import type { ActiveTask } from "../taskman/types.ts";
import type { TaskExtension } from "../taskman/types.ts";
import type { MemoryIndex } from "./index.ts";
import { readLenientJson } from "./lenient-json.ts";
import type { Page } from "./page.ts";
import { mentionsIn } from "./retrieve.ts";
import {
  applyOperation,
  newPage,
  withField,
  withLead,
  withNote,
  withNoteCap,
  withPlan,
  withSection,
  withoutPlansBefore,
} from "./writes.ts";

/**
 * Words meant as one string. The model sometimes wraps them, as a dream given
 * as `{ "scene": …, "feeling": … }` or a list of sentences (5 of 81 nights on
 * 2026-11-12); the words are still good, so they are joined.
 */
function prose(value: unknown): unknown {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  const parts = Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? Object.values(value)
      : undefined;
  if (!parts) return value;
  const text = parts
    .map(prose)
    .filter((part): part is string => typeof part === "string" && !!part)
    .join(" ");
  return text || value;
}
const PROSE = z.preprocess(prose, z.string());
const WORDS = z.preprocess(prose, z.string().min(1));
const CERTAINTY = z.preprocess(
  (value) => (typeof value === "string" ? value.trim().toLowerCase() : value),
  z.enum(["sure", "think so", "suspect", "doubt it"]),
);
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** What the sleeping mind returns: operations, never whole files. */
const SLEEP_PAGE = z.object({
  id: z.string(),
  kind: z.enum(["person", "place", "concept"]).optional(),
  name: z.string().optional(),
  summary: PROSE.optional(),
  view: PROSE.optional(),
  relation: PROSE.optional(),
  openThreads: z.array(z.string()).optional(),
  theyThinkOfMe: z.object({ guess: WORDS, certainty: CERTAINTY }).optional(),
  notes: z
    .array(
      z.object({
        source: z.string().trim(),
        certainty: CERTAINTY,
        text: WORDS,
      }),
    )
    .default([]),
  links: z.array(z.string()).default([]),
});
const SLEEP_DAY = z.object({
  summary: PROSE.default(""),
  gist: WORDS,
  touched: z.array(z.string()).default([]),
});
const PLAN = z.object({ on: z.string().regex(DAY), text: WORDS });
const SLEEP_SELF = z.object({
  lately: PROSE.optional(),
  goals: z.array(WORDS).optional(),
  plans: z.array(PLAN).optional(),
});

export const SLEEP_OUTPUT = z.object({
  day: SLEEP_DAY,
  pages: z.array(SLEEP_PAGE).default([]),
  self: SLEEP_SELF.optional(),
  dream: PROSE.optional(),
});
export type SleepOutput = z.infer<typeof SLEEP_OUTPUT>;

const SLUG = /^[\p{L}\p{N}][\p{L}\p{N}_-]*$/u;
const SOURCE = /^(seen it|read it|my guess|(told by|overheard) (.+))$/;

const bareId = (id: string): string => id.replace(/^user:/, "");

/** Drops what the record does not support; the rest of the night still counts. */
export function validateSleep(
  output: SleepOutput,
  evidence: {
    /** Everyone who spoke in the records. */
    readonly speakers: ReadonlySet<string>;
    /** Everyone and everything the records or their own pages name. */
    readonly present: ReadonlySet<string>;
    readonly known: ReadonlySet<string>;
    readonly resolve: (reference: string) => string | undefined;
  },
): { readonly output: SleepOutput; readonly dropped: readonly string[] } {
  const dropped: string[] = [];
  const speakers = new Set([...evidence.speakers].map(bareId));
  const pages = output.pages.flatMap((raw) => {
    // The player's address is not their page id.
    const page = { ...raw, id: bareId(raw.id) };
    if (!SLUG.test(page.id)) {
      dropped.push(`page id "${page.id}"`);
      return [];
    }
    const notes = page.notes.flatMap((note) => {
      const source = note.source.match(SOURCE);
      if (!source) {
        dropped.push(`${page.id}: source "${note.source}"`);
        return [];
      }
      const person = source[3];
      if (!person) return [note];
      const teller = bareId(evidence.resolve(person) ?? person);
      if (!speakers.has(teller)) {
        dropped.push(`${page.id}: ${person} said nothing in the records`);
        return [];
      }
      return [{ ...note, source: `${source[2]} ${teller}` }];
    });
    const isNew = !evidence.known.has(page.id);
    if (isNew && !notes.length) {
      dropped.push(`new page ${page.id} has no grounded note`);
      return [];
    }
    const { theyThinkOfMe, ...rest } = page;
    let guess = theyThinkOfMe;
    if (guess && !evidence.present.has(bareId(page.id))) {
      dropped.push(`${page.id}: guess about someone not in the records`);
      guess = undefined;
    }
    return [{ ...rest, notes, ...(guess ? { theyThinkOfMe: guess } : {}) }];
  });
  return { output: { ...output, pages }, dropped };
}

export interface ParsedSleep {
  readonly output: SleepOutput;
  /** The reply was not strict JSON and was read leniently. */
  readonly repaired: boolean;
  /** What was malformed and left out. */
  readonly dropped: readonly string[];
}

const RECORD = z.record(z.string(), z.unknown());
function salvage<T>(schema: z.ZodType<T>, value: unknown): T | undefined {
  const read = schema.safeParse(value);
  return read.success ? read.data : undefined;
}
const fieldsOf = (error: z.ZodError): string =>
  [...new Set(error.issues.map(({ path }) => String(path[0] ?? "?")))].join(
    ", ",
  );

/**
 * Reads what the model returned. Each part stands alone: one bad page, a bad
 * part of one, a bad dream or plan costs that much and not the night. Only a
 * reply with no usable day fails, because the day page is the night's record.
 */
export function parseSleepOutput(text: string): ParsedSleep {
  const { value, repaired } = readLenientJson(text);
  const raw = RECORD.safeParse(value);
  if (!raw.success) throw new Error("The sleep output is not a JSON object.");
  const dropped: string[] = [];
  const day = SLEEP_DAY.safeParse(raw.data.day);
  if (!day.success)
    throw new Error(
      `No usable day in the sleep output (${raw.data.day === undefined ? "missing" : fieldsOf(day.error)}).`,
    );

  const pages: Array<z.infer<typeof SLEEP_PAGE>> = [];
  for (const page of Array.isArray(raw.data.pages) ? raw.data.pages : []) {
    const whole = SLEEP_PAGE.safeParse(page);
    if (whole.success) {
      pages.push(whole.data);
      continue;
    }
    const fields = RECORD.safeParse(page);
    const { theyThinkOfMe, notes, ...rest } = fields.success ? fields.data : {};
    const note = SLEEP_PAGE.shape.notes.unwrap().element;
    const guess = SLEEP_PAGE.shape.theyThinkOfMe.safeParse(theyThinkOfMe);
    const salvaged = SLEEP_PAGE.safeParse({
      ...rest,
      notes: Array.isArray(notes)
        ? notes.filter((item) => note.safeParse(item).success)
        : [],
      ...(guess.success ? { theyThinkOfMe: guess.data } : {}),
    });
    dropped.push(
      `malformed parts of ${typeof rest.id === "string" ? rest.id : "a page"} (${fieldsOf(whole.error)})`,
    );
    if (salvaged.success) pages.push(salvaged.data);
  }

  let self: z.infer<typeof SLEEP_SELF> | undefined;
  if (raw.data.self !== undefined) {
    const whole = SLEEP_SELF.safeParse(raw.data.self);
    if (whole.success) self = whole.data;
    else {
      const parts = RECORD.safeParse(raw.data.self);
      const { lately, goals, plans } = parts.success ? parts.data : {};
      const keptLately = salvage(PROSE, lately);
      const keptGoals = salvage(z.array(WORDS), goals);
      const keptPlans = Array.isArray(plans)
        ? plans.flatMap((plan) => salvage(PLAN, plan) ?? [])
        : [];
      self = {
        ...(keptLately ? { lately: keptLately } : {}),
        ...(keptGoals ? { goals: keptGoals } : {}),
        ...(keptPlans.length ? { plans: keptPlans } : {}),
      };
      dropped.push(`malformed parts of self (${fieldsOf(whole.error)})`);
    }
  }

  let dream: string | undefined;
  if (raw.data.dream !== undefined) {
    const read = PROSE.safeParse(raw.data.dream);
    if (read.success) dream = read.data || undefined;
    else dropped.push("a dream that was not words");
  }

  return {
    output: {
      day: day.data,
      pages,
      ...(self ? { self } : {}),
      ...(dream ? { dream } : {}),
    },
    repaired,
    dropped,
  };
}

export interface SleepInput {
  readonly name: string;
  readonly soul: string;
  readonly feelings?: string;
  readonly records: string;
  readonly memory: string;
  /** Whole files of what the day touched. */
  readonly pages: ReadonlyArray<{ readonly id: string; readonly raw: string }>;
  /** One line each for the rest of what they know. */
  readonly others: readonly string[];
  /** Pages over the note cap, with what is about to fade. */
  readonly fading: ReadonlyArray<{
    readonly id: string;
    readonly notes: readonly string[];
  }>;
}

/** One message; the skill says what to do with it. */
export function sleepMessage(input: SleepInput): string {
  return [
    `You are ${input.name}.`,
    `# Who you are\n${input.soul}`,
    ...(input.feelings
      ? [`# How you felt going to bed\n${input.feelings}`]
      : []),
    `# What happened since you last slept\n${input.records}`,
    `# What you carry (MEMORY.md)\n${input.memory}`,
    `# What you remember of what the day touched\n${input.pages.map(({ id, raw }) => `## ${id}\n${raw}`).join("\n\n") || "(nothing yet)"}`,
    ...(input.others.length
      ? [`# Everything else you remember, by id\n${input.others.join("\n")}`]
      : []),
    ...(input.fading.length
      ? [
          `# Fading\n${input.fading
            .map(({ id, notes }) => `## ${id}\n${notes.join("\n")}`)
            .join("\n\n")}`,
        ]
      : []),
  ].join("\n\n");
}

const DIRECTORY: Readonly<Record<Page["kind"], string>> = {
  person: path.join("entities", "characters"),
  place: path.join("entities", "places"),
  concept: "concepts",
  day: "days",
};

export interface SleepApplied {
  /** Every file touched, as it was: null when it did not exist. */
  readonly preimages: Readonly<Record<string, string | null>>;
  /** And as this night left it, for showing what changed. */
  readonly postimages: Readonly<Record<string, string>>;
  readonly pages: readonly string[];
  readonly newPages: readonly string[];
  readonly notes: number;
}

/** Writes one night to disk, keeping what each file was before. */
export function applySleep(params: {
  readonly workspace: string;
  readonly output: SleepOutput;
  readonly personal: ReadonlyMap<string, Page>;
  readonly world: {
    readonly kindOf: (id: string) => Page["kind"] | undefined;
    readonly nameOf: (id: string) => string | undefined;
  };
  /** The day lived, and the day they wake to. */
  readonly day: string;
  readonly wakeDay: string;
  readonly notesPerPage: number;
}): SleepApplied {
  const { workspace, output, personal, world, day, wakeDay } = params;
  const preimages: Record<string, string | null> = {};
  const change = (
    file: string,
    operation: (current: string | undefined) => string,
  ): void => {
    const relative = path.relative(workspace, file);
    if (!(relative in preimages))
      preimages[relative] = existsSync(file)
        ? readFileSync(file, "utf8")
        : null;
    applyOperation(file, operation);
  };
  const newPages: string[] = [];
  let notes = 0;

  for (const page of output.pages) {
    const existing = personal.get(page.id);
    const kind =
      existing?.kind ?? world.kindOf(page.id) ?? page.kind ?? "concept";
    const file = path.join(workspace, "wiki", DIRECTORY[kind], `${page.id}.md`);
    if (!existing) newPages.push(page.id);
    notes += page.notes.length;
    change(file, (raw) => {
      let next =
        raw ??
        newPage(
          page.name ?? world.nameOf(page.id) ?? page.id,
          page.notes[0]?.source ?? "my guess",
        );
      if (page.summary)
        next = withField(next, "summary", JSON.stringify(page.summary));
      if (page.relation)
        next = withField(next, "relation", JSON.stringify(page.relation));
      if (page.view) next = withLead(next, page.view);
      if (page.theyThinkOfMe)
        next = withSection(
          next,
          "What they think of me",
          `${page.theyThinkOfMe.guess} (${page.theyThinkOfMe.certainty})`,
        );
      if (page.openThreads)
        next = withSection(
          next,
          "Open threads",
          page.openThreads.map((thread) => `- ${thread}`).join("\n"),
        );
      if (page.links.length)
        next = withSection(
          next,
          "See also",
          page.links.map((link) => `[[${link}]]`).join(" "),
        );
      for (const note of [...page.notes].reverse())
        next = withNote(next, { ...note, date: day });
      // Old notes only go once their gist has been folded into the view.
      return page.view ? withNoteCap(next, params.notesPerPage) : next;
    });
  }

  change(path.join(workspace, "wiki", "days", `${day}.md`), (raw) => {
    if (raw) return `${raw.trimEnd()}\n\n${output.day.gist}\n`;
    const front = [
      `summary: ${JSON.stringify(output.day.summary)}`,
      `touched: ${JSON.stringify(output.day.touched)}`,
    ].join("\n");
    const dream = output.dream ? `\n## Dream\n\n${output.dream}\n` : "";
    return `---\n${front}\n---\n\n# ${day}\n\n${output.day.gist}\n${dream}`;
  });

  change(path.join(workspace, "MEMORY.md"), (raw) => {
    let next = withoutPlansBefore(raw ?? "", wakeDay);
    if (output.self?.lately)
      next = withSection(next, "Lately", output.self.lately);
    if (output.self?.goals)
      next = withSection(
        next,
        "Long-Term Goals",
        output.self.goals.map((goal) => `- ${goal}`).join("\n"),
      );
    for (const plan of output.self?.plans ?? [])
      next = withPlan(next, plan.on, plan.text);
    return next;
  });

  const postimages: Record<string, string> = {};
  for (const relative of Object.keys(preimages))
    postimages[relative] = readFileSync(path.join(workspace, relative), "utf8");
  return {
    preimages,
    postimages,
    pages: output.pages.map(({ id }) => id),
    newPages,
    notes,
  };
}

/** Puts every file of one night back exactly as it was. */
export function restoreSleep(
  workspace: string,
  preimages: Readonly<Record<string, string | null>>,
): void {
  for (const [relative, content] of Object.entries(preimages)) {
    const file = path.join(workspace, relative);
    if (content === null) rmSync(file, { force: true });
    else applyOperation(file, () => content);
  }
}

export interface SleepRun {
  readonly id: string;
  readonly at: number;
  readonly preimages: Readonly<Record<string, string | null>>;
  readonly postimages: Readonly<Record<string, string>>;
}
/**
 * How one pass ended, kept so a night can be measured afterwards
 * (`scripts/sleep-report.mjs`); before these, a pass that worked left no trace
 * in the log and one that failed left a single warning.
 */
export interface SleepOutcome {
  /** Sim time the pass began. */
  readonly at: number;
  /** Real time it ended. */
  readonly wallAt: number;
  /** `empty`: nothing had happened since the last sleep, so no model call. */
  readonly result: "applied" | "failed" | "interrupted" | "empty";
  /** Model calls made. */
  readonly attempts: number;
  /** Why each failed call failed, in order. */
  readonly errors: readonly string[];
  /** Applied from a reply that was not strict JSON. */
  readonly repaired?: boolean;
  /** Parts left out as malformed or unsupported by the records. */
  readonly dropped?: readonly string[];
  readonly runId?: string;
  readonly pages?: number;
  readonly newPages?: number;
  readonly notes?: number;
  /** Pages whose view was rewritten. */
  readonly views?: number;
  /** `MEMORY.md`'s lately, goals or plans were given. */
  readonly self?: boolean;
  readonly dream?: boolean;
}
export interface SleepState {
  /**
   * Sim time up to which the records have been slept on; absent until a night
   * first applies.
   */
  readonly watermark?: number;
  readonly runs: readonly SleepRun[];
  /** Newest first. */
  readonly outcomes?: readonly SleepOutcome[];
}

const RUNS_KEPT = 7;
const OUTCOMES_KEPT = 30;
const HOLD_MS = 120_000;
/**
 * Model calls per night. A failed call wrote nothing, so another is safe; the
 * wait between them grows, and a wake ends it like any other part of the pass.
 */
export const SLEEP_ATTEMPTS = 3;
const RETRY_PAUSE_MS = 10_000;

/** One line, short enough for a log and the store. */
const describe = (error: unknown): string =>
  (error instanceof Error ? `${error.name}: ${error.message}` : String(error))
    .replace(/\s+/g, " ")
    .slice(0, 300);

interface Trace {
  /** Sim time the pass began. */
  readonly at: number;
  attempts: number;
  readonly errors: string[];
}

export interface SleepDeps {
  readonly index: MemoryIndex;
  readonly enabled: boolean;
  readonly categories: readonly string[];
  readonly minMinutes: number;
  readonly notesPerPage: number;
  readonly now: () => number;
  readonly workspaceOf: (agentId: string) => string;
  readonly store: {
    readonly lookup: (key: string) => Promise<SleepState | undefined>;
    readonly register: (key: string, value: SleepState) => Promise<void>;
  };
  /** One tool-free model call, in the character's own model. */
  readonly complete: (params: {
    readonly agentId: string;
    readonly message: string;
    readonly instructions: string;
    readonly signal: AbortSignal;
  }) => Promise<string>;
  readonly instructions: (agentId: string) => Promise<string>;
  readonly experiences: (
    agentId: string,
    since: number,
    now: number,
  ) => Promise<{
    readonly text: string;
    readonly speakers: readonly string[];
    readonly through: number;
  }>;
  readonly feelings?: (agentId: string, at: number) => Promise<string>;
  readonly nameOf: (id: string) => string | undefined;
  /** Into their `:tasks` ledger and the journal. */
  readonly record: (
    agentId: string,
    event: SleepEvent,
    text: string,
  ) => Promise<void>;
  /** Every outcome is logged: an applied night at info, a failure as a warning. */
  readonly log: (message: string) => void;
  readonly warn: (message: string) => void;
  /** Real time, for outcomes. */
  readonly wallNow?: () => number;
  /** Waits between attempts, rejecting once `signal` aborts. */
  readonly pause?: (ms: number, signal: AbortSignal) => Promise<void>;
}

export interface SleepEvent {
  readonly runId: string;
  readonly from: number;
  readonly to: number;
  readonly pages: readonly string[];
  readonly newPages: readonly string[];
  readonly notes: number;
  readonly interrupted: boolean;
  readonly dream?: string;
}

export interface SleepPass {
  readonly controller: AbortController;
  readonly taskId?: string;
  readonly done: Promise<void>;
}

/** Offline consolidation (memory.md §7.5). One pass per character at a time. */
export function createSleep(deps: SleepDeps, passes: Map<string, SleepPass>) {
  const pause =
    deps.pause ??
    ((ms: number, signal: AbortSignal) =>
      delay(ms, undefined, { signal, ref: false }));
  const wallNow = deps.wallNow ?? Date.now;

  /** Keeps how the pass ended, with any change to the state that goes with it. */
  const settle = async (
    agentId: string,
    trace: Trace,
    result: SleepOutcome["result"],
    details: Partial<SleepOutcome> = {},
    change: (state: SleepState) => SleepState = (state) => state,
  ): Promise<void> => {
    const outcome: SleepOutcome = {
      at: trace.at,
      wallAt: wallNow(),
      result,
      attempts: trace.attempts,
      errors: [...trace.errors],
      ...details,
    };
    const state = change((await deps.store.lookup(agentId)) ?? { runs: [] });
    await deps.store.register(agentId, {
      ...state,
      outcomes: [outcome, ...(state.outcomes ?? [])].slice(0, OUTCOMES_KEPT),
    });
  };

  /**
   * The model call, tried again while they sleep when the reply cannot be read
   * or the call fails. Nothing is written before a reply is read, so another
   * try cannot apply anything twice.
   */
  const ask = async (
    agentId: string,
    message: string,
    signal: AbortSignal,
    trace: Trace,
  ): Promise<ParsedSleep | undefined> => {
    const instructions = await deps.instructions(agentId);
    while (trace.attempts < SLEEP_ATTEMPTS) {
      if (trace.attempts) await pause(RETRY_PAUSE_MS * trace.attempts, signal);
      trace.attempts++;
      const last = trace.errors.at(-1);
      try {
        const text = await deps.complete({
          agentId,
          signal,
          instructions,
          // The skill says what to do differently on a retry.
          message: last ? `${message}\n\n# Retry\n${last}` : message,
        });
        signal.throwIfAborted();
        return parseSleepOutput(text);
      } catch (error) {
        if (signal.aborted) throw error;
        trace.errors.push(describe(error));
        deps.warn(
          `Sleep ${agentId}: attempt ${trace.attempts} of ${SLEEP_ATTEMPTS} failed: ${describe(error)}`,
        );
      }
    }
    return undefined;
  };

  const run = async (
    agentId: string,
    signal: AbortSignal,
    trace: Trace,
    task?: ActiveTask,
  ): Promise<SleepEvent | undefined> => {
    const now = trace.at;
    const state = await deps.store.lookup(agentId);
    // The watermark is the last record read, which must not be read twice.
    const from = state?.watermark === undefined ? 0 : state.watermark + 1;
    const {
      text: records,
      speakers,
      through,
    } = await deps.experiences(agentId, from, now);
    if (!records.trim()) {
      await settle(agentId, trace, "empty");
      return undefined;
    }

    const workspace = deps.workspaceOf(agentId);
    const read = (name: string): string => {
      const file = path.join(workspace, name);
      return existsSync(file) ? readFileSync(file, "utf8") : "";
    };
    const world = deps.index.world();
    const personal = deps.index.personal(agentId);
    const candidates = [...personal.values(), ...world.pages.values()];
    const named = new Set([
      ...mentionsIn(records, candidates),
      ...speakers.map(bareId),
    ]);
    const onPage = [...personal.values()].filter((page) => named.has(page.id));
    const fileOf = (page: Page): string =>
      path.join("wiki", DIRECTORY[page.kind], `${page.id}.md`);
    const message = sleepMessage({
      name: deps.nameOf(agentId) ?? agentId,
      soul: read("SOUL.md").slice(0, 4_000),
      ...(deps.feelings ? { feelings: await deps.feelings(agentId, now) } : {}),
      records,
      memory: read("MEMORY.md"),
      pages: onPage.map((page) => ({
        id: page.id,
        raw: read(fileOf(page)),
      })),
      others: [...personal.values()]
        .filter((page) => !named.has(page.id) && page.kind !== "day")
        .map((page) => `${page.id}: ${page.summary}`),
      fading: onPage
        .filter((page) => page.notes.length > deps.notesPerPage)
        .map((page) => ({
          id: page.id,
          // Lifelong knowledge never fades; everything else may.
          notes: [...page.notes]
            .sort((a, b) => b.date.localeCompare(a.date))
            .filter(
              (note, at) =>
                at >= deps.notesPerPage && note.source !== "always known",
            )
            .map((note) => `${note.date}: ${note.text}`),
        })),
    });
    const parsed = await ask(agentId, message, signal, trace);
    if (!parsed) {
      // The watermark stands, so the next sleep takes this day in again.
      await settle(agentId, trace, "failed");
      deps.warn(
        `Sleep ${agentId}: failed after ${trace.attempts} attempts; the day waits for the next sleep`,
      );
      return undefined;
    }

    const { output: valid, dropped: unsupported } = validateSleep(
      parsed.output,
      {
        speakers: new Set(speakers),
        present: named,
        known: new Set(personal.keys()),
        resolve: (reference) => world.resolve(reference),
      },
    );
    const dropped = [...parsed.dropped, ...unsupported];
    if (dropped.length)
      deps.warn(`Sleep ${agentId}: dropped ${dropped.join("; ")}`);
    const iso = (at: number): string => new Date(at).toISOString().slice(0, 10);
    const applied = applySleep({
      workspace,
      output: valid,
      personal,
      world: {
        kindOf: (id) => world.pages.get(id)?.kind,
        nameOf: (id) => world.pages.get(id)?.name,
      },
      day: iso(task ? Date.parse(task.startedAt) : now),
      wakeDay: iso(task ? Date.parse(task.endAt) : now),
      notesPerPage: deps.notesPerPage,
    });
    const id = randomUUID();
    const views = valid.pages.filter((page) => page.view).length;
    const self = Boolean(
      valid.self?.lately || valid.self?.goals || valid.self?.plans?.length,
    );
    await settle(
      agentId,
      trace,
      "applied",
      {
        repaired: parsed.repaired,
        dropped,
        runId: id,
        pages: applied.pages.length,
        newPages: applied.newPages.length,
        notes: applied.notes,
        views,
        self,
        dream: Boolean(valid.dream),
      },
      (current) => ({
        ...current,
        watermark: through,
        runs: [
          {
            id,
            at: now,
            preimages: applied.preimages,
            postimages: applied.postimages,
          },
          ...current.runs,
        ].slice(0, RUNS_KEPT),
      }),
    );
    deps.log(
      `Sleep ${agentId}: applied on attempt ${trace.attempts}${parsed.repaired ? " (read leniently)" : ""}: day page, ${applied.pages.length} pages (${applied.newPages.length} new), ${applied.notes} notes, ${views} views${self ? ", MEMORY.md" : ""}${valid.dream ? ", a dream" : ""}`,
    );
    return {
      runId: id,
      from,
      to: through,
      pages: applied.pages,
      newPages: applied.newPages,
      notes: applied.notes,
      interrupted: false,
      ...(valid.dream ? { dream: valid.dream } : {}),
    };
  };

  const start = (agentId: string, task?: ActiveTask): Promise<void> => {
    const controller = new AbortController();
    const trace: Trace = { at: deps.now(), attempts: 0, errors: [] };
    const done = run(agentId, controller.signal, trace, task)
      .then(
        async (event) => {
          if (!event) return;
          await deps
            .record(
              agentId,
              event,
              event.dream ? `You dreamt: ${event.dream}` : "You slept on it.",
            )
            .catch((error: unknown) => {
              deps.warn(`Sleep ${agentId}: not recorded: ${describe(error)}`);
            });
        },
        async (error: unknown) => {
          if (controller.signal.aborted) {
            // Nothing was applied, and the watermark stands: next sleep redoes it.
            await settle(agentId, trace, "interrupted");
            await deps.record(
              agentId,
              {
                runId: "",
                from: trace.at,
                to: deps.now(),
                pages: [],
                newPages: [],
                notes: 0,
                interrupted: true,
              },
              "Your sleep was broken.",
            );
            return;
          }
          // Reading records, or writing the night, failed: not the model.
          trace.errors.push(describe(error));
          deps.warn(`Sleep ${agentId}: ${describe(error)}`);
          await settle(agentId, trace, "failed");
        },
      )
      .catch((error: unknown) => {
        deps.warn(`Sleep ${agentId}: ${describe(error)}`);
      })
      .finally(() => {
        passes.delete(agentId);
      });
    passes.set(agentId, {
      controller,
      ...(task ? { taskId: task.id } : {}),
      done,
    });
    return done;
  };

  const taskExtension: TaskExtension = {
    startTaskParameters: {},
    delayTaskParameters: {},
    required: [],
    prepare: async (transition) => ({
      commit: async (task) => {
        if (!deps.enabled) return;
        const running = passes.get(transition.agentId);
        if (running && running.taskId !== task.id) running.controller.abort();
        if (
          transition.kind === "started" &&
          deps.categories.includes(task.type) &&
          task.duration >= deps.minMinutes &&
          !passes.has(transition.agentId)
        ) {
          void start(transition.agentId, task);
        }
      },
    }),
  };

  return {
    taskExtension,
    /** Sleep is broken: nothing from this pass is applied. */
    wake: (agentId: string): void => {
      passes.get(agentId)?.controller.abort();
    },
    /** Waits, bounded, for the pass so the wake turn sees the morning's memory. */
    settled: async (agentId: string, boundMs = HOLD_MS): Promise<void> => {
      const running = passes.get(agentId);
      if (!running) return;
      await Promise.race([
        running.done,
        new Promise((resolve) => setTimeout(resolve, boundMs)),
      ]);
    },
    /** Now, on request. */
    consolidate: (agentId: string): Promise<void> => start(agentId),
    restore: async (agentId: string, runId: string): Promise<boolean> => {
      const state = await deps.store.lookup(agentId);
      const found = state?.runs.find(({ id }) => id === runId);
      if (!state || !found) return false;
      restoreSleep(deps.workspaceOf(agentId), found.preimages);
      await deps.store.register(agentId, {
        ...state,
        runs: state.runs.filter(({ id }) => id !== runId),
      });
      return true;
    },
    runs: async (agentId: string): Promise<readonly SleepRun[]> =>
      (await deps.store.lookup(agentId))?.runs ?? [],
  };
}
