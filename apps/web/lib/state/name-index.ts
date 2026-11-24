/**
 * Contact-list headings for a name, by the platform's own collation
 * (`Intl.Collator`): a heading is the last row start a name sorts at or after.
 * Latin names under their base letter (Ō under O, Ł under L), Korean under the
 * first consonant (까 under ㄱ, as phone contacts do), kana under its row (カ and
 * が under か). Chinese characters need their reading, from a dictionary the
 * caller supplies (`pinyin-pro`); without one they head themselves.
 */

type Rows = readonly (readonly [start: string, label: string])[];

const same = (letters: string): Rows =>
  [...letters].map((letter) => [letter, letter] as const);

const SCRIPTS: readonly {
  readonly test: RegExp;
  readonly collator: Intl.Collator;
  readonly rows: Rows;
}[] = [
  {
    test: /\p{Script=Latin}/u,
    collator: new Intl.Collator("en", { sensitivity: "base" }),
    rows: same("ABCDEFGHIJKLMNOPQRSTUVWXYZ"),
  },
  {
    test: /\p{Script=Hangul}/u,
    collator: new Intl.Collator("ko", { sensitivity: "base" }),
    rows: [..."가나다라마바사아자차카타파하"].map(
      (start, index) =>
        [start, [..."ㄱㄴㄷㄹㅁㅂㅅㅇㅈㅊㅋㅌㅍㅎ"][index]] as const,
    ),
  },
  {
    test: /[\p{Script=Hiragana}\p{Script=Katakana}]/u,
    collator: new Intl.Collator("ja", { sensitivity: "base" }),
    rows: same("あかさたなはまやらわ"),
  },
];

const HAN = /\p{Script=Han}/u;

/** A Chinese character's reading's first letter, lowercase or upper. */
export type HanInitial = (character: string) => string | undefined;

/** The heading a name goes under; "#" for one that starts with no letter. */
export function nameInitial(name: string, han?: HanInitial): string {
  const first = [...name.trim()][0];
  if (!first) return "#";
  for (const { test, collator, rows } of SCRIPTS) {
    if (!test.test(first)) continue;
    let label = rows[0][1];
    for (const [start, row] of rows)
      if (collator.compare(first, start) >= 0) label = row;
    return label;
  }
  if (HAN.test(first)) {
    const letter = han?.(first);
    return letter && /^[a-z]$/i.test(letter) ? letter.toUpperCase() : first;
  }
  return /\p{L}/u.test(first) ? first.toLocaleUpperCase() : "#";
}

/** Whether any name needs a Chinese reading. */
export const needsHan = (names: Iterable<string>): boolean =>
  [...names].some((name) => HAN.test([...name.trim()][0] ?? ""));
