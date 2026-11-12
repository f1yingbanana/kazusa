import { z } from "zod";
import { PICTURE_NAME } from "../pictures.ts";

/** `HH:MM`, 24-hour, in sim time (UTC). */
const CLOCK_TIME = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/u);

const DEFAULT_TIMES = [
  { name: "day", from: "06:00" },
  { name: "dusk", from: "17:00" },
  { name: "night", from: "19:00" },
];

/** `plugins.entries.kazusa.config.scene`. */
export const SCENE_CONFIG = z.strictObject({
  /**
   * The world's times of day, each from its start until the next one's, the
   * last running past midnight to the first. A backdrop picture is named for
   * one. Sorted by `from` here, whatever order the config lists them in.
   */
  times: z
    .array(z.strictObject({ name: PICTURE_NAME, from: CLOCK_TIME }))
    .min(1)
    .superRefine((times, ctx) => {
      for (const key of ["name", "from"] as const) {
        const values = times.map((time) => time[key]);
        if (new Set(values).size !== values.length)
          ctx.addIssue({
            code: "custom",
            message: `each time of day needs its own ${key}`,
          });
      }
    })
    .transform((times) =>
      [...times].sort((a, b) => a.from.localeCompare(b.from)),
    )
    .default(DEFAULT_TIMES),
});

export type SceneConfig = z.infer<typeof SCENE_CONFIG>;
