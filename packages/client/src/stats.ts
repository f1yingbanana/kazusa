import { z } from "zod";

/*
 * States: named values a world defines for its characters, for one character's
 * view of another, for the player, or for the world as a whole
 * (`GET /kazusa/stats`, SSE `stats`). "State" is what people call them; the code says `stats`, because
 * `state` and `status` already mean other things here.
 */

/** Shown to models and used as a JSON key. */
export const STAT_NAME = /^[a-z][a-z0-9_]*$/u;
const NAME = z.string().regex(STAT_NAME, "lowercase words joined by _");
const TEXT = z.string().trim().min(1);
/**
 * A value's or a band's word. One line without a colon, so a list of them can
 * be written one per line as `name: what it means`.
 */
const WORD = TEXT.max(64).regex(/^[^:\r\n]+$/u, "one line, without a colon");

/** One value a choice state can have. */
export const StatValueDefSchema = z.object({
  name: WORD,
  /** What it means, for whoever sets or judges it. */
  description: z.string().trim().optional(),
});
export type StatValueDef = z.infer<typeof StatValueDefSchema>;

/**
 * An outfit as a character's stickers name it. The word comes from their
 * sticker folder, not from the catalog, so whatever is named there is read: a
 * word a catalog would refuse must not keep the states from loading.
 */
const OutfitSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
});

/** A word for a range of a number state, from `min` up to the next band. */
export const StatBandSchema = z.object({
  name: WORD,
  min: z.number().finite(),
  /** What standing in it means, for whoever reads it. */
  description: z.string().trim().optional(),
});
export type StatBand = z.infer<typeof StatBandSchema>;

/**
 * What a state sits on. A pair is one character's private view of another; a
 * `player` state is one only the human player has, and sets themselves.
 */
export const StatSubjectSchema = z.enum([
  "character",
  "pair",
  "world",
  "player",
]);
export type StatSubject = z.infer<typeof StatSubjectSchema>;

/**
 * Who changes it, besides the user and the system agent, who always can: the
 * `character` themselves while awake, their night's sleep looking back on the
 * day (`reviewed`), or nobody (`manual`).
 */
export const StatChangedBySchema = z.enum(["character", "reviewed", "manual"]);
export type StatChangedBy = z.infer<typeof StatChangedBySchema>;

/**
 * Who reads it in their prompt: the character it is on (`self`), also the
 * people standing with them (`everyone`), or `nobody` (code and client only).
 */
export const StatShownSchema = z.enum(["self", "everyone", "nobody"]);
export type StatShown = z.infer<typeof StatShownSchema>;

const base = {
  name: NAME,
  /** What it is. The one thing a model is told about it. */
  description: TEXT,
  on: StatSubjectSchema,
  changedBy: StatChangedBySchema,
  shown: StatShownSchema,
};

export const ChoiceStatSchema = z.object({
  ...base,
  kind: z.literal("choice"),
  values: z.array(StatValueDefSchema).min(2),
  initial: TEXT,
});
export type ChoiceStat = z.infer<typeof ChoiceStatSchema>;

export const NumberStatSchema = z.object({
  ...base,
  kind: z.literal("number"),
  min: z.number().finite(),
  max: z.number().finite(),
  initial: z.number().finite(),
  /**
   * Ascending, the first from `min` and none above `max`, so every value has a
   * word. With bands a character reads the word, not the number, and moves it a
   * `step` at a time by saying which way (`statMoved`).
   */
  bands: z.array(StatBandSchema).optional(),
  /** How far one move takes a state with bands. 1 when absent. */
  step: z.number().finite().positive().optional(),
});
export type NumberStat = z.infer<typeof NumberStatSchema>;

function unique(names: readonly string[]): boolean {
  return new Set(names).size === names.length;
}

export const StatDefinitionSchema = z
  .discriminatedUnion("kind", [ChoiceStatSchema, NumberStatSchema])
  .superRefine((stat, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: "custom", path: [path], message });
    if (stat.on === "world" && stat.changedBy !== "manual")
      issue("changedBy", "a state of the world is only set by hand");
    if (stat.on === "pair" && stat.changedBy === "character")
      issue(
        "changedBy",
        "a state toward someone is reviewed at night or set by hand",
      );
    if (stat.on === "pair" && stat.shown === "everyone")
      issue("shown", "a state toward someone is private to whoever holds it");
    if (stat.on === "player" && stat.changedBy !== "manual")
      issue("changedBy", "a state of the player is only set by hand");
    if (stat.on === "player" && stat.shown === "self")
      issue(
        "shown",
        "a state of the player is read by the people with them, or by nobody",
      );
    if (stat.kind === "choice") {
      const names = stat.values.map(({ name }) => name);
      if (!unique(names)) issue("values", "values must be unique");
      if (!names.includes(stat.initial))
        issue("initial", "the initial value must be one of the values");
      return;
    }
    if (stat.max <= stat.min) issue("max", "max must be above min");
    if (stat.initial < stat.min || stat.initial > stat.max)
      issue("initial", "the initial value must be between min and max");
    const bands = stat.bands ?? [];
    if (!unique(bands.map(({ name }) => name)))
      issue("bands", "band names must be unique");
    if (
      bands.some((band, index) => index > 0 && band.min <= bands[index - 1].min)
    )
      issue("bands", "bands must ascend");
    if (bands.length && bands[0].min > stat.min)
      issue("bands", "the first band must start at min");
    if (bands.some((band) => band.min > stat.max))
      issue("bands", "no band may start above max");
  });
export type StatDefinition = z.infer<typeof StatDefinitionSchema>;

/**
 * What a character is wearing: a state every character with outfits has, never
 * defined by a world. Its values are that character's own outfits (the words
 * their `stickers/stickers.json` declares) and their usual clothes.
 */
export const OUTFIT = "outfit";
export const USUAL_OUTFIT = "usual";

/** A world's states, in the order they are shown (`shared/stats.json`). */
export const StatCatalogSchema = z
  .array(StatDefinitionSchema)
  .max(64)
  .refine((catalog) => unique(catalog.map(({ name }) => name)), {
    message: "state names must be unique",
  })
  .refine((catalog) => catalog.every(({ name }) => name !== OUTFIT), {
    message: "outfit is built in: it comes from each character's own outfits",
  });
export type StatCatalog = z.infer<typeof StatCatalogSchema>;

/** The outfit state of a character with these outfits besides the usual. */
export function outfitStat(outfits: readonly StatValueDef[]): ChoiceStat {
  return {
    name: OUTFIT,
    description: "What you are wearing.",
    on: "character",
    changedBy: "character",
    shown: "everyone",
    kind: "choice",
    values: [
      { name: USUAL_OUTFIT, description: "your usual clothes" },
      ...outfits,
    ],
    initial: USUAL_OUTFIT,
  };
}

/** Whoever a set of states is for, as far as which of them they have goes. */
export interface StatHolder {
  /** The human player, who alone has the `player` states. */
  readonly player?: boolean;
  /** Their outfits besides the usual clothes. */
  readonly outfits?: readonly StatValueDef[];
}

/**
 * The states one person has: the world's that exist for them, and their outfit
 * if any.
 */
export function statsOf(catalog: StatCatalog, holder: StatHolder): StatCatalog {
  const theirs = catalog.filter(
    (stat) => stat.on !== "player" || holder.player === true,
  );
  return holder.outfits?.length
    ? [outfitStat(holder.outfits), ...theirs]
    : theirs;
}

/** The outfit word worn, or nothing in the usual clothes. */
export function wornOutfit(
  outfits: readonly StatValueDef[] | undefined,
  record: StatRecord | undefined,
): string | undefined {
  if (!outfits?.length) return undefined;
  const value = statValue(outfitStat(outfits), record?.own[OUTFIT]);
  return value === USUAL_OUTFIT ? undefined : String(value);
}

export const StatValueSchema = z.union([z.string(), z.number().finite()]);
export type StatValue = z.infer<typeof StatValueSchema>;

/** Who last set a value. `system` is the system agent or code. */
export const StatAuthorSchema = z.enum([
  "character",
  "reviewed",
  "user",
  "system",
]);
export type StatAuthor = z.infer<typeof StatAuthorSchema>;

export const StatEntrySchema = z.object({
  value: StatValueSchema,
  /** Sim time it was set. */
  at: z.number(),
  by: StatAuthorSchema,
});
export type StatEntry = z.infer<typeof StatEntrySchema>;

const EntriesSchema = z.record(z.string(), StatEntrySchema);

/**
 * What has been set for one character: their own states by name, and those
 * toward others by the other's id. A state with no entry is at its `initial`.
 */
export const StatRecordSchema = z.object({
  own: EntriesSchema,
  toward: z.record(z.string(), EntriesSchema),
});
export type StatRecord = z.infer<typeof StatRecordSchema>;

/** GET /kazusa/stats. */
export const StatsResponseSchema = z.object({
  catalog: StatCatalogSchema,
  /**
   * Names this version of the catalog, for saving a change to it. Absent from a
   * Gateway started before it had one: its saves go unchecked, as they did.
   */
  revision: z.string().optional(),
  /** By character id; characters with nothing set are absent. */
  records: z.record(z.string(), StatRecordSchema),
  /** The world's own states by name. */
  world: EntriesSchema,
  /** By character id: their outfits besides the usual clothes, if any. */
  outfits: z.record(z.string(), z.array(OutfitSchema)),
});
export type StatsResponse = z.infer<typeof StatsResponseSchema>;

/**
 * POST /kazusa/stats/catalog: replaces the world's states. `base` is the
 * `revision` the change was made from: when the catalog has changed since, the
 * save is refused (409) instead of undoing that change.
 */
export const StatCatalogSavePayloadSchema = z.object({
  catalog: StatCatalogSchema,
  base: z.string().optional(),
});
export type StatCatalogSavePayload = z.infer<
  typeof StatCatalogSavePayloadSchema
>;

/**
 * POST /kazusa/stats/set. `characterId` is absent for a state of the world and
 * the player's id for one of theirs, `toward` present for one toward someone; a
 * `null` value puts it back to its initial.
 */
export const StatSetPayloadSchema = z.object({
  name: NAME,
  characterId: z.string().min(1).optional(),
  toward: z.string().min(1).optional(),
  value: StatValueSchema.nullable(),
});
export type StatSetPayload = z.infer<typeof StatSetPayloadSchema>;

/**
 * One subject's whole record after a change (`characterId` absent: the
 * world's), or `catalog: true` when the definitions changed: refetch.
 */
export const StatsStreamEventSchema = z.object({
  type: z.literal("stats"),
  characterId: z.string().optional(),
  record: StatRecordSchema.optional(),
  catalog: z.literal(true).optional(),
});
export type StatsStreamEvent = z.infer<typeof StatsStreamEventSchema>;

/** `value` if this state can hold it, clamped; otherwise nothing. */
export function coerceStat(
  stat: StatDefinition,
  value: unknown,
): StatValue | undefined {
  if (stat.kind === "choice")
    return typeof value === "string" &&
      stat.values.some(({ name }) => name === value)
      ? value
      : undefined;
  const number =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : Number.NaN;
  return Number.isFinite(number)
    ? Math.min(stat.max, Math.max(stat.min, number))
    : undefined;
}

/**
 * What a state stands at: the entry, a number kept within the range the state
 * has now; the initial when there is none or the choice no longer has its
 * word.
 */
export function statValue(
  stat: StatDefinition,
  entry: StatEntry | undefined,
): StatValue {
  return coerceStat(stat, entry?.value) ?? stat.initial;
}

/** The band a number falls in, when the state has bands. */
export function statBand(stat: NumberStat, value: number): string | undefined {
  let found: string | undefined;
  for (const band of stat.bands ?? []) if (value >= band.min) found = band.name;
  return found;
}

/** The band a number falls in, whole, and the one above it. */
function bandsAt(
  stat: NumberStat,
  value: number,
): {
  readonly at?: StatBand;
  readonly below?: StatBand;
  readonly above?: StatBand;
} {
  const bands = stat.bands ?? [];
  const index = bands.findLastIndex((band) => value >= band.min);
  return {
    ...(index >= 0 ? { at: bands[index] } : {}),
    ...(index > 0 ? { below: bands[index - 1] } : {}),
    ...(bands[index + 1] ? { above: bands[index + 1] } : {}),
  };
}

/** What a value means, where the world says: a choice's value, or a band. */
export function statMeaning(
  stat: StatDefinition,
  value: StatValue,
): string | undefined {
  if (stat.kind === "choice")
    return stat.values.find(({ name }) => name === value)?.description;
  return typeof value === "number"
    ? bandsAt(stat, value).at?.description
    : undefined;
}

/**
 * A value as whoever holds it reads it. A number with bands also says when one
 * move would take it into the next band: they move it by direction and never
 * see the number.
 */
export function statStanding(stat: StatDefinition, value: StatValue): string {
  if (stat.kind === "choice" || typeof value !== "number")
    return statWord(stat, value);
  const { at, below, above } = bandsAt(stat, value);
  if (!at) return statWord(stat, value);
  const step = stat.step ?? 1;
  if (above && value + step >= above.min)
    return `${at.name}, close to ${above.name}`;
  if (below && value - step < at.min)
    return `${at.name}, close to ${below.name}`;
  return at.name;
}

/**
 * Steps from one band to the next: how fine a state with bands is, and so how
 * many things that mattered it takes to change the word. A state whose bands
 * are a step apart moves a whole word at a time, which a model rarely dares
 * ("warm to devoted is a big step"), so it hardly moves; about 8 lets one thing
 * count a little and keeps ordinary days from adding up to a band (measured,
 * `kazusa/references/status.md` §5).
 */
export function statStride(stat: StatDefinition): number {
  if (stat.kind !== "number" || !stat.bands || stat.bands.length < 2) return 1;
  const gaps = stat.bands
    .slice(1)
    .map((band, index) => band.min - (stat.bands?.[index]?.min ?? 0))
    .sort((a, b) => a - b);
  return Math.max(
    1,
    Math.round((gaps[Math.floor(gaps.length / 2)] ?? 1) / (stat.step ?? 1)),
  );
}

const MOVES: Readonly<Record<string, number>> = { up: 1, down: -1 };

/**
 * What a model's answer makes of a value that stands at `current`, or nothing
 * when the state can't take it. A number with bands moves one `step` `up` or
 * `down` and takes nothing else: models judge which way well and how far badly.
 * A number without bands takes the new number, or a signed change (`"-3"`).
 */
export function statMoved(
  stat: StatDefinition,
  current: StatValue,
  given: unknown,
): StatValue | undefined {
  if (stat.kind === "choice") return coerceStat(stat, given);
  const from = typeof current === "number" ? current : stat.initial;
  const word = typeof given === "string" ? given.trim().toLowerCase() : "";
  if (stat.bands?.length) {
    const move = MOVES[word];
    return move === undefined
      ? undefined
      : coerceStat(stat, from + move * (stat.step ?? 1));
  }
  return /^[+-](?:\d|\.\d)/u.test(word)
    ? coerceStat(stat, from + Number(word))
    : coerceStat(stat, given);
}

/** A value as a character reads it: the word, a band's word, or the number. */
export function statWord(stat: StatDefinition, value: StatValue): string {
  if (stat.kind === "choice" || typeof value !== "number") return String(value);
  return statBand(stat, value) ?? `${value}/${stat.max}`;
}
