import { describe, expect, it } from "vitest";
import type { StatsResponse } from "@kazusa/client";
import { afterStatCatalog, afterStatSet, withStatsEvent } from "./http";

const entry = (value: number) => ({ value, at: 1, by: "user" as const });
const hp = (value: number) => ({ own: { hp: entry(value) }, toward: {} });
const snapshot = (
  records: StatsResponse["records"] = {},
  revision = "r1",
): StatsResponse => ({
  catalog: [],
  revision,
  records,
  world: {},
  outfits: {},
});

describe("a set's response", () => {
  it("brings the subject's record and nothing else", () => {
    const before = snapshot({ airi: hp(1), natsu: hp(1) });
    const response = snapshot({ airi: hp(3), natsu: hp(0) });
    const after = afterStatSet(before, before, response, {
      characterId: "airi",
    });
    expect(after.reread).toBe(false);
    expect(after.data.records).toEqual({ airi: hp(3), natsu: hp(1) });
  });

  it("is not put over a newer value the stream brought meanwhile", () => {
    const before = snapshot({ airi: hp(1) });
    const current = withStatsEvent(before, {
      type: "stats",
      characterId: "airi",
      record: hp(7),
    });
    const after = afterStatSet(before, current, snapshot({ airi: hp(3) }), {
      characterId: "airi",
    });
    expect(after.data.records.airi).toEqual(hp(7));
    expect(after.reread).toBe(true);
  });

  it("asks for nothing when the stream brought the same already", () => {
    const before = snapshot({ airi: hp(1) });
    const current = withStatsEvent(before, {
      type: "stats",
      characterId: "airi",
      record: hp(3),
    });
    const after = afterStatSet(before, current, snapshot({ airi: hp(3) }), {
      characterId: "airi",
    });
    expect(after).toEqual({ data: current, reread: false });
  });

  it("still lands when the stream changed someone else", () => {
    const before = snapshot({ airi: hp(1), natsu: hp(1) });
    const current = withStatsEvent(before, {
      type: "stats",
      characterId: "natsu",
      record: hp(9),
    });
    const after = afterStatSet(before, current, snapshot({ airi: hp(3) }), {
      characterId: "airi",
    });
    expect(after.reread).toBe(false);
    expect(after.data.records).toEqual({ airi: hp(3), natsu: hp(9) });
  });

  it("is the snapshot when there was none", () => {
    const response = snapshot({ airi: hp(3) });
    expect(
      afterStatSet(undefined, undefined, response, { characterId: "airi" }),
    ).toEqual({ data: response, reread: false });
  });
});

describe("a save's response", () => {
  it("brings the definitions and their revision, and leaves records", () => {
    const before = snapshot({ airi: hp(1) });
    const after = afterStatCatalog(before, before, snapshot({}, "r2"));
    expect(after.reread).toBe(false);
    expect(after.data.revision).toBe("r2");
    expect(after.data.records).toEqual({ airi: hp(1) });
  });

  it("is not put over definitions read again meanwhile", () => {
    const before = snapshot();
    const later: StatsResponse = {
      ...snapshot({}, "r3"),
      catalog: [
        {
          name: "mood",
          description: "How they feel.",
          on: "character",
          kind: "choice",
          changedBy: "character",
          shown: "self",
          values: [{ name: "calm" }],
          initial: "calm",
        },
      ],
    };
    const after = afterStatCatalog(before, later, snapshot({}, "r2"));
    expect(after.data.revision).toBe("r3");
    expect(after.reread).toBe(true);
  });
});
