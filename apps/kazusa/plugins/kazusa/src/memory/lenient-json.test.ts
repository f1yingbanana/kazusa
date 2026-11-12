import { describe, expect, it } from "vitest";
import { readLenientJson } from "./lenient-json.ts";

describe("readLenientJson", () => {
  it("reads valid JSON strictly, through a fence", () => {
    expect(readLenientJson('[x] ```json\n{"a": [1, "b"]}\n```')).toEqual({
      value: { a: [1, "b"] },
      repaired: false,
    });
  });

  it("refuses a reply with no JSON at all", () => {
    expect(() => readLenientJson("I dreamt of nothing.")).toThrow();
  });

  // The shapes below are what xiaomi-mimo-v2-flash returned on 2026-11-12.
  it("keeps what arrived whole from a reply cut off at its end", () => {
    const { value, repaired } = readLenientJson(
      [
        "{",
        '  "day": {"summary": "s", "gist": "g"},',
        '  "dream": "a lamp",',
        '  "pages": [',
        '    {"id": "a", "notes": [{"source": "seen it", "certainty": "sure", "text": "ok"}]},',
        '    {"id": "b", "notes": [{"source": "seen it", "certainty": "sure", "text": "half a sen',
      ].join("\n"),
    );
    expect(repaired).toBe(true);
    expect(value).toEqual({
      day: { summary: "s", gist: "g" },
      dream: "a lamp",
      pages: [
        {
          id: "a",
          notes: [{ source: "seen it", certainty: "sure", text: "ok" }],
        },
        { id: "b", notes: [{ source: "seen it", certainty: "sure" }] },
      ],
    });
  });

  it("keeps a raw line break inside a string ('Bad control character')", () => {
    expect(
      readLenientJson('{"gist": "first line\nsecond\tline"}').value,
    ).toEqual({ gist: "first line\nsecond\tline" });
  });

  it("supplies a missing comma between members and elements", () => {
    expect(
      readLenientJson('{"a": "x"\n "b": ["y"\n "z"]\n "c": {"d": 1}\n}').value,
    ).toEqual({ a: "x", b: ["y", "z"], c: { d: 1 } });
  });

  it("keeps quotes inside words, and drops trailing commas", () => {
    expect(
      readLenientJson('{"text": "she said "hi" to me", "n": [1, 2,],}').value,
    ).toEqual({ text: 'she said "hi" to me', n: [1, 2] });
  });

  it("reads escapes", () => {
    expect(readLenientJson('{"a": "\\u00e9\\n\\"", "b": tru').value).toEqual({
      a: 'é\n"',
    });
  });
});
