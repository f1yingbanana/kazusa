import { describe, expect, it } from "vitest";
import {
  HOUR,
  MINUTE,
  bucket,
  dayPhase,
  formatSimDuration,
  formatSimTime,
  progress,
  simTimeAt,
} from "./sim";

const anchor = { simTime: Date.UTC(2026, 3, 14, 14, 0), speed: 60, updatedAt: 1_000 };

describe("sim clock interpolation", () => {
  it("advances by elapsed wall time times speed", () => {
    expect(simTimeAt(anchor, 1_000 + 1_000)).toBe(anchor.simTime + 60_000);
  });
  it("holds still when paused, whatever the wall clock does", () => {
    expect(simTimeAt({ ...anchor, speed: 0 }, 10_000_000)).toBe(anchor.simTime);
  });
  it("applies the server offset and never runs backwards before the anchor", () => {
    expect(simTimeAt(anchor, 500, 1_500)).toBe(anchor.simTime + 60_000);
    expect(simTimeAt(anchor, 0)).toBe(anchor.simTime);
  });
});

describe("formatting", () => {
  it("formats UTC wall time and durations in sim minutes", () => {
    expect(formatSimTime(Date.UTC(2026, 3, 14, 9, 5))).toBe("09:05");
    expect(formatSimDuration(34 * MINUTE + 59_000)).toBe("34m");
    expect(formatSimDuration(80 * MINUTE)).toBe("1h 20m");
    expect(formatSimDuration(27 * HOUR)).toBe("1d 3h");
  });
  it("labels day phases", () => {
    expect([4, 5, 12, 17, 22].map(dayPhase)).toEqual([
      "Night",
      "Morning",
      "Afternoon",
      "Evening",
      "Night",
    ]);
  });
  it("buckets and clamps progress", () => {
    expect(bucket(125_000, MINUTE)).toBe(120_000);
    expect(progress(0, 100, 50)).toBe(0.5);
    expect(progress(0, 100, 500)).toBe(1);
    expect(progress(10, 10, 0)).toBe(1);
  });
});
