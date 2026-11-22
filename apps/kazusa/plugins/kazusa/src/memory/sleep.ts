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
 * and writes the day down (`reflect` about `today`). There is no pass of its
 * own, so nothing to schedule, interrupt or resume: the night is over when that
 * run is (`runEnded`), whatever the model did or didn't say, and code tidies up
 * after it.
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
  new: z.boolean().optional(),
});
export type Reflection = z.infer<typeof REFLECT>;

const ME = new Set(["me", "myself"]);
/** However they name the day; a date counts too (`reflect`). */
const TODAY = new Set(["today", "the day", "day", "my day", "tonight"]);
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Their pages and fading notes shown at bedtime, in characters: about 6,000
 * tokens, and with the rest of what going to bed says, under what one stimulus
 * holds (a night asked for by hand arrives as one).
 */
const SHOWN_CHARS = 24_000;
/**
 * The most a turn can be handed, and so the most going to bed may say in all: a
 * page cut short on the way would still count as read whole.
 */
export const OFFER_CHARS = 32_000;
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
  /**
   * Gone over awake, handed back by a person who played them: the next pages
   * shown start after it, but it is no night's sleep.
   */
  readonly review?: true;
}
export interface SleepState {
  /** Newest first; the newest is when they last slept on things. */
  readonly runs: readonly SleepRun[];
}

/** A night being gone over: from going to bed until that run ends. */
export interface Night {
  /** Its run, once kept. */
  readonly id: string;
  /**
   * Awake, looking back on what a person said and did as them (`lookBack`):
   * kept like a night, but it counts as no sleep.
   */
  readonly review?: true;
  /**
   * Asked for by hand and not begun: it waits for the turn that goes over it,
   * and a run that ends meanwhile leaves it be. Their first call begins it.
   */
  waiting?: boolean;
  /** A run of theirs began after it was asked for: its turn has come. */
  offered?: boolean;
  /** The day was written down; saying it again changes nothing. */
  dayKept?: boolean;
  dream?: string;
  /** Sim time it began, and the night before it. */
  readonly at: number;
  readonly since: number;
  /** The day lived, and the day they wake to. */
  readonly day: string;
  readonly wakeDay: string;
  /** Pages they have read tonight: a view replaces only what was read. */
  readonly shown: Set<string>;
  /** Pages read whole, notes and all: only their oldest notes may go. */
  readonly whole: Set<string>;
  /** A state moved tonight: the night happened even if no file changed. */
  moved?: boolean;
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
  /** Nobody has a page on it, theirs or the world's: writing makes one. */
  readonly unknown: boolean;
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
  /**
   * The pages they already have that come closest to a name nothing answers to,
   * as lines to show them, or nothing: a new page is only made once they have
   * seen these (`knownOrNew`).
   */
  readonly similar?: (
    agentId: string,
    about: string,
  ) => Promise<string | undefined>;
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
    ) => Promise<{
      readonly moved: readonly string[];
      readonly left: readonly string[];
    } | void>;
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
/**
 * The day a night closes is the one they were up for: going to bed after
 * midnight still ends yesterday.
 */
const HALF_DAY_MS = 12 * 3_600_000;

/**
 * Names each character was shown their closest pages for (`knownOrNew`), so
 * `new` only makes a page after they have seen them. In memory: after a restart
 * they are shown once more.
 */
const ASKED = Symbol.for("kazusa.memory.asked");
function asked(agentId: string): Set<string> {
  const scope = globalThis as { [ASKED]?: Map<string, Set<string>> };
  const all = (scope[ASKED] ??= new Map<string, Set<string>>());
  const mine = all.get(agentId) ?? new Set<string>();
  all.set(agentId, mine);
  return mine;
}

/**
 * A night's run that could not be kept when the night ended, by character. One
 * map for the process, as the nights are: whichever registration is asked next
 * must know of it.
 */
const OWED = Symbol.for("kazusa.memory.owed");
function owedRuns(): Map<string, SleepRun> {
  const scope = globalThis as { [OWED]?: Map<string, SleepRun> };
  return (scope[OWED] ??= new Map<string, SleepRun>());
}

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
    const held = nights.get(agentId);
    // One asked for by hand takes nothing before its own turn: the run it was
    // asked during is not it, and would end it before that turn came.
    const night = held?.waiting && !held.offered ? undefined : held;
    if (night) {
      delete night.waiting;
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
  };

  /**
   * Before a page is made for a name nothing answers to: the pages they have
   * that come closest, said once, so a friend called by first name is not
   * written down as a stranger. Nothing when the name is known, nothing comes
   * close, or they say it is `new` having seen them: models send `new` with a
   * first try, so by itself it proves nothing.
   */
  const knownOrNew = async (
    agentId: string,
    subject: Subject,
    about: string,
    isNew: boolean | undefined,
  ): Promise<string | undefined> => {
    if (!subject.unknown) return undefined;
    const seen = asked(agentId);
    if (isNew && seen.has(subject.id)) return undefined;
    const pages = await deps.similar?.(agentId, about).catch(() => undefined);
    if (!pages) return undefined;
    seen.add(subject.id);
    return deps.text(
      "kazusa-results#page-unknown",
      { name: about, pages },
      agentId,
    );
  };

  /**
   * The ids a page's person may go by where states are kept: the player's page
   * is `sensei`, the player `user:sensei`. Whoever keeps states knows which of
   * them is a person.
   */
  const personsOf = (agentId: string, id: string): string[] => {
    const known =
      deps.index.personal(agentId).get(id)?.personId ??
      deps.index.world().pages.get(id)?.personId;
    return [...new Set([known ?? id, id, `user:${id}`])];
  };

  /**
   * A night's run that could not be kept when the night ended, by character.
   * The pages are rewritten and the states moved all the same, so it is still
   * their last night, and it is kept at the next chance.
   */
  const owed = owedRuns();

  /** Keeps runs, newest first, in place of any kept under the same ids. */
  const persist = async (
    agentId: string,
    runs: readonly SleepRun[],
  ): Promise<void> => {
    const ids = new Set(runs.map(({ id }) => id));
    const state = await deps.store.lookup(agentId);
    await deps.store.register(agentId, {
      runs: [...runs, ...(state?.runs ?? []).filter(({ id }) => !ids.has(id))]
        .sort((a, b) => b.at - a.at)
        .slice(0, RUNS_KEPT),
    });
  };

  /** Keeps a run still owed. Failing again leaves it owed. */
  const settle = async (agentId: string): Promise<void> => {
    const run = owed.get(agentId);
    if (!run) return;
    try {
      await persist(agentId, [run]);
      if (owed.get(agentId) === run) owed.delete(agentId);
    } catch (error: unknown) {
      deps.warn(
        `Sleep ${agentId}: last night is still not kept: ${String(error)}`,
      );
    }
  };

  /** When they last went over things, asleep or looking back awake. */
  const lastNight = async (agentId: string): Promise<number> => {
    await settle(agentId);
    return Math.max(
      (await deps.store.lookup(agentId))?.runs[0]?.at ?? 0,
      owed.get(agentId)?.at ?? 0,
    );
  };
  /** When they last slept on things: a look back awake is no night. */
  const lastSlept = async (agentId: string): Promise<number> => {
    await settle(agentId);
    const slept = (run: SleepRun | undefined) =>
      run && !run.review ? run.at : 0;
    return Math.max(
      ((await deps.store.lookup(agentId))?.runs ?? []).find(
        (run) => !run.review,
      )?.at ?? 0,
      slept(owed.get(agentId)),
    );
  };

  /**
   * What going to bed says: how to go over the day, their own pages on what the
   * day touched, notes about to fade, and the states a night reviews.
   */
  const offer = async (
    agentId: string,
    night: Night,
    /** What they said and did, shown when it reaches past their records. */
    played?: string,
  ): Promise<string> => {
    const personal = deps.index.personal(agentId);
    const world = deps.index.world();
    const touched = await deps.touched(agentId, night.since);
    const people = touched
      .filter(
        (id) => (personal.get(id) ?? world.pages.get(id))?.kind === "person",
      )
      .slice(0, PEOPLE_REVIEWED)
      .flatMap((id) => personsOf(agentId, id));
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
    const lead = [
      section(night.review ? "looking-back" : "night"),
      ...(played ? [section("played", { lines: played })] : []),
      ...(states ? [section("states", { states })] : []),
    ];
    const pages: string[] = [];
    const fading: string[] = [];
    const between = "\n\n".length;
    // One budget for both, latest first: a page goes in whole or not at all,
    // and its fading notes only if they fit too. It is what is left of a turn
    // after everything else said here, so nothing shown is cut on the way.
    let room = Math.min(
      SHOWN_CHARS,
      OFFER_CHARS -
        [
          ...lead,
          section("pages", { pages: "" }),
          section("fading", { notes: "" }),
        ].join("\n\n").length,
    );
    for (const id of touched) {
      const page = personal.get(id);
      if (!page || page.kind === "day") continue;
      const raw = read(fileOf(agentId, page.kind, id));
      const shown = raw ? `### ${id}\n${raw.trim()}` : undefined;
      if (!shown || shown.length + between > room) continue;
      room -= shown.length + between;
      night.shown.add(id);
      night.whole.add(id);
      pages.push(shown);
      // Lifelong knowledge never fades; everything else may.
      const old = [...page.notes]
        .sort((a, b) => b.date.localeCompare(a.date))
        .filter(
          (note, at) =>
            at >= deps.notesPerPage && note.source !== "always known",
        )
        .map((note) => `${note.date}: ${note.text}`)
        .join("\n");
      const faded = old ? `### ${id}\n${old}` : undefined;
      if (faded && faded.length + between <= room) {
        room -= faded.length + between;
        fading.push(faded);
      }
    }
    return [
      ...lead,
      ...(pages.length
        ? [section("pages", { pages: pages.join("\n\n") })]
        : []),
      ...(fading.length
        ? [section("fading", { notes: fading.join("\n\n") })]
        : []),
    ].join("\n\n");
  };

  const begin = (
    at: number,
    since: number,
    wakeAt: number,
    review = false,
  ): Night => ({
    id: randomUUID(),
    ...(review ? { review: true as const } : {}),
    at,
    since,
    // Awake, the day is today; going to bed after midnight, it is yesterday.
    day: iso(review ? at : at - HALF_DAY_MS),
    wakeDay: iso(wakeAt),
    shown: new Set(),
    whole: new Set(),
    preimages: {},
    pages: new Set(),
    newPages: new Set(),
    rewritten: new Set(),
    notes: 0,
  });

  /**
   * Keeps what a night wrote so far as its one run, shown and undoable. One
   * that only moved states is kept too, with no files: it is still their last
   * night, so the same day is not gone over again.
   */
  const keep = async (agentId: string, night: Night): Promise<boolean> => {
    const files = Object.keys(night.preimages);
    if (!files.length && !night.moved) return false;
    const workspace = deps.workspaceOf(agentId);
    const postimages: Record<string, string> = {};
    for (const relative of files)
      postimages[relative] = read(path.join(workspace, relative)) ?? "";
    const run: SleepRun = {
      id: night.id,
      at: night.at,
      preimages: night.preimages,
      postimages,
      ...(night.review ? { review: true as const } : {}),
    };
    const waiting = owed.get(agentId);
    try {
      await persist(agentId, waiting ? [run, waiting] : [run]);
      owed.delete(agentId);
    } catch (error: unknown) {
      // The night is over either way, and its preimages go with it: the run is
      // held as it stands now and kept before the next night is counted from.
      // One owed at a time: an older one still waiting gives way.
      owed.set(agentId, run);
      deps.warn(
        `Sleep ${agentId}: the night is not kept yet: ${String(error)}`,
      );
    }
    return true;
  };

  /**
   * The night is over: what code owes it, whatever the model did. Plans for
   * days gone by go, old notes go from pages whose view took them in, its run
   * is kept and the night is told. One that wrote nothing and moved no state
   * leaves no trace, and the day waits for their next sleep.
   */
  const close = async (agentId: string, night: Night): Promise<void> => {
    if (!Object.keys(night.preimages).length && !night.moved) return;
    const memory = path.join(deps.workspaceOf(agentId), "MEMORY.md");
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
    await keep(agentId, night);
    await deps.record(
      agentId,
      {
        runId: night.id,
        from: night.since,
        to: night.at,
        pages: [...night.pages],
        newPages: [...night.newPages],
        notes: night.notes,
        ...(night.dream ? { dream: night.dream } : {}),
      },
      night.review
        ? deps.text("kazusa-results#looked-back", {}, agentId)
        : night.dream
          ? deps.text(
              "kazusa-results#night-dreamt",
              { dream: night.dream },
              agentId,
            )
          : deps.text("kazusa-results#night-slept", {}, agentId),
    );
  };

  /** Ends whatever night they have, begun or not. */
  const end = async (agentId: string): Promise<void> => {
    const night = nights.get(agentId);
    if (!night) return;
    try {
      // Still theirs while it is tidied: what that writes is part of it.
      await close(agentId, night);
    } catch (error: unknown) {
      deps.warn(`Sleep ${agentId}: ${String(error)}`);
    } finally {
      nights.delete(agentId);
    }
  };

  const review = async (
    agentId: string,
    people: readonly string[],
    answer: unknown,
  ): Promise<string> => {
    try {
      const result = await deps.states?.apply(agentId, people, answer);
      if (!result) return "";
      const night = nights.get(agentId);
      if (night && result.moved.length) night.moved = true;
      // Said back: a state given the wrong way is otherwise dropped unseen.
      return [
        ...(result.moved.length
          ? [
              deps.text(
                "kazusa-results#reflect-states",
                { states: result.moved.join(", ") },
                agentId,
              ),
            ]
          : []),
        ...(result.left.length
          ? [
              deps.text(
                "kazusa-results#reflect-states-left",
                { states: result.left.join(", ") },
                agentId,
              ),
            ]
          : []),
      ]
        .map((line) => ` ${line.trim()}`)
        .join("");
    } catch (error: unknown) {
      deps.warn(`Sleep ${agentId}: states: ${String(error)}`);
      return "";
    }
  };

  /** `reflect`: one thing gone over, or with `today`, the day written down. */
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
    delete night.waiting;
    deps.room?.(agentId);
    const workspace = deps.workspaceOf(agentId);
    const about = input.about.toLowerCase();

    const dated = ISO_DAY.test(about) ? about : undefined;
    if (TODAY.has(about) || dated) {
      if (night.dayKept) return say("reflect-day");
      if (!input.view) throw new Error(say("reflect-no-day"));
      const gist = input.view;
      // A date is the day, never a page of its own. An earlier one is the day
      // they mean, back after days away; a later one is only the clock, past
      // midnight.
      const day = dated && dated < night.day ? dated : night.day;
      write(agentId, fileOf(agentId, "day", day), (raw) => {
        if (raw) return `${raw.trimEnd()}\n\n${gist}\n`;
        const front = [
          `summary: ${JSON.stringify(input.summary ?? "")}`,
          `touched: ${JSON.stringify([...night.pages])}`,
        ].join("\n");
        const dream = input.dream ? `\n## Dream\n\n${input.dream}\n` : "";
        return `---\n${front}\n---\n\n# ${day}\n\n${gist}\n${dream}`;
      });
      night.dayKept = true;
      if (input.dream) night.dream = input.dream;
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
      const states = input.states
        ? await review(agentId, [], { own: input.states })
        : "";
      return `${say("reflect-self")}${states}`;
    }

    const subject = deps.subject(agentId, input.about);
    const { id, kind, name, page } = subject;
    const first = await knownOrNew(agentId, subject, input.about, input.new);
    if (first) return first;
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
      // Their oldest notes go only if tonight showed them: a view written
      // from the lead alone has not taken them in.
      if (input.view && night.whole.has(id)) night.rewritten.add(id);
    }
    let states = "";
    if (input.states && kind === "person") {
      const persons = personsOf(agentId, id);
      states = await review(agentId, persons, {
        toward: Object.fromEntries(
          persons.map((person) => [person, input.states]),
        ),
      });
    }
    return `${say("reflect-kept", { name })}${states}`;
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
          // A night they are already going over stands: back to bed in the same
          // run does not offer the day a second time. One asked for by hand
          // and not begun gives way to this one.
          const going = nights.get(agentId);
          if (
            (!going || going.waiting) &&
            at - (await lastSlept(agentId)) >= deps.everyMinutes * 60_000
          ) {
            night = begin(at, await lastNight(agentId), Date.parse(task.endAt));
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
          if (kind !== "started" || !night) return;
          // One asked for by hand and never begun gives way to the real one.
          await end(agentId);
          nights.set(agentId, night);
          deps.room?.(agentId);
        },
      };
    },
  };

  return {
    taskExtension,
    write,
    knownOrNew,
    reflect,
    /**
     * The day a note made now belongs to, while a night is gone over: the one
     * they were up for, so bed after midnight doesn't date it tomorrow.
     */
    day: (agentId: string): string | undefined => nights.get(agentId)?.day,
    /**
     * A run of theirs ended: so has the night it went over. One asked for by
     * hand that hasn't begun is for a turn still to come.
     */
    runEnded: async (agentId: string): Promise<void> => {
      const night = nights.get(agentId);
      if (!night?.waiting) return end(agentId);
      // Its turn came and went without a call: nothing to keep, and left
      // waiting it would swallow the next thing they note.
      if (night.offered) nights.delete(agentId);
    },
    /**
     * A run of theirs began. For a night asked for by hand this is its turn: it
     * gets the room a bedtime gets from `start_task`, before the first call
     * instead of after it.
     */
    runStarted: (agentId: string): void => {
      const night = nights.get(agentId);
      if (!night?.waiting) return;
      night.offered = true;
      deps.room?.(agentId);
    },
    /** A night asked for by hand: a turn of their own to go over the day. */
    consolidate: async (agentId: string): Promise<void> => {
      if (!deps.deliver) throw new Error("Nothing can hand them a turn yet.");
      await end(agentId);
      const at = deps.now();
      const night = begin(at, await lastNight(agentId), at);
      night.waiting = true;
      const text = await offer(agentId, night);
      nights.set(agentId, night);
      try {
        await deps.deliver(agentId, text);
      } catch (error: unknown) {
        // No turn is coming to go over it.
        if (nights.get(agentId) === night) nights.delete(agentId);
        throw error;
      }
    },
    /**
     * Handed back by a person who played them: a turn of their own to look back
     * on what was said and done as them, and keep what matters, over the pages
     * the time since they last went over things touched. `played` is what they
     * said and did, for a stretch longer than their records reach.
     */
    lookBack: async (agentId: string, played?: string): Promise<void> => {
      if (!deps.deliver) throw new Error("Nothing can hand them a turn yet.");
      await end(agentId);
      const at = deps.now();
      const night = begin(at, await lastNight(agentId), at, true);
      night.waiting = true;
      const text = await offer(agentId, night, played);
      nights.set(agentId, night);
      try {
        await deps.deliver(agentId, text);
      } catch (error: unknown) {
        if (nights.get(agentId) === night) nights.delete(agentId);
        throw error;
      }
    },
    restore: async (agentId: string, runId: string): Promise<boolean> => {
      await settle(agentId);
      const state = await deps.store.lookup(agentId);
      const found = state?.runs.find(({ id }) => id === runId);
      if (!state || !found) return false;
      restoreSleep(deps.workspaceOf(agentId), found.preimages);
      await deps.store.register(agentId, {
        runs: state.runs.filter(({ id }) => id !== runId),
      });
      return true;
    },
    runs: async (agentId: string): Promise<readonly SleepRun[]> => {
      await settle(agentId);
      return (await deps.store.lookup(agentId))?.runs ?? [];
    },
  };
}
