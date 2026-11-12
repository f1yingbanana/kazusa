import { describe, expect, it } from "vitest";
import { REVEAL_SHARE, revealFraction, revealTime, revealed } from "./reveal";

const LINE = "one two three four five six seven eight nine ten";
const being = (from: number, until: number, text = LINE) => ({
  text,
  said: { from, until },
});

describe("revealing a line as it is said", () => {
  // 1,000 ms to say; typed out in the first 700.
  it.each([
    [0, ""],
    [350, "one two three four five "],
    [699, "one two three four five six seven eight nine te"],
    [700, LINE],
    [1_000, LINE],
    [5_000, LINE],
    [-100, ""],
  ])("at %i ms of 1,000 shows %j", (at, shown) => {
    expect(revealed(being(0, 1_000), at)).toBe(shown);
  });

  it("is typed out before it has been said, leaving a pause", () => {
    expect(REVEAL_SHARE).toBeLessThan(1);
    expect(revealFraction(being(0, 1_000), 1_000 * REVEAL_SHARE)).toBe(1);
    expect(revealFraction(being(0, 1_000), 500 * REVEAL_SHARE)).toBe(0.5);
  });

  it("shows a committed line, or one shown whole, entire", () => {
    expect(revealed({ ...being(0, 1_000), messageId: "m1" }, 0)).toBe(LINE);
    expect(revealed({ ...being(0, 1_000), whole: true }, 0)).toBe(LINE);
    expect(revealed({ text: LINE }, 0)).toBe(LINE);
    expect(revealFraction({ said: { from: 5, until: 5 } }, 0)).toBe(1);
  });

  it("only ever adds to what it shows", () => {
    for (const text of [
      LINE,
      "Wait, no. Listen!",
      "今日は元気ですか",
      "Tokyo行き、もう?",
    ]) {
      let before = "";
      for (let at = -50; at <= 1_050; at += 7) {
        const shown = revealed(being(0, 1_000, text), at);
        expect(shown.startsWith(before)).toBe(true);
        before = shown;
      }
      expect(before).toBe(text);
    }
  });

  it("follows the clock, a pause freezing it, a speed change carried through", () => {
    const anchor = (speed: number) => ({
      clock: { simTime: 10_000, speed, updatedAt: 1_000 },
      offset: 0,
    });
    // Running at 1x, and at 10x; paused, nothing moves.
    expect(revealTime(anchor(1), 2_000)).toBe(11_000);
    expect(revealTime(anchor(10), 2_000)).toBe(20_000);
    expect(revealTime(anchor(0), 2_000)).toBe(10_000);
    expect(revealTime(anchor(0), 9_000)).toBe(10_000);
    const line = being(10_000, 11_000);
    expect(revealed(line, revealTime(anchor(0), 5_000))).toBe("");
    expect(revealed(line, revealTime(anchor(1), 1_350))).toBe(
      "one two three four five ",
    );
  });
});
