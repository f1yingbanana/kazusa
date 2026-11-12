import { describe, expect, it } from "vitest";
import { composingMs, cutOff, heardOf, sayingOf } from "./speech.ts";

const LINES = [
  "I told you not to go there",
  "Wait, no. Listen — it's not what you think!",
  "今日は元気ですか",
  "Tokyo行きの電車、もう出た?",
  "안녕하세요, 반가워요.",
  "Hmm…",
  "Well...   okay.",
  "café au lait, s'il vous plaît",
];

describe("what is heard of a line as it is said", () => {
  it("is what a cut keeps, without the dash", () => {
    expect(heardOf("I told you not to go there", 0.5)).toBe("I told you");
    expect(heardOf("Wait, no. Listen", 0.67)).toBe("Wait, no");
    expect(heardOf("Listen to me", 0.1)).toBe("");
    expect(heardOf("Listen to me", 1)).toBe("Listen to me");
    expect(heardOf("今日は元気ですか", 0.5)).toBe("今日は");
    for (const text of LINES)
      for (let step = 0; step <= 100; step++) {
        const heard = heardOf(text, step / 100);
        expect(cutOff(text, step / 100)).toBe(
          step === 100 ? text : heard ? `${heard}—` : "",
        );
      }
  });

  it("never takes a word back: earlier is always a prefix of later, and of the cut", () => {
    for (const text of LINES)
      for (let step = 0; step <= 200; step++) {
        const at = step / 200;
        const cut = cutOff(text, at);
        // A client a little behind the server (any lag) shows a prefix.
        for (const lag of [0, 0.01, 0.05, 0.2]) {
          const shown = heardOf(text, at - lag);
          expect(cut.startsWith(shown)).toBe(true);
          expect(heardOf(text, at).startsWith(shown)).toBe(true);
        }
      }
  });

  it("shows on screen letter by letter, never behind what has been heard", () => {
    expect(sayingOf("I told you not to go there", 0)).toBe("");
    expect(sayingOf("I told you not to go there", 0.5)).toBe("I told you no");
    expect(sayingOf("Wait, no. Listen", 0.34)).toBe("Wait, ");
    expect(sayingOf("今日は元気ですか", 0.5)).toBe("今日は");
    expect(sayingOf("Listen to me", 1)).toBe("Listen to me");
    for (const text of LINES) {
      let before = "";
      for (let step = 0; step <= 400; step++) {
        const shown = sayingOf(text, step / 400);
        // One character at a time, with what is not pronounced after it.
        const added = shown.slice(before.length);
        expect(shown.startsWith(before)).toBe(true);
        expect(added.replace(/[^\p{L}\p{N}]/gu, "").length).toBeLessThanOrEqual(
          1,
        );
        // Ahead of what a cut now keeps by no more than the word being said.
        const heard = heardOf(text, step / 400);
        expect(shown.startsWith(heard)).toBe(true);
        expect(
          (shown.slice(heard.length).match(/[\p{L}\p{N}]+/gu) ?? []).length,
        ).toBeLessThanOrEqual(1);
        before = shown;
      }
      expect(before).toBe(text);
    }
  });

  it("is said in the speaking time composingMs gives", () => {
    expect(composingMs("one two three four five", "speaking")).toBe(1_583);
  });
});
