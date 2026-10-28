import { describe, expect, it } from "vitest";
import type { DesireRecord } from "@kazusa/client";
import { MOCK_DESIRES_CONFIG as config } from "../source/mock/desires";
import {
  desireLabel,
  levelsAt,
  nextDrop,
  startEffects,
  stateOf,
  trendOf,
} from "./desires";
import { MINUTE } from "./sim";

const T0 = Date.parse("2026-10-27T08:00:00.000Z");
const minutes = (n: number) => T0 + n * MINUTE;
const desire = (name: string) => config.catalog.find((d) => d.name === name)!;

function fresh(levels: Record<string, number> = {}): DesireRecord {
  const record = startEffects(
    config,
    undefined,
    { id: "t0", at: T0, until: T0 },
    {},
  );
  return { ...record, levels: { ...record.levels, ...levels } };
}

describe("desire levels (mirrors the plugin's closed form)", () => {
  it("holds the initial state until the first record, then drains", () => {
    expect(levelsAt(config, undefined, minutes(600)).satiety).toBe(65);
    const record = fresh();
    expect(levelsAt(config, record, minutes(300)).satiety).toBe(25);
    expect(levelsAt(config, record, minutes(1200)).satiety).toBe(0);
  });

  it("uses per-character drain overrides", () => {
    const record = { ...fresh(), drain: { satiety: 1 } };
    expect(levelsAt(config, record, minutes(60)).satiety).toBe(64);
  });

  it("moves toward the target by the planned end, then drains", () => {
    const record = startEffects(
      config,
      fresh({ satiety: 25 }),
      { id: "meal", at: T0, until: minutes(30) },
      { satiety: "full" },
    );
    expect(levelsAt(config, record, minutes(15)).satiety).toBe(62.5);
    expect(levelsAt(config, record, minutes(30)).satiety).toBe(100);
    expect(levelsAt(config, record, minutes(90)).satiety).toBe(92);
    expect(levelsAt(config, record, minutes(30)).energy).toBe(63);
  });

  it("treats a target in the current state as no change", () => {
    const record = startEffects(
      config,
      fresh({ energy: 30 }),
      { id: "late", at: T0, until: minutes(60) },
      { energy: "low" },
    );
    expect(record.effects).toBeUndefined();
  });

  it("maps levels to states", () => {
    expect(stateOf(config, 0)).toBe("depleted");
    expect(stateOf(config, 25)).toBe("low");
    expect(stateOf(config, 79.9)).toBe("fine");
    expect(stateOf(config, 100)).toBe("full");
  });
});

describe("desire trends and forecast", () => {
  it("reports where the current task is moving a desire", () => {
    const record = startEffects(
      config,
      fresh({ satiety: 25 }),
      { id: "meal", at: T0, until: minutes(30) },
      { satiety: "full" },
    );
    const trend = trendOf(config, record, desire("satiety"), minutes(10));
    expect(trend).toMatchObject({
      direction: "up",
      targetState: "full",
      target: 100,
    });
    expect(trend?.reachesAt).toBeCloseTo(minutes(30), -1);
    expect(
      trendOf(config, record, desire("satiety"), minutes(30)),
    ).toBeUndefined();
    expect(
      trendOf(config, record, desire("energy"), minutes(10)),
    ).toBeUndefined();
  });

  it("forecasts the soonest drop, skipping desires being raised", () => {
    // satiety 65 drains 8/h and crosses 50 (fine → low) after 1h52.5m.
    const record = fresh();
    expect(nextDrop(config, record, T0)).toEqual({
      desire: "satiety",
      state: "low",
      at: minutes(112.5),
    });
    const eating = startEffects(
      config,
      record,
      { id: "meal", at: T0, until: minutes(30) },
      { satiety: "full" },
    );
    // Energy (4/h from 65) is next: 15 points → 3h45m.
    expect(nextDrop(config, eating, T0)?.desire).toBe("energy");
    expect(nextDrop(config, eating, T0)?.at).toBe(minutes(225));
  });

  it("has nothing to forecast in the lowest state or without a record", () => {
    const record = fresh(
      Object.fromEntries(config.catalog.map(({ name }) => [name, 5])),
    );
    expect(nextDrop(config, record, T0)).toBeUndefined();
    expect(nextDrop(config, undefined, T0)).toBeUndefined();
  });

  it("prettifies catalog names", () => {
    expect(desireLabel("inner_peace")).toBe("Inner peace");
  });
});
