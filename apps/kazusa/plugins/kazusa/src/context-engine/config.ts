import { z } from "zod";

const allowance = (value: number) =>
  z.number().int().min(0).max(32_000).default(value);

export const CONTEXT_ENGINE_CONFIG = z.strictObject({
  /**
   * How far back records reach, in sim hours. 16, not a whole day: live
   * (GLM-5.3-flash, 2026-11-13), a day of verbatim records was 13-16k tokens a
   * turn and characters kept copying yesterday's running bits; 16 hours halved
   * that. Older days come back through memory and `recall`.
   */
  shortTermHours: z.number().min(1).default(16),
  /**
   * Past records in a turn; `recall` is for anything older. `"unlimited"` gives
   * them whatever `maxContextTokens` leaves.
   */
  ledgerMaxTokens: z
    .union([z.number().int().min(0), z.literal("unlimited")])
    .default("unlimited"),
  /**
   * The most one brain call may send, everything included, below the model's
   * own window: OpenClaw allows a model all of it (a million for some).
   */
  maxContextTokens: z
    .union([z.number().int().min(16_000), z.literal("unlimited")])
    .default(64_000),
  /**
   * The records start on this grid of sim hours, so the start moves (and the
   * provider re-reads them) once per step, not every turn.
   */
  ledgerGridHours: z.number().positive().max(24).default(4),
  /**
   * When the records outgrow their budget, they are cut back to this share of
   * it, and keep that start until they outgrow it again.
   */
  ledgerTrimTo: z.number().gt(0).max(1).default(0.75),
  /** Past turns' tool calls and their outcomes; 0 leaves them out. */
  toolHistoryMaxTokens: allowance(600),
  /** The same for the system agent, whose jobs span many calls. */
  systemAgentToolHistoryMaxTokens: allowance(4_000),
  /**
   * The most one attention decision may send. Each part below has its own cap
   * and a share of this; it is a ceiling, not what a decision costs.
   */
  decisionMaxTokens: z.number().int().min(2_000).max(32_000).default(24_000),
  decisionShortTermHours: z.number().positive().default(4),
  /**
   * A character's page: its opening as `identity`, its sections as `soul`.
   * Enough for a whole page (Kivotos: openings under 250 tokens, sections at
   * most about 2,000), so personality and inner voice, at the end, aren't cut.
   */
  decisionIdentityMaxTokens: allowance(1_000),
  decisionSoulMaxTokens: allowance(4_000),
  decisionMemoryMaxTokens: allowance(1_000),
  decisionBrainMaxTokens: allowance(800),
  decisionHistoryMaxTokens: allowance(1_600),
  decisionWikiMaxTokens: allowance(800),
  decisionStimulusMaxTokens: z.number().int().min(32).max(8_000).default(512),
  decisionHistoryItems: z.number().int().min(1).max(200).default(60),
  decisionWikiMaxArticles: z.number().int().min(0).max(20).default(4),
  /**
   * Sim minutes someone can say nothing in a conversation in person before the
   * attention decision asks whether they still follow it.
   */
  decisionQuietMinutes: z.number().positive().default(10),
  skills: z
    .object({
      conventions: z.string().default("context-conventions"),
      lifecycle: z.string().default("task-lifecycle"),
      interrupt: z.string().default("task-interrupt"),
      inPerson: z.string().default("in-person"),
      /** The system agent's conventions, in place of a character's. */
      director: z.string().default("director-conventions"),
    })
    .default({
      conventions: "context-conventions",
      lifecycle: "task-lifecycle",
      interrupt: "task-interrupt",
      inPerson: "in-person",
      director: "director-conventions",
    }),
});

export type ContextEngineConfig = z.infer<typeof CONTEXT_ENGINE_CONFIG>;
