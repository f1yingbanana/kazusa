import { z } from "zod";

/** Desire and state names are shown to the LLM and used as JSON keys. */
const NAME = z.string().regex(/^[a-z][a-z0-9_]*$/u);
const LEVEL = z.number().finite().min(0).max(100);

const DEFAULT_STATES = [
  { name: "depleted", min: 0, level: 10 },
  { name: "low", min: 25, level: 35 },
  { name: "fine", min: 50, level: 65 },
  { name: "full", min: 80, level: 100 },
];

const DEFAULT_CATALOG = [
  {
    name: "energy",
    drain: 4,
    description:
      "Physical and mental wakefulness. Full is wide awake; depleted is barely keeping your eyes open.",
  },
  {
    name: "satiety",
    drain: 8,
    description:
      "Hunger and the pleasure of food. Full is well fed; depleted is starving.",
  },
  {
    name: "social",
    drain: 2,
    description:
      "Your social battery. Full is having had the right amount of people for who you are; depleted is lonely, or worn out by others.",
  },
  {
    name: "stimulation",
    drain: 4,
    description:
      "Fun and novelty. Full is engaged and entertained; depleted is bored stiff and restless.",
  },
  {
    name: "composure",
    drain: 2,
    description:
      "Calm, comfort and cleanliness. Full is relaxed and refreshed; depleted is frazzled, stressed or grimy.",
  },
  {
    name: "purpose",
    drain: 2,
    description:
      "Feeling useful and making progress. Full is accomplished; depleted is adrift or guilty about slacking.",
  },
  {
    name: "expression",
    drain: 2,
    description:
      "Having made or voiced what is inside you. Full is creatively spent; depleted is pent up and itching to create or say something.",
  },
];

/** World desire catalog and the level-to-state mapping shown to the LLM. */
export const DESIRES_CONFIG = z
  .object({
    /** Ascending; a level is in the last state whose `min` it reaches. */
    states: z
      .array(z.object({ name: NAME, min: LEVEL, level: LEVEL }))
      .min(2)
      .default(DEFAULT_STATES),
    /** State an unseen desire starts in. */
    initial: NAME.default("fine"),
    catalog: z
      .array(
        z.object({
          name: NAME,
          description: z.string().trim().min(1),
          /** Points lost per simulated hour. */
          drain: z.number().finite().nonnegative(),
        }),
      )
      .min(1)
      .default(DEFAULT_CATALOG),
  })
  .superRefine((config, ctx) => {
    const { states, catalog } = config;
    if (states[0]?.min !== 0) {
      ctx.addIssue({
        code: "custom",
        path: ["states", 0, "min"],
        message: "the first state must start at 0",
      });
    }
    states.forEach((state, index) => {
      const next = states[index + 1];
      if (next && next.min <= state.min) {
        ctx.addIssue({
          code: "custom",
          path: ["states", index + 1, "min"],
          message: "state minimums must be strictly ascending",
        });
      }
      if (state.level < state.min || (next && state.level >= next.min)) {
        ctx.addIssue({
          code: "custom",
          path: ["states", index, "level"],
          message: "a state's level must fall inside that state",
        });
      }
    });
    if (!states.some(({ name }) => name === config.initial)) {
      ctx.addIssue({
        code: "custom",
        path: ["initial"],
        message: "initial must name a configured state",
      });
    }
    for (const [path, names] of [
      ["states", states.map(({ name }) => name)],
      ["catalog", catalog.map(({ name }) => name)],
    ] as const) {
      if (new Set(names).size !== names.length) {
        ctx.addIssue({
          code: "custom",
          path: [path],
          message: "names must be unique",
        });
      }
    }
  });

export type DesiresConfig = z.infer<typeof DESIRES_CONFIG>;
