import { describe, expect, it } from "vitest";
import { SCENE_CONFIG } from "./config.ts";

describe("scene config", () => {
  it("has day, dusk and night by default", () => {
    expect(SCENE_CONFIG.parse({}).times).toEqual([
      { name: "day", from: "06:00" },
      { name: "dusk", from: "17:00" },
      { name: "night", from: "19:00" },
    ]);
  });

  it("sorts a world's own times by when they start", () => {
    expect(
      SCENE_CONFIG.parse({
        times: [
          { name: "late-night", from: "23:30" },
          { name: "morning", from: "05:00" },
          { name: "noon", from: "12:00" },
        ],
      }).times.map(({ name }) => name),
    ).toEqual(["morning", "noon", "late-night"]);
  });

  it.each([
    ["no times", { times: [] }],
    [
      "a name twice",
      {
        times: [
          { name: "day", from: "06:00" },
          { name: "day", from: "18:00" },
        ],
      },
    ],
    [
      "a start twice",
      {
        times: [
          { name: "day", from: "06:00" },
          { name: "dawn", from: "06:00" },
        ],
      },
    ],
    ["an hour past 23", { times: [{ name: "day", from: "24:00" }] }],
    ["a one-digit hour", { times: [{ name: "day", from: "6:00" }] }],
    ["a name with capitals", { times: [{ name: "Day", from: "06:00" }] }],
    ["an unknown key", { times: [], other: true }],
  ])("refuses %s", (_case, config) => {
    expect(SCENE_CONFIG.safeParse(config).success).toBe(false);
  });
});
