import { describe, expect, it } from "vitest";
import { StatDefinitionSchema } from "@kazusa/client";
import {
  EMPTY_DRAFT,
  STAT_EXAMPLES,
  fromDraft,
  statsCharactersSee,
  toDraft,
} from "./draft";

describe("state drafts", () => {
  it("every example is a valid state and survives the form", () => {
    for (const { stat } of STAT_EXAMPLES) {
      expect(StatDefinitionSchema.safeParse(stat).success).toBe(true);
      expect(fromDraft(toDraft(stat)).stat).toEqual(stat);
    }
  });

  it("keeps a state of the player", () => {
    const stat = StatDefinitionSchema.parse({
      name: "tired",
      description: "How tired you are.",
      on: "player",
      kind: "choice",
      values: [{ name: "rested" }, { name: "worn out" }],
      initial: "rested",
      changedBy: "manual",
      shown: "everyone",
    });
    expect(fromDraft(toDraft(stat)).stat).toEqual(stat);
    expect(
      fromDraft({ ...toDraft(stat), shown: "self" }).errors,
    ).toHaveProperty("shown");
  });

  it("reads lists a line at a time", () => {
    const { stat } = fromDraft({
      ...EMPTY_DRAFT,
      name: "hp",
      description: "Health.",
      kind: "number",
      min: "0",
      max: "20",
      initial: "20",
      changedBy: "reviewed",
      bands: "weak: 0\n\n ok : 10: Fine: mostly",
      step: "2",
    });
    expect(stat).toMatchObject({
      changedBy: "reviewed",
      bands: [
        { name: "weak", min: 0 },
        { name: "ok", min: 10, description: "Fine: mostly" },
      ],
      step: 2,
    });
  });

  it("keeps colons in what a value means", () => {
    const { stat } = fromDraft({
      ...EMPTY_DRAFT,
      name: "mood",
      description: "Mood.",
      values: "calm: Settled: nothing weighs\ndown",
      initial: "calm",
    });
    expect(stat).toMatchObject({
      values: [
        { name: "calm", description: "Settled: nothing weighs" },
        { name: "down" },
      ],
    });
  });

  it("says what is wrong by field", () => {
    const { errors } = fromDraft(
      { ...EMPTY_DRAFT, name: "Mood", values: "calm", initial: "" },
      new Set(["Mood"]),
    );
    expect(Object.keys(errors ?? {}).sort()).toEqual([
      "description",
      "initial",
      "name",
      "values",
    ]);
    expect(
      fromDraft({
        ...EMPTY_DRAFT,
        kind: "number",
        name: "x",
        description: "y",
        initial: "",
      }).errors,
    ).toHaveProperty("initial");
  });

  it("counts the states that reach a character", () => {
    const [mood] = STAT_EXAMPLES.map(({ stat }) => stat);
    expect(statsCharactersSee(STAT_EXAMPLES.map(({ stat }) => stat))).toBe(5);
    expect(
      statsCharactersSee([
        { ...mood, changedBy: "manual", shown: "nobody" },
        { ...mood, name: "b", changedBy: "character", shown: "nobody" },
      ]),
    ).toBe(1);
  });
});
