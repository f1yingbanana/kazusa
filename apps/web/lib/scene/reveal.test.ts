import { describe, expect, it } from "vitest";
import { heardOf } from "@kazusa/client";
import { REVEAL_LAG_MS, revealFraction, revealTime, revealed } from "./reveal";

const LINE = "one two three four five six seven eight nine ten";
const being = (from: number, until: number, text = LINE) => ({
  text,
  said: { from, until },
});

describe("revealing a line as it is said", () => {
  it.each([
    [0, ""],
    [500, "one two three four five "],
    [999, "one two three four five six seven eight nine te"],
    [1_000, LINE],
    [5_000, LINE],
    [-100, ""],
  ])("at %i ms of 1,000 shows %j", (at, shown) => {
    expect(revealed(being(0, 1_000), at)).toBe(shown);
  });

  it("shows a committed line, or one shown whole, entire", () => {
    expect(revealed({ ...being(0, 1_000), messageId: "m1" }, 0)).toBe(LINE);
    expect(revealed({ ...being(0, 1_000), whole: true }, 0)).toBe(LINE);
    expect(revealed({ text: LINE }, 0)).toBe(LINE);
    expect(revealFraction({ said: { from: 5, until: 5 } }, 0)).toBe(1);
  });

  it("is never ahead of what a cut at that moment keeps by more than a word", () => {
    for (const text of [
      LINE,
      "Wait, no. Listen!",
      "今日は元気ですか",
      "Tokyo行き、もう?",
    ])
      for (let at = -50; at <= 1_050; at += 7) {
        const heard = heardOf(text, at / 1_000);
        // The client is REVEAL_LAG_MS behind, and any further behind.
        for (const late of [0, REVEAL_LAG_MS, 400]) {
          const shown = revealed(being(0, 1_000, text), at - late);
          expect(text.startsWith(shown)).toBe(true);
          // Behind what was heard, the rest is empty.
          expect(
            (shown.slice(heard.length).match(/[\p{L}\p{N}]+/gu) ?? []).length,
          ).toBeLessThanOrEqual(1);
        }
      }
  });

  it("follows the clock, a pause freezing it, a speed change carried through", () => {
    const anchor = (speed: number) => ({
      clock: { simTime: 10_000, speed, updatedAt: 1_000 },
      offset: 0,
    });
    // Running at 1x: the lag behind the clock.
    expect(revealTime(anchor(1), 2_000)).toBe(10_000 + 1_000 - REVEAL_LAG_MS);
    // At 10x the lag is ten times as much sim time; paused, nothing moves.
    expect(revealTime(anchor(10), 2_000)).toBe(
      10_000 + 10 * (1_000 - REVEAL_LAG_MS),
    );
    expect(revealTime(anchor(0), 2_000)).toBe(10_000);
    expect(revealTime(anchor(0), 9_000)).toBe(10_000);
    // Never before the moment the clock was last set.
    expect(revealTime(anchor(1), 1_050)).toBe(10_000);
    const line = being(10_000, 11_000);
    expect(revealed(line, revealTime(anchor(0), 5_000))).toBe("");
    expect(revealed(line, revealTime(anchor(1), 1_650))).toBe(
      "one two three four five ",
    );
  });
});
