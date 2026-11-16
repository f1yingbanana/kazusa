import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { TaskExtension } from "../taskman/types.ts";
import type { MemoryIndex } from "./index.ts";
import type { Page } from "./page.ts";
import { PAGE_DIRECTORY } from "./source.ts";
import {
  applyOperation,
  newPage,
  withField,
  withLead,
  withNoteCap,
  withSection,
  withoutPlansBefore,
} from "./writes.ts";

/**
 * Sleep (memory.md §7.5). A character goes over the day in the turn that puts
 * them to bed: `start_task` answers a long enough sleep with what the day
 * touched, and the same run rewrites views (`reflect`), adds notes (`remember`)
 * and closes the day (`reflect` about `today`). There is no pass of its own, so
 * nothing to schedule, interrupt or resume: by the time they are asleep it is
 * done, whatever happens to the night.
 */

/** What `reflect` takes. Flat: models nest prose when a shape invites it. */
export const REFLECT = z.object({
  about: z.string().trim().min(1),
  view: z.string().trim().min(1).optional(),
  summary: z.string().trim().min(1).optional(),
  relation: z.string().trim().min(1).optional(),
  openThreads: z.array(z.string().trim().min(1)).optional(),
  theyThinkOfMe: z.string().trim().min(1).optional(),
  goals: z.array(z.string().trim().min(1)).optional(),
  dream: z.string().trim().min(1).optional(),
  states: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
});
export type Reflection = z.infer<typeof REFLECT>;

const ME = new Set(["me", "myself"]);
const TODAY = new Set(["today", "the day"]);

/** Whole pages shown at bedtime, in characters: about 6,000 tokens. */
const PAGES_CHARS = 24_000;
/** People whose states a night reviews: those of the day, latest first. */
const PEOPLE_REVIEWED = 12;
const RUNS_KEPT = 7;

/** One night's writes, kept so it can be shown and undone. */
export interface SleepRun {
  readonly id: string;
  readonly at: number;
  /** Every file touched, as it was: null when it did not exist. */
  readonly preimages: Readonly<Record<string, string | null>>;
  /** And as the night left it. */
  readonly postimages: Readonly<Record<string, string>>;
}
export interface SleepState {
  /** Newest first; the newest is when they last slept on things. */
  readonly runs: readonly SleepRun[];
}

/** A night being gone over: from going to bed until the day is closed. */
export interface Night {
  /** Its run, once kept. */
  readonly id: string;
  /**
   * The day was closed. The night stays until they next do something, so a call
   * that arrives after the closing one is still kept.
   */
  closed?: boolean;
  /** Sim time it began, and the night before it. */
  readonly at: number;
  readonly since: number;
  /** The day lived, and the day they wake to. */
  readonly day: string;
  readonly wakeDay: string;
  /** Pages they have read tonight: a view replaces only what was read. */
  readonly shown: Set<string>;
  readonly preimages: Record<string, string | null>;
  readonly pages: Set<string>;
  readonly newPages: Set<string>;
  /** Pages whose view was rewritten: their oldest notes may now go. */
  readonly rewritten: Set<string>;
  notes: number;
}

export interface SleepEvent {
  readonly runId: string;
  readonly from: number;
  readonly to: number;
  readonly pages: readonly string[];
  readonly newPages: readonly string[];
  readonly notes: number;
  readonly dream?: string;
}

/** Who or what `about` names, in a character's own wiki. */
export interface Subject {
  readonly id: string;
  readonly kind: Page["kind"];
  readonly name: string;
  /** Their page on it, if they have one. */
  readonly page?: Page;
}

export interface SleepDeps {
  readonly index: MemoryIndex;
  readonly enabled: boolean;
  readonly categories: readonly string[];
  readonly minMinutes: number;
  /** Sim minutes after a night before another is gone over. */
  readonly everyMinutes: number;
  readonly notesPerPage: number;
  readonly now: () => number;
  readonly workspaceOf: (agentId: string) => string;
  readonly store: {
    readonly lookup: (key: string) => Promise<SleepState | undefined>;
    readonly register: (key: string, value: SleepState) => Promise<void>;
  };
  /** What they did something with since `since`, latest first, by page id. */
  readonly touched: (agentId: string, since: number) => Promise<string[]>;
  readonly subject: (agentId: string, about: string) => Subject;
  /** A section of a skill, filled. */
  readonly text: (
    ref: string,
    values: Readonly<Record<string, string | number>>,
    agentId: string,
  ) => string;
  /**
   * The world's states a night reviews: what to show of them, given the people
   * of the day, and what to do with what `reflect` says of them.
   */
  readonly states?: {
    readonly text: (
      agentId: string,
      people: readonly string[],
    ) => Promise<string | undefined>;
    readonly apply: (
      agentId: string,
      people: readonly string[],
      answer: unknown,
    ) => Promise<void>;
  };
  /** Into their `:tasks` ledger and the journal. */
  readonly record: (
    agentId: string,
    event: SleepEvent,
    text: string,
  ) => Promise<void>;
  /** More calls for the run that goes over a day (`roomForSleep`). */
  readonly room?: (agentId: string) => void;
  /** Hands a character a turn of their own, for a night asked for by hand. */
  readonly deliver?: (agentId: string, text: string) => Promise<void>;
  readonly warn: (message: string) => void;
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

const iso = (at: number): string => new Date(at).toISOString().slice(0, 10);

/** One night per character at a time, shared by every registration. */
export function createSleep(deps: SleepDeps, nights: Map<string, Night>) {
  const read = (file: string): string | undefined =>
    existsSync(file) ? readFileSync(file, "utf8") : undefined;
  const fileOf = (agentId: string, kind: Page["kind"], id: string): string =>
    path.join(
      deps.workspaceOf(agentId),
      "wiki",
      PAGE_DIRECTORY[kind],
      `${id}.md`,
    );

  /**
   * Every write to a character's memory: during a night, what the file was
   * before is kept, so the night can be shown and undone.
   */
  const write = (
    agentId: string,
    file: string,
    operation: (current: string | undefined) => string,
    noted?: { readonly page: string; readonly note?: boolean },
  ): void => {
    const night = nights.get(agentId);
    if (night) {
      const relative = path.relative(deps.workspaceOf(agentId), file);
      if (!(relative in night.preimages))
        night.preimages[relative] = read(file) ?? null;
      if (noted) {
        night.pages.add(noted.page);
        if (night.preimages[relative] === null) night.newPages.add(noted.page);
        if (noted.note) night.notes += 1;
      }
    }
    applyOperation(file, operation);
    // Sent alongside the closing call and run after it: still the same night.
    if (night?.closed)
      void keep(agentId, night).catch((error: unknown) =>
        deps.warn(`Sleep ${agentId}: ${String(error)}`),
      );
  };

  const lastNight = async (agentId: string): Promise<number> =>
    (await deps.store.lookup(agentId))?.runs[0]?.at ?? 0;

  /**
   * What going to bed says: how to go over the day, their own pages on what the
   * day touched, notes about to fade, and the states a night reviews.
   */
  const offer = async (agentId: string, night: Night): Promise<string> => {
    const personal = deps.index.personal(agentId);
    const world = deps.index.world();
    const touched = await deps.touched(agentId, night.since);
    const pages: string[] = [];
    const fading: string[] = [];
    let room = PAGES_CHARS;
    for (const id of touched) {
      const page = personal.get(id);
      if (!page || page.kind === "day") continue;
      const raw = read(fileOf(agentId, page.kind, id));
      if (!raw || raw.length > room) continue;
      room -= raw.length;
      night.shown.add(id);
      pages.push(`### ${id}\n${raw.trim()}`);
      // Lifelong knowledge never fades; everything else may.
      const old = [...page.notes]
        .sort((a, b) => b.date.localeCompare(a.date))
        .filter(
          (note, at) =>
            at >= deps.notesPerPage && note.source !== "always known",
        );
      if (old.length)
        fading.push(
          `### ${id}\n${old.map((note) => `${note.date}: ${note.text}`).join("\n")}`,
        );
    }
    const people = touched
      .filter(
        (id) => (personal.get(id) ?? world.pages.get(id))?.kind === "person",
      )
      .slice(0, PEOPLE_REVIEWED)
      .map((id) => world.pages.get(id)?.personId ?? id);
    const states = await deps.states
      ?.text(agentId, people)
      .catch((error: unknown) => {
        deps.warn(`Sleep ${agentId}: states: ${String(error)}`);
        return undefined;
      });
    const section = (
      name: string,
      values: Readonly<Record<string, string>> = {},
    ): string => deps.text(`sleep-consolidation#${name}`, values, agentId);
    return [
      section("night"),
      ...(pages.length
        ? [section("pages", { pages: pages.join("\n\n") })]
        : []),
      ...(fading.length
        ? [section("fading", { notes: fading.join("\n\n") })]
        : []),
      ...(states ? [section("states", { states })] : []),
    ].join("\n\n");
  };

  const begin = (at: number, since: number, wakeAt: number): Night => ({
    id: randomUUID(),
    at,
    since,
    day: iso(at),
    wakeDay: iso(wakeAt),
    shown: new Set(),
    preimages: {},
    pages: new Set(),
    newPages: new Set(),
    rewritten: new Set(),
    notes: 0,
  });

  /** Keeps what a night wrote so far as its one run, shown and undoable. */
  const keep = async (agentId: string, night: Night): Promise<boolean> => {
    const files = Object.keys(night.preimages);
    if (!files.length) return false;
    const workspace = deps.workspaceOf(agentId);
    const postimages: Record<string, string> = {};
    for (const relative of files)
      postimages[relative] = read(path.join(workspace, relative)) ?? "";
    const state = await deps.store.lookup(agentId);
    const earlier = (state?.runs ?? []).filter(({ id }) => id !== night.id);
    await deps.store.register(agentId, {
      runs: [
        { id: night.id, at: night.at, preimages: night.preimages, postimages },
        ...earlier,
      ].slice(0, RUNS_KEPT),
    });
    return true;
  };

  /**
   * Closes a night, once: its run is kept and the night is told. One that wrote
   * nothing leaves no trace, and the day waits for their next sleep.
   */
  const close = async (
    agentId: string,
    night: Night,
    dream?: string,
  ): Promise<void> => {
    if (night.closed) return;
    night.closed = true;
    if (!(await keep(agentId, night))) return;
    await deps.record(
      agentId,
      {
        runId: night.id,
        from: night.since,
        to: night.at,
        pages: [...night.pages],
        newPages: [...night.newPages],
        notes: night.notes,
        ...(dream ? { dream } : {}),
      },
      dream ? `You dreamt: ${dream}` : "You slept on it.",
    );
  };

  /** A night nobody closed ends with whatever they do next. */
  const end = async (agentId: string): Promise<void> => {
    const night = nights.get(agentId);
    if (!night) return;
    nights.delete(agentId);
    await close(agentId, night);
  };

  const review = async (
    agentId: string,
    people: readonly string[],
    answer: unknown,
  ): Promise<void> => {
    try {
      await deps.states?.apply(agentId, people, answer);
    } catch (error: unknown) {
      deps.warn(`Sleep ${agentId}: states: ${String(error)}`);
    }
  };

  /** `reflect`: one thing gone over, or with `today`, the day closed. */
  const reflect = async (
    agentId: string,
    input: Reflection,
  ): Promise<string> => {
    const say = (
      ref: string,
      values: Readonly<Record<string, string>> = {},
    ): string => deps.text(`kazusa-results#${ref}`, values, agentId);
    const night = nights.get(agentId);
    if (!night) throw new Error(say("reflect-awake"));
    deps.room?.(agentId);
    const workspace = deps.workspaceOf(agentId);
    const about = input.about.toLowerCase();

    if (TODAY.has(about)) {
      if (night.closed) return say("reflect-day");
      if (!input.view) throw new Error(say("reflect-no-day"));
      const gist = input.view;
      write(agentId, fileOf(agentId, "day", night.day), (raw) => {
        if (raw) return `${raw.trimEnd()}\n\n${gist}\n`;
        const front = [
          `summary: ${JSON.stringify(input.summary ?? "")}`,
          `touched: ${JSON.stringify([...night.pages])}`,
        ].join("\n");
        const dream = input.dream ? `\n## Dream\n\n${input.dream}\n` : "";
        return `---\n${front}\n---\n\n# ${night.day}\n\n${gist}\n${dream}`;
      });
      // Plans for days gone by go with the night.
      const memory = path.join(workspace, "MEMORY.md");
      const before = read(memory) ?? "";
      if (withoutPlansBefore(before, night.wakeDay) !== before)
        write(agentId, memory, (raw) =>
          withoutPlansBefore(raw ?? "", night.wakeDay),
        );
      // Old notes only go once their gist has been folded into the view.
      const personal = deps.index.personal(agentId);
      for (const id of night.rewritten) {
        const kind = personal.get(id)?.kind;
        if (kind)
          write(agentId, fileOf(agentId, kind, id), (raw) =>
            withNoteCap(raw ?? "", deps.notesPerPage),
          );
      }
      await close(agentId, night, input.dream);
      return say("reflect-day");
    }

    if (ME.has(about)) {
      if (input.view || input.goals)
        write(agentId, path.join(workspace, "MEMORY.md"), (raw) => {
          let next = raw ?? "";
          if (input.view) next = withSection(next, "Lately", input.view);
          if (input.goals)
            next = withSection(
              next,
              "Long-Term Goals",
              input.goals.map((goal) => `- ${goal}`).join("\n"),
            );
          return next;
        });
      if (input.states) await review(agentId, [], { own: input.states });
      return say("reflect-self");
    }

    const { id, kind, name, page } = deps.subject(agentId, input.about);
    // A new view replaces the old one whole, so it is read first: a view
    // written blind loses who they are.
    if (input.view && page?.lead.trim() && !night.shown.has(id)) {
      night.shown.add(id);
      return say("reflect-unread", { name, view: page.lead.trim() });
    }
    if (
      input.view ||
      input.summary ||
      input.relation ||
      input.openThreads ||
      input.theyThinkOfMe
    ) {
      write(
        agentId,
        fileOf(agentId, kind, id),
        (raw) => {
          let next = raw ?? newPage(name, "my guess");
          if (input.summary)
            next = withField(next, "summary", JSON.stringify(input.summary));
          if (input.relation)
            next = withField(next, "relation", JSON.stringify(input.relation));
          if (input.view) next = withLead(next, input.view);
          if (input.theyThinkOfMe)
            next = withSection(
              next,
              "What they think of me",
              input.theyThinkOfMe,
            );
          if (input.openThreads)
            next = withSection(
              next,
              "Open threads",
              input.openThreads.map((thread) => `- ${thread}`).join("\n"),
            );
          return next;
        },
        { page: id },
      );
      if (input.view) night.rewritten.add(id);
    }
    if (input.states && kind === "person") {
      const person = deps.index.world().pages.get(id)?.personId ?? id;
      await review(agentId, [person], { toward: { [person]: input.states } });
    }
    return say("reflect-kept", { name });
  };

  const taskExtension: TaskExtension = {
    startTaskParameters: {},
    delayTaskParameters: {},
    required: [],
    prepare: async ({ agentId, kind, at, task }) => {
      let night: Night | undefined;
      let aside: string | undefined;
      try {
        if (
          deps.enabled &&
          kind === "started" &&
          deps.categories.includes(task.type) &&
          task.duration >= deps.minMinutes
        ) {
          const since = await lastNight(agentId);
          if (at - since >= deps.everyMinutes * 60_000) {
            night = begin(at, since, Date.parse(task.endAt));
            aside = await offer(agentId, night);
          }
        }
      } catch (error: unknown) {
        // Going to bed never fails over what the night would have kept.
        deps.warn(`Sleep ${agentId}: ${String(error)}`);
        night = undefined;
        aside = undefined;
      }
      return {
        ...(aside ? { aside } : {}),
        commit: async () => {
          if (kind !== "started") return;
          await end(agentId);
          if (!night) return;
          nights.set(agentId, night);
          deps.room?.(agentId);
        },
      };
    },
  };

  return {
    taskExtension,
    write,
    reflect,
    /** A night asked for by hand: a turn of their own to go over the day. */
    consolidate: async (agentId: string): Promise<void> => {
      if (!deps.deliver) throw new Error("Nothing can hand them a turn yet.");
      await end(agentId);
      const at = deps.now();
      const night = begin(at, await lastNight(agentId), at);
      const text = await offer(agentId, night);
      nights.set(agentId, night);
      await deps.deliver(agentId, text);
    },
    restore: async (agentId: string, runId: string): Promise<boolean> => {
      const state = await deps.store.lookup(agentId);
      const found = state?.runs.find(({ id }) => id === runId);
      if (!state || !found) return false;
      restoreSleep(deps.workspaceOf(agentId), found.preimages);
      await deps.store.register(agentId, {
        runs: state.runs.filter(({ id }) => id !== runId),
      });
      return true;
    },
    runs: async (agentId: string): Promise<readonly SleepRun[]> =>
      (await deps.store.lookup(agentId))?.runs ?? [],
  };
}
