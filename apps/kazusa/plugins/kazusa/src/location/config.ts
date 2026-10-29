import { z } from "zod";
import { sharedDir } from "../shared-dir.ts";

/** `plugins.entries.kazusa.config.location`. */
export const LOCATION_CONFIG = z.strictObject({
  /** World Wiki root holding `entities/places` and `entities/characters`. */
  wikiDir: z.string().min(1).default(sharedDir("wiki")),
  /** Task categories that move the character to their `where`. */
  travelCategories: z.array(z.string().min(1)).min(1).default(["traveling"]),
  /** Places listed in `Around you`, and again in `Places you know`. */
  listLimit: z.number().int().min(0).max(50).default(8),
  /** What each likelihood word means as a probability, for rolls. */
  likelihood: z
    .strictObject({
      certain: z.number().min(0).max(1),
      likely: z.number().min(0).max(1),
      even: z.number().min(0).max(1),
      unlikely: z.number().min(0).max(1),
      "no chance": z.number().min(0).max(1),
    })
    .default({
      certain: 1,
      likely: 0.8,
      even: 0.5,
      unlikely: 0.15,
      "no chance": 0,
    }),
  /**
   * Per judgment, the word used when the decision model is unavailable.
   * Noticing defaults to `unlikely`, so an outage never floods anyone.
   */
  fallbackLikelihood: z
    .record(
      z.string(),
      z.enum(["certain", "likely", "even", "unlikely", "no chance"]),
    )
    .default({ notice: "unlikely" }),
  /** Two people passing the same place this close in time can cross paths. */
  passWindowMinutes: z.number().min(0).default(2),
  judgmentTimeoutMs: z.number().int().positive().default(10_000),
});

export type LocationConfig = z.infer<typeof LOCATION_CONFIG>;

export const USER = z.object({
  id: z
    .string()
    .regex(/^user:[a-z0-9][a-z0-9_-]*$/)
    .default("user:sensei"),
  name: z.string().trim().min(1).default("Sensei"),
});
