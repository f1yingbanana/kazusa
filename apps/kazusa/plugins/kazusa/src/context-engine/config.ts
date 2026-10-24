import { z } from "zod";

export const CONTEXT_ENGINE_CONFIG = z.strictObject({
  brainMaxTokens: z.number().int().nonnegative().default(2_000),
  shortTermHours: z.number().min(24).default(24),
});

export type ContextEngineConfig = z.infer<typeof CONTEXT_ENGINE_CONFIG>;
