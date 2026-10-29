import { z } from "zod";

const allowance = (value: number) =>
  z.number().int().min(0).max(32_000).default(value);

export const CONTEXT_ENGINE_CONFIG = z.strictObject({
  brainMaxTokens: z.number().int().nonnegative().default(2_000),
  shortTermHours: z.number().min(24).default(24),
  personalWikiMaxTokens: allowance(1_200),
  personalWikiMaxArticles: z.number().int().min(0).max(20).default(3),
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
