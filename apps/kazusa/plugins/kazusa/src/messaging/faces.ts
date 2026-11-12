import type { PortraitSet } from "../scene/portraits.ts";
import type { StickerSet } from "../stickers/stickers.ts";
import type { FaceRef } from "./conversations.ts";

/**
 * The moods a character can give a line (§6.3): the distinct moods across all
 * their portraits, sorted. They don't depend on what is worn, so the tool's
 * schema stays the same from turn to turn.
 */
export function faceMoods(portraits: PortraitSet): string[] {
  return [
    ...new Set([...portraits.portraits.values()].map(({ mood }) => mood)),
  ].sort();
}

/** A bubble with its mood word replaced by the face it shows. */
export type Faced<B> = B extends { readonly face?: unknown }
  ? Omit<B, "face"> & { readonly face?: FaceRef }
  : B;

/**
 * The tool's bubbles with each mood resolved to the face it shows, frozen now.
 * The picture is the usual clothes' `<mood>` (outfits come with §6.4); the
 * scene falls back to the neutral face where there is no such picture. `shown`
 * is the face the speaker last said a line with there: only a face that differs
 * from it, or from the one before it in this call, carries what listeners read
 * of it (`seen`, worded by `see` from the look of the sticker with that name,
 * else the mood word).
 */
export function sayFaces<B>(
  bubbles: readonly B[],
  stickers: StickerSet | undefined,
  shown: string | undefined,
  see: (look: string) => string,
): Faced<B>[] {
  let last = shown;
  return bubbles.map((bubble) => {
    if (typeof bubble !== "object" || bubble === null || !("face" in bubble))
      return bubble as Faced<B>;
    const { face: name, ...rest } = bubble as { face?: unknown };
    if (typeof name !== "string") return rest as Faced<B>;
    const look =
      stickers?.stickers.get(name)?.look ?? name.replaceAll("-", " ");
    const face: FaceRef = name === last ? { name } : { name, seen: see(look) };
    last = name;
    return { ...rest, face } as Faced<B>;
  });
}
