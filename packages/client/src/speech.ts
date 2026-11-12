/**
 * How long a message takes to compose: typed on a phone, or said aloud. Each
 * writing system's characters take their own time, at a person's own pace.
 * Shared by the plugin, which paces and cuts lines with it, and the client,
 * which reveals a line as it is said at the same pace, letter by letter
 * (`sayingOf`): a cut keeps whole words (`heardOf`), so at most the word being
 * said when it was cut leaves the screen.
 */

/** Typed into a chat, or said aloud face to face. */
export type Medium = "typing" | "speaking";

/**
 * Characters per second at an ordinary pace, per writing system: languages
 * differ in how much one written character carries. Letters and digits of every
 * alphabet count alike.
 */
export interface ScriptRates {
  readonly letters: number;
  /** Chinese characters, and kanji in Japanese. */
  readonly han: number;
  /** Japanese kana. */
  readonly kana: number;
  /** Korean syllable blocks. */
  readonly hangul: number;
}

export type ComposingRates = Readonly<Record<Medium, ScriptRates>>;

/**
 * Speaking: ~150 English words a minute; Japanese ~8 morae and Mandarin ~5
 * syllables a second (Pellegrino et al. 2011); Korean approximate. Typing on a
 * phone: 36 words a minute, 3 keys a second (Palin et al. 2019); a Chinese
 * character or kanji is a reading then a pick among candidates, ~45 a minute;
 * flick kana ~90 a minute; a Hangul block 2-3 keys. The last three are
 * estimates from small studies.
 */
export const COMPOSING_RATES: ComposingRates = {
  speaking: { letters: 12, han: 5, kana: 8, hangul: 7 },
  typing: { letters: 3, han: 0.75, kana: 1.5, hangul: 1.2 },
};

/** A sticker is picked, not typed. */
const STICKER_SECONDS = 1.5;
/** Nothing is said or sent in less. */
const MIN_SECONDS = 0.3;

const HAN = /\p{Script=Han}/u;
const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;
const HANGUL = /\p{Script=Hangul}/u;
const SPOKEN = /[\p{L}\p{N}]/u;

const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** What a reader sees as one character: an emoji or an accented letter too. */
function characters(text: string): string[] {
  return Array.from(GRAPHEMES.segment(text), ({ segment }) => segment);
}

/**
 * Seconds one character takes at an ordinary pace. Typing, every key counts:
 * spaces, punctuation, an emoji. Saying, only what is pronounced.
 */
function secondsOf(
  char: string,
  medium: Medium,
  rates: ComposingRates,
): number {
  const rate = rates[medium];
  if (HAN.test(char)) return 1 / rate.han;
  if (KANA.test(char)) return 1 / rate.kana;
  if (HANGUL.test(char)) return 1 / rate.hangul;
  return medium === "typing" || SPOKEN.test(char) ? 1 / rate.letters : 0;
}

/**
 * Time to type or say `text` (a sticker: to pick it), in sim ms, at the
 * person's `pace`. No cap: a long message takes long.
 */
export function composingMs(
  text: string | undefined,
  medium: Medium,
  rates: ComposingRates = COMPOSING_RATES,
  pace = 1,
): number {
  let seconds = text === undefined ? STICKER_SECONDS : 0;
  for (const char of characters(text ?? ""))
    seconds += secondsOf(char, medium, rates);
  return Math.round((1_000 * Math.max(seconds, MIN_SECONDS)) / pace);
}

/** A letter of a script written with spaces between words. */
const spaced = (char: string): boolean =>
  SPOKEN.test(char) && !HAN.test(char) && !KANA.test(char);

/**
 * What a line said `fraction` of the way through has been heard of, whole units
 * only: a word written with spaces whole or not at all, a Chinese or Japanese
 * character on its own, trailing spaces and punctuation dropped. Empty before
 * anything was said; the whole line once its time is up. Never shrinks as
 * `fraction` grows: what is heard at one moment is a prefix of what is heard at
 * any later one, and of `cutOff` then.
 */
export function heardOf(
  text: string,
  fraction: number,
  rates: ComposingRates = COMPOSING_RATES,
): string {
  if (fraction >= 1) return text;
  const chars = characters(text);
  let end = saidUpTo(chars, fraction, rates);
  if (end < chars.length && spaced(chars[end]))
    while (end > 0 && spaced(chars[end - 1])) end--;
  const kept = chars
    .slice(0, end)
    .join("")
    .replace(/[\s\p{P}]+$/u, "");
  return characters(kept).some((char) => secondsOf(char, "speaking", rates) > 0)
    ? kept
    : "";
}

/** How many of `chars` have been said through, `fraction` of the way in. */
function saidUpTo(
  chars: readonly string[],
  fraction: number,
  rates: ComposingRates,
): number {
  const seconds = (char: string) => secondsOf(char, "speaking", rates);
  const total = chars.reduce((sum, char) => sum + seconds(char), 0);
  const reached = total * Math.max(0, fraction);
  let spent = 0;
  let end = 0;
  for (; end < chars.length; end++) {
    if (spent + seconds(chars[end]) > reached + 1e-9) break;
    spent += seconds(chars[end]);
  }
  return end;
}

/**
 * What a line shows on screen `fraction` of the way through its saying: every
 * character said through by then, one at a time, with the spaces and
 * punctuation after it. Empty before it starts; the whole line once its time is
 * up. Never shrinks as `fraction` grows, and always starts with what has been
 * heard by then (`heardOf`): it is ahead of it by at most the word being said.
 */
export function sayingOf(
  text: string,
  fraction: number,
  rates: ComposingRates = COMPOSING_RATES,
): string {
  if (fraction >= 1) return text;
  if (!(fraction > 0)) return "";
  const chars = characters(text);
  return chars.slice(0, saidUpTo(chars, fraction, rates)).join("");
}

/**
 * What a line said `fraction` of the way through sounded like: what was heard
 * of it (`heardOf`), then a dash. Empty when cut before anything was said; the
 * whole line once its time is up.
 */
export function cutOff(
  text: string,
  fraction: number,
  rates: ComposingRates = COMPOSING_RATES,
): string {
  if (fraction >= 1) return text;
  const heard = heardOf(text, fraction, rates);
  return heard ? `${heard}—` : "";
}
