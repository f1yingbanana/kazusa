/**
 * How long a message takes to compose and what a cut-off line sounded like live
 * in `@kazusa/client` (`speech.ts`), shared with the client's reveal; the pace
 * a judged score stands for is the plugin's own.
 */
export {
  COMPOSING_RATES,
  composingMs,
  cutOff,
  heardOf,
  type ComposingRates,
  type Medium,
  type ScriptRates,
} from "@kazusa/client";

/**
 * The pace a judged score stands for: scores index the rubric's ordered pace
 * anchors, and a fraction lies between two, evenly on a log scale (a ratio).
 * Unjudged: ordinary.
 */
export function paceAt(score: number, anchors: readonly number[]): number {
  if (!anchors.length || !Number.isFinite(score)) return 1;
  const position = Math.min(Math.max(score, 0), anchors.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const from = Math.log(anchors[lower]);
  const to = Math.log(anchors[upper]);
  return Math.exp(from + (to - from) * (position - lower));
}
