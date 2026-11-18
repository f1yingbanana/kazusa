import {
  OUTFIT,
  StatDefinitionSchema,
  type StatChangedBy,
  type StatDefinition,
  type StatShown,
  type StatSubject,
} from "@kazusa/client";

/**
 * A state as its form holds it: every field a string, lists one per line.
 * Values are `name: what it means`, bands `name: from: what it means`.
 */
export interface StatDraft {
  name: string;
  description: string;
  on: StatSubject;
  kind: StatDefinition["kind"];
  changedBy: StatChangedBy;
  shown: StatShown;
  values: string;
  initial: string;
  min: string;
  max: string;
  bands: string;
  /** How far one move takes a number with bands; empty for 1. */
  step: string;
}

export const EMPTY_DRAFT: StatDraft = {
  name: "",
  description: "",
  on: "character",
  kind: "choice",
  changedBy: "manual",
  shown: "self",
  values: "",
  initial: "",
  min: "0",
  max: "100",
  bands: "",
  step: "",
};

/** A meaning on one line, as the form lists them. */
function line(description: string): string {
  return description.replace(/\s*[\r\n]+\s*/gu, " ");
}

export function toDraft(stat: StatDefinition): StatDraft {
  const choice = stat.kind === "choice";
  return {
    ...EMPTY_DRAFT,
    name: stat.name,
    description: stat.description,
    on: stat.on,
    kind: stat.kind,
    changedBy: stat.changedBy,
    shown: stat.shown,
    initial: String(stat.initial),
    ...(choice
      ? {
          values: stat.values
            .map(({ name, description }) =>
              description ? `${name}: ${line(description)}` : name,
            )
            .join("\n"),
        }
      : {
          min: String(stat.min),
          max: String(stat.max),
          bands: (stat.bands ?? [])
            .map(({ name, min, description }) =>
              description
                ? `${name}: ${min}: ${line(description)}`
                : `${name}: ${min}`,
            )
            .join("\n"),
          step: stat.step === undefined ? "" : String(stat.step),
        }),
  };
}

/**
 * `stat`, as a form made it, with the line breaks of `opened`'s meanings put
 * back wherever the form left a meaning as it was. The form lists meanings one
 * to a line (`line`), so without this a save that touched nothing would still
 * rewrite a meaning written over several lines.
 */
export function withLinesKept(
  stat: StatDefinition,
  opened: StatDefinition | undefined,
): StatDefinition {
  const kept = <T extends { name: string; description?: string }>(
    made: readonly T[],
    were: readonly T[] | undefined,
  ): T[] =>
    made.map((entry) => {
      const was = were?.find(({ name }) => name === entry.name)?.description;
      return was !== undefined && line(was) === entry.description
        ? { ...entry, description: was }
        : entry;
    });
  if (stat.kind === "choice")
    return {
      ...stat,
      values: kept(
        stat.values,
        opened?.kind === "choice" ? opened.values : undefined,
      ),
    };
  return stat.bands
    ? {
        ...stat,
        bands: kept(
          stat.bands,
          opened?.kind === "number" ? opened.bands : undefined,
        ),
      }
    : stat;
}

/** Non-empty lines, each split on its first `parts - 1` colons. */
function rows(text: string, parts: number): string[][] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const cells: string[] = [];
      let rest = line;
      while (cells.length < parts - 1 && rest.includes(":")) {
        const at = rest.indexOf(":");
        cells.push(rest.slice(0, at).trim());
        rest = rest.slice(at + 1);
      }
      return [...cells, rest.trim()];
    });
}

/** `""` is not a number: `Number("")` is 0. */
function number(text: string): number {
  return text.trim() === "" ? Number.NaN : Number(text);
}

export type DraftResult =
  | { readonly stat: StatDefinition; readonly errors?: undefined }
  /** By field of the form; `""` for what belongs to none. */
  | { readonly stat?: undefined; readonly errors: Record<string, string> };

/**
 * The state a draft describes, or what is wrong with it. `taken` are the names
 * other states already have.
 */
export function fromDraft(
  draft: StatDraft,
  taken: ReadonlySet<string> = new Set(),
): DraftResult {
  const common = {
    name: draft.name.trim(),
    description: draft.description.trim(),
    on: draft.on,
    changedBy: draft.changedBy,
    shown: draft.shown,
  };
  const bands = rows(draft.bands, 3).map(([name, min, description]) => ({
    name,
    min: number(min ?? ""),
    ...(description ? { description } : {}),
  }));
  const parsed = StatDefinitionSchema.safeParse(
    draft.kind === "choice"
      ? {
          ...common,
          kind: "choice",
          values: rows(draft.values, 2).map(([name, description]) => ({
            name,
            ...(description ? { description } : {}),
          })),
          initial: draft.initial.trim(),
        }
      : {
          ...common,
          kind: "number",
          min: number(draft.min),
          max: number(draft.max),
          initial: number(draft.initial),
          ...(bands.length ? { bands } : {}),
          ...(draft.step.trim() ? { step: number(draft.step) } : {}),
        },
  );
  const errors: Record<string, string> = {};
  if (!parsed.success)
    for (const issue of parsed.error.issues) {
      const field = String(issue.path[0] ?? "");
      errors[field] ??= MESSAGES[field] ?? issue.message;
    }
  if (taken.has(common.name)) errors.name = "Another state has this name.";
  if (common.name === OUTFIT)
    errors.name =
      "Outfit is built in: every character with outfits already has it.";
  return Object.keys(errors).length || !parsed.success
    ? { errors }
    : { stat: parsed.data };
}

/** Said in the form's terms, where the schema's own words would not help. */
const MESSAGES: Record<string, string> = {
  name: "Lowercase letters, digits and _, starting with a letter.",
  description: "Say what this state is.",
  values: "Give at least two different values, one per line.",
  initial: "Start at one of the values, or a number in range.",
  min: "A number.",
  max: "A number above the minimum.",
  bands:
    "One per line as `name: from`, lowest first, the first from the minimum and none above the maximum.",
  step: "A number above 0.",
};

/**
 * Whether the state a form was opened on is still as the form found it. A form
 * holds what it read when it opened: saving that over a definition someone has
 * changed since, or back over one they deleted, would undo their change without
 * anyone seeing it.
 */
export function editConflict(
  catalog: readonly StatDefinition[],
  opened: StatDefinition,
): "changed" | "deleted" | undefined {
  const now = catalog.find(({ name }) => name === opened.name);
  if (!now) return "deleted";
  return JSON.stringify(now) === JSON.stringify(opened) ? undefined : "changed";
}

/**
 * How many states a character can take in at once and still handle each with
 * care. A judgment, not a measurement: every one is read each turn, and each
 * one they can change is weighed at every activity change.
 */
export const STATS_ADVISED = 8;

/** The states that reach a character: any they read or change themselves. */
export function statsCharactersSee(catalog: readonly StatDefinition[]): number {
  return catalog.filter(
    ({ shown, changedBy }) => shown !== "nobody" || changedBy !== "manual",
  ).length;
}

/** Ready-made states, to start from or to see how one is written. */
export const STAT_EXAMPLES: readonly {
  readonly label: string;
  readonly stat: StatDefinition;
}[] = [
  {
    label: "Mood",
    stat: {
      name: "mood",
      description:
        "Your mood right now, as it would show on you. It changes only when something clearly shifts it, not with every message.",
      on: "character",
      kind: "choice",
      values: [
        { name: "calm", description: "Settled, nothing weighing on you" },
        { name: "cheerful", description: "Light and pleased" },
        { name: "irritated", description: "Short-tempered, easily set off" },
        { name: "down", description: "Low and withdrawn" },
      ],
      initial: "calm",
      changedBy: "character",
      shown: "self",
    },
  },
  {
    label: "Warmth toward someone",
    stat: {
      name: "warmth",
      description:
        "How warmly you regard this person. It moves only on something that mattered between the two of you: a real kindness or a confidence raises it, cruelty or broken trust lowers it. Ordinary talk changes nothing.",
      on: "pair",
      kind: "number",
      min: 0,
      max: 39,
      initial: 12,
      bands: [
        { name: "cold", min: 0, description: "You would rather avoid them" },
        { name: "polite", min: 8, description: "Civil, nothing more" },
        { name: "friendly", min: 16, description: "Glad to see them" },
        {
          name: "close",
          min: 24,
          description: "You trust them and seek them out",
        },
        {
          name: "devoted",
          min: 32,
          description: "They come before almost anything",
        },
      ],
      changedBy: "reviewed",
      shown: "self",
    },
  },
  {
    label: "Money",
    stat: {
      name: "money",
      description:
        "What you have on you to spend. A meal costs about 1 and a nice gift about 6. It changes only when you actually pay for something or are given money.",
      on: "character",
      kind: "number",
      min: 0,
      max: 50,
      initial: 20,
      changedBy: "character",
      shown: "self",
    },
  },
  {
    label: "Health (HP)",
    stat: {
      name: "hp",
      description:
        "How much harm your body can still take. A blow or a cut that lands takes about 3, a serious wound about 8, and being treated gives back about 5. Words alone never change it.",
      on: "character",
      kind: "number",
      min: 0,
      max: 20,
      initial: 20,
      changedBy: "character",
      shown: "self",
    },
  },
  {
    label: "Chapter of the story",
    stat: {
      name: "chapter",
      description: "Where the story stands for everyone.",
      on: "world",
      kind: "choice",
      values: [
        { name: "prologue", description: "Before anything has happened" },
        { name: "rising", description: "Trouble is building" },
        { name: "climax", description: "Everything is at stake" },
      ],
      initial: "prologue",
      changedBy: "manual",
      shown: "self",
    },
  },
];
