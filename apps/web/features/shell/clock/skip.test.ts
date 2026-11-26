import type { CharacterStatus, CharacterSummary } from "@kazusa/client";
import { describe, expect, it } from "vitest";
import { HOUR, MINUTE } from "@/lib/time/sim";
import {
  formatSkip,
  isLargeSkip,
  landingOf,
  minutesTo,
  nextEvent,
  speedCaution,
  speedLine,
  wakersBetween,
} from "./skip";

const NOON = Date.UTC(2026, 10, 20, 12, 0);

const person = (id: string): CharacterSummary =>
  ({ id, name: id.toUpperCase(), kind: "agent" }) as CharacterSummary;

const busy = (
  endAt: number,
  extra: Partial<CharacterStatus> = {},
): CharacterStatus => ({
  brain: "idle",
  composingIn: [],
  queued: 0,
  onstage: true,
  task: {
    id: "t",
    type: "work",
    description: "Paperwork",
    startedAt: NOON - HOUR,
    endAt,
  },
  ...extra,
});

describe("skipping ahead", () => {
  const cast = ["hina", "aru", "iori", "mika"].map(person);
  const statuses = new Map<string, CharacterStatus>([
    ["hina", busy(NOON + 30 * MINUTE)],
    ["aru", busy(NOON + 2 * HOUR)],
    // Played by someone: their plans are the player's, nobody wakes.
    ["iori", busy(NOON + 10 * MINUTE, { playedBy: "user:me" })],
    // Offstage: not simulated at all.
    ["mika", busy(NOON + 5 * MINUTE, { onstage: false })],
  ]);

  it("wakes only onstage characters thinking for themselves, soonest first", () => {
    expect(
      wakersBetween(cast, statuses, NOON, NOON + 3 * HOUR).map((w) => w.id),
    ).toEqual(["hina", "aru"]);
    expect(wakersBetween(cast, statuses, NOON, NOON + 20 * MINUTE)).toEqual([]);
  });

  it("lands just after the next plan ends", () => {
    const next = nextEvent(cast, statuses, NOON);
    expect(next?.id).toBe("hina");
    expect(landingOf({ by: "next" }, NOON, next)).toBe(NOON + 31 * MINUTE);
    expect(landingOf({ by: "next" }, NOON, undefined)).toBeUndefined();
  });

  it("lands at a time of day, tomorrow once it's past", () => {
    expect(landingOf({ by: "time", time: "18:30" }, NOON, undefined)).toBe(
      NOON + 6.5 * HOUR,
    );
    expect(landingOf({ by: "time", time: "09:00" }, NOON, undefined)).toBe(
      NOON + 21 * HOUR,
    );
    expect(landingOf({ by: "time", time: "12:00" }, NOON, undefined)).toBe(
      NOON + 24 * HOUR,
    );
  });

  it("counts whole minutes and says them short", () => {
    expect(minutesTo(NOON + 90_500, NOON)).toBe(2);
    expect(formatSkip(45)).toBe("45 min");
    expect(formatSkip(60)).toBe("1 hour");
    expect(formatSkip(150)).toBe("2 h 30 min");
  });

  it("asks first when it's long or wakes many", () => {
    expect(isLargeSkip(60, 2)).toBe(false);
    expect(isLargeSkip(180, 0)).toBe(true);
    expect(isLargeSkip(15, 5)).toBe(true);
  });
});

describe("speeds in plain words", () => {
  it("says how long an hour takes", () => {
    expect(speedLine(0)).toMatch(/stands still/);
    expect(speedLine(1)).toMatch(/an hour here takes an hour/);
    expect(speedLine(10)).toBe("An hour here takes 6 minutes.");
    expect(speedLine(60)).toBe("An hour here takes 1 minute.");
  });

  it("warns that thinking takes their time at high speeds", () => {
    expect(speedCaution(5)).toBeNull();
    expect(speedCaution(60)).toMatch(/30 minutes of their day/);
  });
});
