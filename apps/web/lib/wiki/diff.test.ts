import { describe, expect, it } from "vitest";
import { changedOnly, diffLines } from "./diff";

describe("diffLines", () => {
  it("marks what changed and keeps the order", () => {
    expect(diffLines("a\nb\nc", "a\nx\nc")).toEqual([
      { kind: "same", text: "a" },
      { kind: "removed", text: "b" },
      { kind: "added", text: "x" },
      { kind: "same", text: "c" },
    ]);
  });

  it("treats a new file as all added", () => {
    expect(diffLines("", "a\nb").map(({ kind }) => kind)).toEqual([
      "added",
      "added",
    ]);
  });

  it("shows nothing when nothing changed", () => {
    expect(changedOnly(diffLines("a\nb", "a\nb"))).toEqual([]);
  });

  it("keeps one line of context around a change", () => {
    const lines = diffLines("1\n2\n3\n4\n5", "1\n2\nx\n4\n5");
    expect(changedOnly(lines).map(({ text }) => text)).toEqual([
      "2",
      "3",
      "x",
      "4",
    ]);
  });
});
