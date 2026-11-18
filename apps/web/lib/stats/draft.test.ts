import { describe, expect, it } from "vitest";
import { StatDefinitionSchema } from "@kazusa/client";
import {
  EMPTY_DRAFT,
  STAT_EXAMPLES,
  editConflict,
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

  it("keeps a meaning written over several lines as one, and a step without words", () => {
    const mood = StatDefinitionSchema.parse({
      name: "mood",
      description: "Mood.",
      on: "character",
      kind: "choice",
      values: [
        { name: "calm", description: "Settled.\nNothing weighs on you." },
        { name: "down" },
      ],
      initial: "calm",
      changedBy: "character",
      shown: "self",
    });
    // Never a third value called "Nothing weighs on you.".
    expect(fromDraft(toDraft(mood)).stat).toMatchObject({
      values: [
        { name: "calm", description: "Settled. Nothing weighs on you." },
        { name: "down" },
      ],
    });
    const coins = StatDefinitionSchema.parse({
      name: "coins",
      description: "Coins.",
      on: "character",
      kind: "number",
      min: 0,
      max: 10,
      initial: 5,
      step: 0.5,
      changedBy: "character",
      shown: "self",
    });
    expect(fromDraft(toDraft(coins)).stat).toEqual(coins);
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

  it("sees that the state a form was opened on has changed or gone", () => {
    const [mood, warmth] = STAT_EXAMPLES.map(({ stat }) => stat);
    expect(editConflict([mood, warmth], mood)).toBeUndefined();
    // Someone else's change to another state is not this form's conflict.
    expect(
      editConflict([mood, { ...warmth, description: "Changed." }], mood),
    ).toBeUndefined();
    expect(
      editConflict([{ ...mood, description: "Changed." }, warmth], mood),
    ).toBe("changed");
    expect(editConflict([warmth], mood)).toBe("deleted");
  });
});
