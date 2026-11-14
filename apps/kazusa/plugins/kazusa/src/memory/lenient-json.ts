/**
 * Reads JSON the way a small, fast model writes it. Sleep asks for one long
 * document, and on 2026-11-12 nine of 81 nights were lost to replies that were
 * cut off at their end, carried a raw line break inside a string, or skipped a
 * comma. Strict parsing comes first; only a reply it refuses is read leniently,
 * keeping every value that arrived whole and nothing half-written.
 */

/** No value: the input ended, or junk stood where one should be. */
const MISSING = Symbol("missing");

export interface LenientJson {
  readonly value: unknown;
  /** True when strict parsing failed and the lenient reading was used. */
  readonly repaired: boolean;
}

/** Reads the first JSON object in `text`. */
export function readLenientJson(text: string): LenientJson {
  const start = text.indexOf("{");
  if (start < 0) throw new Error("No JSON in the reply.");
  const body = text.slice(start);
  // A fence or a closing remark after the document is common and harmless.
  const end = body.lastIndexOf("}");
  try {
    return { value: JSON.parse(body.slice(0, end + 1)), repaired: false };
  } catch {
    // Read it leniently below.
  }
  const value = new Lenient(body).value();
  if (value === MISSING) throw new Error("No JSON in the reply.");
  return { value, repaired: true };
}

const WHITESPACE = /\s/;
const ESCAPES: Readonly<Record<string, string>> = {
  '"': '"',
  "\\": "\\",
  "/": "/",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
};

class Lenient {
  private at = 0;
  constructor(private readonly text: string) {}

  private get done(): boolean {
    return this.at >= this.text.length;
  }

  private skipSpace(): void {
    while (!this.done && WHITESPACE.test(this.text[this.at])) this.at++;
  }

  /** A value, or MISSING. */
  value(): unknown {
    this.skipSpace();
    if (this.done) return MISSING;
    const char = this.text[this.at];
    if (char === "{") return this.object();
    if (char === "[") return this.array();
    if (char === '"') return this.string();
    if (char === "-" || (char >= "0" && char <= "9")) return this.number();
    for (const [word, literal] of [
      ["true", true],
      ["false", false],
      ["null", null],
    ] as const) {
      if (this.text.startsWith(word, this.at)) {
        this.at += word.length;
        return literal;
      }
    }
    return MISSING;
  }

  /** A container cut off at the end keeps the members that arrived whole. */
  private object(): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    this.at++;
    for (;;) {
      this.skipSpace();
      if (this.done) return result;
      const char = this.text[this.at];
      if (char === "}") {
        this.at++;
        return result;
      }
      if (char !== '"') {
        // A stray or doubled comma, or junk: step over it.
        this.at++;
        continue;
      }
      const key = this.string();
      if (key === MISSING) return result;
      this.skipSpace();
      if (this.text[this.at] === ":") this.at++;
      const value = this.value();
      if (value === MISSING) {
        if (this.done) return result;
        continue;
      }
      result[key] = value;
    }
  }

  private array(): unknown[] {
    const result: unknown[] = [];
    this.at++;
    for (;;) {
      this.skipSpace();
      if (this.done) return result;
      const char = this.text[this.at];
      if (char === "]") {
        this.at++;
        return result;
      }
      if (char === ",") {
        this.at++;
        continue;
      }
      const value = this.value();
      if (value === MISSING) {
        if (this.done) return result;
        this.at++;
        continue;
      }
      result.push(value);
    }
  }

  /**
   * A quote ends the string only where JSON could go on after it; any other
   * quote is part of the words. A raw line break or tab is kept as written. A
   * string cut off at the end is half a sentence, so it is dropped.
   */
  private string(): string | typeof MISSING {
    let result = "";
    this.at++;
    while (!this.done) {
      const char = this.text[this.at];
      if (char === "\\") {
        const next = this.text[this.at + 1];
        if (next === undefined) break;
        const hex = this.text.slice(this.at + 2, this.at + 6);
        if (next === "u" && /^[0-9a-fA-F]{4}$/.test(hex)) {
          result += String.fromCharCode(Number.parseInt(hex, 16));
          this.at += 6;
          continue;
        }
        result += ESCAPES[next] ?? next;
        this.at += 2;
        continue;
      }
      if (char === '"' && this.endsHere()) {
        this.at++;
        return result;
      }
      result += char;
      this.at++;
    }
    return MISSING;
  }

  /** Whether the quote at `at` closes the string. */
  private endsHere(): boolean {
    let next = this.at + 1;
    let newline = false;
    while (next < this.text.length && WHITESPACE.test(this.text[next])) {
      if (this.text[next] === "\n") newline = true;
      next++;
    }
    if (next >= this.text.length) return true;
    const after = this.text[next];
    if (",:}]".includes(after)) return true;
    // A missing comma between members usually sits at a line break.
    return newline && '"{['.includes(after);
  }

  private number(): number | typeof MISSING {
    const match = /^-?\d+(\.\d+)?([eE][+-]?\d+)?/.exec(
      this.text.slice(this.at),
    );
    if (!match) {
      this.at++;
      return MISSING;
    }
    this.at += match[0].length;
    return Number(match[0]);
  }
}
