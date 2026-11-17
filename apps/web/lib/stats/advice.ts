import {
  statStride,
  type StatCatalog,
  type StatDefinition,
} from "@kazusa/client";

/**
 * Steps between two words of a state that builds over days. Measured on
 * replayed nights (the kazusa skill's `references/status.md` §5): 3 apart, a
 * fortnight where nothing happened moved it a whole word; 8 apart, it held and
 * still answered a kept or broken promise nearly every time.
 */
export const STRIDE_ADVISED = 8;
/** Closer than this, ordinary days add up to a word within weeks. */
const STRIDE_FLOOR = 6;

export interface StatAdvice {
  /** The field of the form it belongs under. */
  readonly field: "kind" | "bands" | "shown";
  /** `warn`: measured to work badly as it stands. `note`: how it will behave. */
  readonly tone: "warn" | "note";
  readonly text: string;
  /** A warning in a few words, for the list of states. */
  readonly brief?: string;
}

/**
 * What to tell someone defining this state, from what states were measured to
 * do. Never an error: every state here is valid and saves.
 */
export function statAdvice(stat: StatDefinition): StatAdvice[] {
  const advice: StatAdvice[] = [];
  // A night's sleep moves it: something meant to build up slowly.
  const builds = stat.changedBy === "reviewed";
  if (builds && stat.kind === "choice")
    advice.push({
      field: "kind",
      tone: "warn",
      text: "A value that builds over days works better as a number with words for ranges. In a list each word is a whole step, and characters rarely take one.",
      brief: "Rarely moves as a list: make it a number with words for ranges.",
    });
  if (builds && stat.kind === "number") {
    if (!stat.bands?.length)
      advice.push({
        field: "bands",
        tone: "warn",
        text: "Add words for ranges. Without them a night has to pick a number; with them it only says up or down, which characters judge far better.",
        brief: "Needs words for ranges, so a night can say up or down.",
      });
    else if (stat.bands.length > 1) {
      const stride = statStride(stat);
      advice.push(
        stride < STRIDE_FLOOR
          ? {
              field: "bands",
              tone: "warn",
              text: `These words are ${stride === 1 ? "1 step" : `${stride} steps`} apart, so ${stride === 1 ? "one thing that mattered changes" : `about ${stride} things that mattered change`} the word, and ordinary days add up to one within weeks. About ${STRIDE_ADVISED} apart holds steady.`,
              brief: `Its words are ${stride === 1 ? "1 step" : `${stride} steps`} apart: about ${STRIDE_ADVISED} holds steady.`,
            }
          : {
              field: "bands",
              tone: "note",
              text: `About ${stride} things that mattered move it from one word to the next.`,
            },
      );
    }
  }
  if ((builds || stat.on === "pair") && stat.shown === "self")
    advice.push({
      field: "shown",
      tone: "note",
      text: "They act from what they remember, not from reading this. It is a meter for you and the system agent to watch.",
    });
  return advice;
}

/** What to say about the states taken together. */
export function catalogAdvice(catalog: StatCatalog): string[] {
  const toward = catalog.filter(
    ({ on, changedBy }) => on === "pair" && changedBy === "reviewed",
  );
  if (toward.length < 2) return [];
  const names = toward.map(({ name }) => name);
  return [
    `${names.slice(0, -1).join(", ")} and ${names.at(-1)} are ${names.length === 2 ? "both" : "all"} reviewed toward someone, so the same events move them together. Keep more than one only if you can say what moves one and not the other.`,
  ];
}
