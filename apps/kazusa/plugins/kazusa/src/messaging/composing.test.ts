import { describe, expect, it } from "vitest";
import { composingMs, cutOff, paceAt } from "./composing.ts";

describe("speaking time and cut-off lines", () => {
  it("takes each writing system's characters at its own rate, with no cap", () => {
    // Twelve letters a second: spaces and punctuation take no time.
    expect(composingMs("Hello, there! How are you?", "speaking")).toBe(1_583);
    expect(composingMs("word ".repeat(150), "speaking")).toBe(50_000);
    // A whole sentence with no spaces is not one word.
    expect(composingMs("今日は元気ですか", "speaking")).toBe(1_300);
    expect(composingMs("안녕하세요", "speaking")).toBe(714);
    expect(composingMs("…", "speaking")).toBe(300);
  });

  it("is said faster or slower at the speaker's pace", () => {
    const line = "Hello, there! How are you?";
    expect(composingMs(line, "speaking", undefined, 1.25)).toBe(1_267);
    expect(composingMs(line, "speaking", undefined, 0.5)).toBe(3_167);
  });

  it("reads a judged score between the pace anchors, as a ratio", () => {
    const anchors = [0.6, 0.8, 1, 1.25, 1.6];
    expect(paceAt(2, anchors)).toBe(1);
    expect(paceAt(4, anchors)).toBeCloseTo(1.6);
    expect(paceAt(2.5, anchors)).toBeCloseTo(Math.sqrt(1.25));
    expect(paceAt(9, anchors)).toBeCloseTo(1.6);
    expect(paceAt(Number.NaN, anchors)).toBe(1);
    expect(paceAt(3, [])).toBe(1);
  });

  it("is heard up to where it got, a spaced word whole or not at all", () => {
    expect(cutOff("I told you not to go there", 0.5)).toBe("I told you—");
    expect(cutOff("Wait, no. Listen", 0.67)).toBe("Wait, no—");
    expect(cutOff("Listen to me", 0.1)).toBe("");
    expect(cutOff("Listen to me", 1)).toBe("Listen to me");
    // Chinese and Japanese break between characters.
    expect(cutOff("今日は元気ですか", 0.5)).toBe("今日は—");
  });
});

describe("typing time", () => {
  it("takes about as long for the same message in any language", () => {
    // Every key counts: spaces and punctuation too, three a second.
    expect(composingMs("ok I'll be right there", "typing")).toBe(7_333);
    // A character is a reading, then a pick among candidates.
    expect(composingMs("好的，我马上到", "typing")).toBe(8_333);
    expect(composingMs("わかった、すぐ行く", "typing")).toBe(6_333);
    expect(composingMs("곧 갈게", "typing")).toBe(2_833);
  });

  it("counts an emoji or an accented letter as one key", () => {
    expect(composingMs("👍🏽", "typing")).toBe(333);
    expect(composingMs("café", "typing")).toBe(1_333);
    expect(composingMs("café", "typing")).toBe(1_333);
  });

  it("picks a sticker rather than typing it, at the typist's pace", () => {
    expect(composingMs(undefined, "typing")).toBe(1_500);
    expect(composingMs(undefined, "typing", undefined, 1.5)).toBe(1_000);
  });
});
