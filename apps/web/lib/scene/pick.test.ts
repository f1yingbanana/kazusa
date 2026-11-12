import { describe, expect, it } from "vitest";
import type {
  BackdropFile,
  BackdropSet,
  Portrait,
  PortraitsResponse,
  TimeOfDay,
} from "@kazusa/client";
import { pickBackdrop, pickPortrait, timesBack } from "./pick";
import type { Look } from "./state";

const TIMES: TimeOfDay[] = [
  { name: "day", from: "06:00" },
  { name: "dusk", from: "17:00" },
  { name: "night", from: "19:00" },
];
/** Sim time on some day at `HH:MM` UTC. */
const at = (time: string): number =>
  Date.UTC(2026, 10, 11) +
  Number(time.slice(0, 2)) * 3_600_000 +
  Number(time.slice(3)) * 60_000;
const file = (name: string): BackdropFile => {
  const [first, ...rest] = name.split("-");
  return {
    name,
    url: `/kazusa/backdrop?set=s&name=${name}`,
    ...(rest.length ? { state: first, time: rest.join("-") } : { time: name }),
  };
};
const set = (...names: string[]): BackdropSet => ({
  files: names.map(file),
  states: { festival: "Festival" },
});

describe("timesBack", () => {
  it.each([
    ["06:00", ["day", "night", "dusk"]],
    ["16:59", ["day", "night", "dusk"]],
    ["17:00", ["dusk", "day", "night"]],
    ["23:59", ["night", "dusk", "day"]],
    // Before the first time of the day, the last one is still running.
    ["03:00", ["night", "dusk", "day"]],
  ])("at %s runs %j", (time, names) => {
    expect(timesBack(TIMES, at(time)).map((t) => t.name)).toEqual(names);
  });

  it("sorts times and handles times before 1970", () => {
    expect(timesBack([...TIMES].reverse(), -60_000).map((t) => t.name)[0]).toBe(
      "night",
    );
  });
});

describe("pickBackdrop", () => {
  it.each<
    [string, BackdropSet, string, string | undefined, string | undefined]
  >([
    [
      "the current time",
      set("day", "dusk", "night"),
      "18:00",
      undefined,
      "dusk",
    ],
    [
      "night past midnight",
      set("day", "dusk", "night"),
      "02:00",
      undefined,
      "night",
    ],
    // Missing dusk: the nearest earlier time it has.
    ["a missing time", set("day", "night"), "18:00", undefined, "day"],
    // Only day and dusk at 02:00: night is missing, dusk is the nearest earlier.
    ["wrapping round the day", set("day", "dusk"), "02:00", undefined, "dusk"],
    ["one picture", set("night"), "12:00", undefined, "night"],
    ["one picture with a state", set("night"), "12:00", "festival", "night"],
    [
      "a state first",
      set("day", "festival-day", "festival-night"),
      "12:00",
      "festival",
      "festival-day",
    ],
    [
      "a state's earlier time over the plain current one",
      set("day", "dusk", "festival-day"),
      "18:00",
      "festival",
      "festival-day",
    ],
    [
      "no picture in that state",
      set("day", "dusk", "festival-day"),
      "18:00",
      "rain",
      "dusk",
    ],
    [
      "no state asked: stateless pictures only",
      set("day", "festival-dusk"),
      "18:00",
      undefined,
      "day",
    ],
    ["names that are not times", set("a", "b"), "18:00", undefined, "a"],
    [
      "only other states",
      set("festival-day", "festival-night"),
      "12:00",
      undefined,
      "festival-day",
    ],
  ])("%s", (_, backdrops, time, state, name) => {
    expect(pickBackdrop(backdrops, TIMES, at(time), state)?.name).toBe(name);
  });

  it("returns nothing for an empty set", () => {
    expect(pickBackdrop({ files: [] }, TIMES, at("12:00"))).toBeUndefined();
  });
});

const portrait = (name: string, outfit?: string): Portrait => ({
  name,
  url: `/kazusa/portrait?id=a&name=${name}`,
  mood: outfit ? name.slice(outfit.length + 1) : name,
  ...(outfit ? { outfit } : {}),
});
const PORTRAITS: PortraitsResponse = {
  portraits: [
    portrait("gym-happy", "gym"),
    portrait("gym-neutral", "gym"),
    portrait("happy"),
    portrait("neutral"),
    portrait("sad-ish"),
    portrait("swim-angry", "swim"),
  ],
  default: "neutral",
  eyeline: 0.1,
};

describe("pickPortrait", () => {
  it.each<[string, Look, string]>([
    ["usual clothes, a mood", { mood: "happy" }, "happy"],
    ["a mood with a dash", { mood: "sad-ish" }, "sad-ish"],
    ["no mood: neutral", {}, "neutral"],
    ["a mood the set lacks: the default", { mood: "furious" }, "neutral"],
    ["an outfit and its mood", { outfit: "gym", mood: "happy" }, "gym-happy"],
    [
      "an outfit without the mood: its neutral",
      { outfit: "gym", mood: "sad-ish" },
      "gym-neutral",
    ],
    [
      "an outfit with no neutral: its first",
      { outfit: "swim", mood: "happy" },
      "swim-angry",
    ],
    ["an outfit the set lacks", { outfit: "coat", mood: "happy" }, "happy"],
  ])("%s", (_, look, name) => {
    expect(pickPortrait(PORTRAITS, look)?.name).toBe(name);
  });

  it("shows no outfit nobody asked for: without a default, nothing", () => {
    expect(
      pickPortrait({ portraits: [portrait("swim-angry", "swim")] }, {}),
    ).toBeUndefined();
    expect(pickPortrait({ portraits: [] }, { mood: "happy" })).toBeUndefined();
  });
});
