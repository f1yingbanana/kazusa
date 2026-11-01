import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { ActiveTask } from "../taskman/types.ts";
import type { TaskExtension } from "../taskman/types.ts";
import type { MemoryIndex } from "./index.ts";
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

const CERTAINTY = z.enum(["sure", "think so", "suspect", "doubt it"]);
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** What the sleeping mind returns: operations, never whole files. */
const SLEEP_PAGE = z.object({
  id: z.string(),
  kind: z.enum(["person", "place", "concept"]).optional(),
  name: z.string().optional(),
  summary: z.string().optional(),
  view: z.string().optional(),
  relation: z.string().optional(),
  openThreads: z.array(z.string()).optional(),
  theyThinkOfMe: z
    .object({ guess: z.string().min(1), certainty: CERTAINTY })
    .optional(),
  notes: z
    .array(
      z.object({
        source: z.string(),
        certainty: CERTAINTY,
        text: z.string().min(1),
      }),
    )
    .default([]),
  links: z.array(z.string()).default([]),
});

export const SLEEP_OUTPUT = z.object({
  day: z.object({
    summary: z.string().default(""),
    gist: z.string().min(1),
    touched: z.array(z.string()).default([]),
  }),
  pages: z.array(SLEEP_PAGE).default([]),
  self: z
    .object({
      lately: z.string().optional(),
      goals: z.array(z.string()).optional(),
      plans: z
        .array(z.object({ on: z.string().regex(DAY), text: z.string().min(1) }))
        .optional(),
    })
    .optional(),
  dream: z.string().optional(),
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

/**
 * Reads what the model returned, tolerating a fence around the JSON. One bad
 * page, or a bad part of one, costs that much and not the whole night.
 */
export function parseSleepOutput(
  text: string,
  onDropped: (what: string) => void = () => {},
): SleepOutput {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("No JSON in the sleep output.");
  const raw = z
    .looseObject({ pages: z.array(z.unknown()).default([]) })
    .parse(JSON.parse(text.slice(start, end + 1)));
  const pages: unknown[] = [];
  for (const page of raw.pages) {
    const whole = SLEEP_PAGE.safeParse(page);
    if (whole.success) {
      pages.push(whole.data);
      continue;
    }
    const fields = z.record(z.string(), z.unknown()).safeParse(page);
    const { theyThinkOfMe, notes, ...rest } = fields.success ? fields.data : {};
    const note = SLEEP_PAGE.shape.notes.unwrap().element;
    const guess = SLEEP_PAGE.shape.theyThinkOfMe.safeParse(theyThinkOfMe);
    const repaired = SLEEP_PAGE.safeParse({
      ...rest,
      notes: Array.isArray(notes)
        ? notes.filter((item) => note.safeParse(item).success)
        : [],
      ...(guess.success ? { theyThinkOfMe: guess.data } : {}),
    });
    onDropped(
      `malformed parts of ${typeof rest.id === "string" ? rest.id : "a page"}`,
    );
    if (repaired.success) pages.push(repaired.data);
  }
  return SLEEP_OUTPUT.parse({ ...raw, pages });
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
          `# Fading: fold these into your view of each, or they are gone\n${input.fading
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
export interface SleepState {
  /** Sim time up to which the records have been slept on. */
  readonly watermark: number;
  readonly runs: readonly SleepRun[];
}

const RUNS_KEPT = 7;
const HOLD_MS = 120_000;

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
  readonly warn: (message: string) => void;
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
  const run = async (
    agentId: string,
    signal: AbortSignal,
    task?: ActiveTask,
  ): Promise<SleepEvent | undefined> => {
    const now = deps.now();
    const state = await deps.store.lookup(agentId);
    // The watermark is the last record read, which must not be read twice.
    const from = state ? state.watermark + 1 : 0;
    const {
      text: records,
      speakers,
      through,
    } = await deps.experiences(agentId, from, now);
    if (!records.trim()) return undefined;

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
    const malformed: string[] = [];
    const output = parseSleepOutput(
      await deps.complete({
        agentId,
        signal,
        instructions: await deps.instructions(agentId),
        message: sleepMessage({
          name: deps.nameOf(agentId) ?? agentId,
          soul: read("SOUL.md").slice(0, 4_000),
          ...(deps.feelings
            ? { feelings: await deps.feelings(agentId, now) }
            : {}),
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
        }),
      }),
      (what) => malformed.push(what),
    );
    signal.throwIfAborted();

    const { output: valid, dropped } = validateSleep(output, {
      speakers: new Set(speakers),
      present: named,
      known: new Set(personal.keys()),
      resolve: (reference) => world.resolve(reference),
    });
    if (dropped.length || malformed.length)
      deps.warn(
        `Sleep ${agentId}: dropped ${[...malformed, ...dropped].join("; ")}`,
      );
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
    await deps.store.register(agentId, {
      watermark: through,
      runs: [
        {
          id,
          at: now,
          preimages: applied.preimages,
          postimages: applied.postimages,
        },
        ...(state?.runs ?? []),
      ].slice(0, RUNS_KEPT),
    });
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
    const started = deps.now();
    const done = run(agentId, controller.signal, task)
      .then(async (event) => {
        if (!event) return;
        await deps.record(
          agentId,
          event,
          event.dream ? `You dreamt: ${event.dream}` : "You slept on it.",
        );
      })
      .catch(async (error: unknown) => {
        if (controller.signal.aborted) {
          // Nothing was applied, and the watermark stands: next sleep redoes it.
          await deps.record(
            agentId,
            {
              runId: "",
              from: started,
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
        deps.warn(`Sleep ${agentId}: ${String(error)}`);
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
