import { z } from "zod";

const allowance = (value: number) =>
  z.number().int().min(0).max(32_000).default(value);

export const CONTEXT_ENGINE_CONFIG = z.strictObject({
  shortTermHours: z.number().min(1).default(24),
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
  decisionMaxTokens: z.number().int().min(2_000).max(32_000).default(8_000),
  decisionShortTermHours: z.number().positive().default(4),
  decisionIdentityMaxTokens: allowance(600),
  decisionSoulMaxTokens: allowance(1_000),
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
    })
    .default({
      conventions: "context-conventions",
      lifecycle: "task-lifecycle",
      interrupt: "task-interrupt",
      inPerson: "in-person",
    }),
});

export type ContextEngineConfig = z.infer<typeof CONTEXT_ENGINE_CONFIG>;
