import { z } from "zod";
export { STIMULUS, type Stimulus } from "../stimulus.ts";

export const PERCEPTION_CONFIG = z.object({
  coalesceWindowMs: z.number().int().min(0).max(5000).default(500),
  maxBatchSize: z.number().int().min(1).max(100).default(16),
  maxBatchChars: z.number().int().min(32_000).max(256_000).default(48_000),
  decisionTimeoutMs: z.number().int().min(1).max(30_000).default(10_000),
});
export type PerceptionConfig = z.infer<typeof PERCEPTION_CONFIG>;
export type AttentionAction = "STEER" | "QUEUE_NEXT" | "IGNORE";
