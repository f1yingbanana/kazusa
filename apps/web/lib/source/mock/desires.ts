import type { DesireRecord, DesiresConfig, TaskSummary } from "@kazusa/client";
import { startEffects } from "../../time/desires";
import type { Rng } from "./world";

/**
 * The plugin's default catalog (`src/desires/config.ts`), abridged
 * descriptions.
 */
export const MOCK_DESIRES_CONFIG: DesiresConfig = {
  states: [
    { name: "depleted", min: 0, level: 10 },
    { name: "low", min: 25, level: 35 },
    { name: "fine", min: 50, level: 65 },
    { name: "full", min: 80, level: 100 },
  ],
  initial: "fine",
  catalog: [
    {
      name: "energy",
      drain: 4,
      description: "Physical and mental wakefulness.",
    },
    {
      name: "satiety",
      drain: 8,
      description: "Hunger and the pleasure of food.",
    },
    { name: "social", drain: 2, description: "Your social battery." },
    { name: "stimulation", drain: 4, description: "Fun and novelty." },
    {
      name: "composure",
      drain: 2,
      description: "Calm, comfort and cleanliness.",
    },
    {
      name: "purpose",
      drain: 2,
      description: "Feeling useful and making progress.",
    },
    {
      name: "expression",
      drain: 2,
      description: "Having made or voiced what is inside you.",
    },
  ],
};

/*
 * Stand-in for the `afterwards` a character would declare. Concept data only:
 * the real effects come from the brain's own tool call, never from categories.
 */
const MOCK_AFTERWARDS: Record<string, Record<string, string>> = {
  sleeping: { energy: "full", composure: "fine" },
  eating: { satiety: "full" },
  socializing: { social: "full", expression: "fine" },
  "having fun": { stimulation: "full", composure: "fine" },
  studying: { purpose: "fine", energy: "low" },
  working: { purpose: "full", energy: "low" },
  traveling: {},
  miscellaneous: { composure: "fine" },
};

export function mockDesireRecord(
  rng: Rng,
  previous: DesireRecord | undefined,
  task: TaskSummary,
  at: number,
): DesireRecord {
  const seeded: DesireRecord = previous ?? {
    anchorAt: at,
    levels: Object.fromEntries(
      MOCK_DESIRES_CONFIG.catalog.map(({ name }) => [name, 15 + rng() * 80]),
    ),
    drain: {},
  };
  return startEffects(
    MOCK_DESIRES_CONFIG,
    seeded,
    { id: task.id, at, until: task.endAt },
    MOCK_AFTERWARDS[task.type] ?? {},
  );
}
