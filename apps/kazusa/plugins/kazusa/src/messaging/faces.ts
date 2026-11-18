import type { PortraitSet } from "../scene/portraits.ts";
import { type FaceRef, faceTag } from "./conversations.ts";

/**
 * The moods a character can give a line (§6.3): those of their portraits in
 * what they are wearing (`worn`, an outfit's word, or nothing in the usual
 * clothes), sorted; the usual clothes' where that outfit has no portrait. None
 * when the figure isn't drawn. They change only when the outfit does, so the
 * tool's schema is stable from turn to turn.
 */
export function faceMoods(portraits: PortraitSet, worn?: string): string[] {
  if (portraits.default === undefined) return [];
  const moodsIn = (outfit: string | undefined) => [
    ...new Set(
      [...portraits.portraits.values()]
        .filter((portrait) => portrait.outfit === outfit)
        .map(({ mood }) => mood),
    ),
  ];
  const moods = moodsIn(worn);
  return (moods.length ? moods : moodsIn(undefined)).sort();
}

/** A bubble with its mood word replaced by the face it shows. */
export type Faced<B> = B extends { readonly face?: unknown }
  ? Omit<B, "face"> & { readonly face?: FaceRef }
  : B;

/**
 * The written bubbles with each mood resolved to the face it shows, frozen now.
 * The picture is `<mood>` in what they wear when it is drawn (their `outfit`
 * state); the scene falls back to the neutral face where there is no such
 * picture. `shown` is the face the speaker last said a line with there: only a
 * face that differs from it, or from the one before it in this call, carries
 * what listeners read of it (`seen`, the tag the speaker wrote).
 */
export function sayFaces<B>(
  bubbles: readonly B[],
  shown: string | undefined,
): Faced<B>[] {
  let last = shown;
  return bubbles.map((bubble) => {
    if (typeof bubble !== "object" || bubble === null || !("face" in bubble))
      return bubble as Faced<B>;
    const { face: name, ...rest } = bubble as { face?: unknown };
    if (typeof name !== "string") return rest as Faced<B>;
    const face: FaceRef =
      name === last ? { name } : { name, seen: faceTag(name) };
    last = name;
    return { ...rest, face } as Faced<B>;
  });
}
