import { z } from "zod";

/** `plugins.entries.kazusa.config.memory`. */
export const MEMORY_CONFIG = z.strictObject({
  wikiDir: z.string().min(1).optional(),
  /** `On your mind`, the recollections each turn brings up. */
  maxTokens: z.number().int().min(0).max(32_000).default(800),
  /** `People you know`. */
  rosterLimit: z.number().int().min(0).max(200).default(20),
  /**
   * How familiarity (`familiarity.ts`) ranks `People you know` and `Places you
   * know`: ACT-R's decay, uses kept exactly, and the episode within which
   * contact counts once (a day: what you do every day, not every hour).
   */
  familiarity: z
    .strictObject({
      decay: z.number().gt(0).lt(1).default(0.5),
      recent: z.number().int().min(1).max(32).default(4),
      episodeHours: z.number().min(0).default(24),
    })
    .prefault({}),
  /** Which card fields place a character in this world, and how deeply. */
  anchors: z
    .record(z.string(), z.enum(["heard of", "familiar", "intimate"]))
    .default({ club: "intimate", school: "familiar" }),
  /**
   * Offline consolidation. Off until a world turns it on: it sends a day's
   * records and the character's pages to the model.
   */
  sleep: z
    .strictObject({
      enabled: z.boolean().default(false),
      categories: z.array(z.string()).default(["sleeping"]),
      minMinutes: z.number().int().min(0).default(180),
      notesPerPage: z.number().int().min(1).default(30),
    })
    .default({
      enabled: false,
      categories: ["sleeping"],
      minMinutes: 180,
      notesPerPage: 30,
    }),
  /**
   * Your own OpenAI-compatible endpoint, run before `models.embedding` while
   * its key works; one of `EMBEDDING_MODELS` here is only one more choice. The
   * key is that model provider's, wherever OpenClaw keeps it (auth profile,
   * environment or config). No key means keywords only.
   */
  embedding: z
    .strictObject({
      baseUrl: z.string().default("https://openrouter.ai/api/v1"),
      provider: z.string().default("openrouter"),
      model: z.string().default("openai/text-embedding-3-small"),
    })
    .prefault({}),
});
