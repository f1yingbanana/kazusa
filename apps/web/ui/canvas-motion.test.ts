import { describe, expect, it } from "vitest";
import { flight, glide } from "./canvas-motion";

describe("flight", () => {
  const from = { cx: 0, cy: 0, zoom: 1 };
  const to = { cx: 4000, cy: 0, zoom: 1.5 };

  it("starts where the camera is and lands on the target", () => {
    const motion = flight(from, to, 1000);
    const start = motion.at(0);
    expect(start.cx).toBeCloseTo(0);
    expect(start.zoom).toBeCloseTo(1);
    expect(motion.at(motion.duration)).toEqual(to);
  });

  it("rises over a long distance so both ends are in sight", () => {
    const motion = flight(from, to, 1000);
    const middle = motion.at(motion.duration / 2);
    expect(middle.zoom).toBeLessThan(0.5);
    expect(middle.cx).toBeGreaterThan(0);
    expect(middle.cx).toBeLessThan(4000);
  });

  it("zooms in place when only the zoom changes", () => {
    const motion = flight(from, { cx: 0, cy: 0, zoom: 4 }, 1000);
    expect(motion.at(motion.duration / 2).cx).toBeCloseTo(0);
    expect(motion.at(motion.duration).zoom).toBe(4);
  });

  it("keeps short and long trips within a readable length", () => {
    expect(
      flight(from, { cx: 1, cy: 0, zoom: 1 }, 1000).duration,
    ).toBeGreaterThanOrEqual(420);
    expect(
      flight(from, { cx: 1e7, cy: 0, zoom: 1 }, 1000).duration,
    ).toBeLessThanOrEqual(1250);
  });
});

describe("glide", () => {
  it("settles on the target without overshooting", () => {
    const to = { cx: 100, cy: -50, zoom: 2 };
    const motion = glide({ cx: 0, cy: 0, zoom: 1 }, to);
    expect(motion.at(0).cx).toBeCloseTo(0);
    let furthest = 0;
    for (let t = 0; t <= motion.duration; t += 16)
      furthest = Math.max(furthest, motion.at(t).cx);
    expect(furthest).toBeLessThanOrEqual(100.0001);
    const end = motion.at(motion.duration);
    expect(end.cx).toBeCloseTo(100, 0);
    expect(end.zoom).toBeCloseTo(2, 1);
  });
});
