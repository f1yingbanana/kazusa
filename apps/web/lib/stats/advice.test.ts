import { describe, expect, it } from "vitest";
import { StatDefinitionSchema, type StatDefinition } from "@kazusa/client";
import { catalogAdvice, statAdvice } from "./advice";
import { STAT_EXAMPLES } from "./draft";

const trust = (mins: readonly number[], extra: object = {}): StatDefinition =>
  StatDefinitionSchema.parse({
    name: "trust",
    description: "How far you would rely on them.",
    on: "pair",
    kind: "number",
    min: 0,
    max: 40,
    initial: mins[1] ?? 0,
    bands: mins.map((min, index) => ({ name: `band${index}`, min })),
    changedBy: "reviewed",
    shown: "self",
    ...extra,
  });

describe("state advice", () => {
  it("warns when the words of a slow state are close together", () => {
    const [bands] = statAdvice(trust([0, 3, 6, 9]));
    expect(bands).toMatchObject({ field: "bands", tone: "warn" });
    expect(bands?.text).toContain("3 steps apart");
    expect(statAdvice(trust([0, 1, 2]))[0]?.text).toContain("1 step apart");
  });

  it("says how many things it takes when they are far enough apart", () => {
    expect(statAdvice(trust([0, 8, 16, 24]))[0]).toEqual({
      field: "bands",
      tone: "note",
      text: "About 8 things that mattered move it from one word to the next.",
    });
    // A bigger step makes the same bands closer.
    expect(statAdvice(trust([0, 8, 16, 24], { step: 4 }))[0]?.tone).toBe(
      "warn",
    );
  });

  it("steers a slow state away from a list and from a bare number", () => {
    const regard = StatDefinitionSchema.parse({
      name: "regard",
      description: "How you stand toward them.",
      on: "pair",
      kind: "choice",
      values: [{ name: "wary" }, { name: "warm" }],
      initial: "wary",
      changedBy: "reviewed",
      shown: "self",
    });
    expect(statAdvice(regard).map(({ field }) => field)).toEqual([
      "kind",
      "shown",
    ]);
    const bare = StatDefinitionSchema.parse({
      name: "fame",
      description: "How well known you are.",
      on: "character",
      kind: "number",
      min: 0,
      max: 100,
      initial: 0,
      changedBy: "reviewed",
      shown: "nobody",
    });
    expect(statAdvice(bare)).toMatchObject([{ field: "bands", tone: "warn" }]);
  });

  it("says a feeling is a meter, and nothing about a fact", () => {
    expect(statAdvice(trust([0, 8, 16])).at(-1)?.field).toBe("shown");
    expect(statAdvice(trust([0, 8, 16], { shown: "nobody" }))).toHaveLength(1);
    const money = STAT_EXAMPLES.find(({ stat }) => stat.name === "money");
    const chapter = STAT_EXAMPLES.find(({ stat }) => stat.name === "chapter");
    expect(statAdvice(money!.stat)).toEqual([]);
    expect(statAdvice(chapter!.stat)).toEqual([]);
  });

  it("has nothing to warn about in the examples", () => {
    for (const { stat } of STAT_EXAMPLES)
      expect(statAdvice(stat).filter(({ tone }) => tone === "warn")).toEqual(
        [],
      );
  });

  it("points out states toward someone that will move together", () => {
    const regard = { ...trust([0, 8, 16]), name: "regard" };
    expect(catalogAdvice([trust([0, 8, 16])])).toEqual([]);
    expect(catalogAdvice([trust([0, 8, 16]), regard])[0]).toContain(
      "trust and regard are both reviewed toward someone",
    );
    expect(
      catalogAdvice([
        trust([0, 8, 16]),
        regard,
        { ...regard, name: "respect" },
      ])[0],
    ).toContain("trust, regard and respect are all reviewed");
  });
});
