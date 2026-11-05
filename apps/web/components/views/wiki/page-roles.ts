import type { WikiKind } from "@kazusa/client";

/** The World Wiki, or one character's own. */
export type WikiSide = "world" | "own";

/**
 * What a page is for, said where it's read and edited. A person has three
 * places that sound alike (identity files, their world page, everyone else's
 * page on them), and editing the wrong one changes nothing a reader expects.
 */
export function describePage(
  side: WikiSide,
  kind: WikiKind | undefined,
  { owner, subject }: { readonly owner?: string; readonly subject: string },
): string {
  const who = owner ?? "this character";
  if (side === "world")
    switch (kind) {
      case "person":
        return `Facts about ${subject} that others can know: home, school, club, who they know. How much each character knows depends on how well known ${subject} is. Voice and personality live in ${subject}'s IDENTITY.md and SOUL.md; feelings about ${subject} live in each character's own wiki.`;
      case "place":
        return "The place as it really is. The map reads its area (parent) and roads (connections) from here.";
      case "day":
        return "A day in the world's records.";
      default:
        return "Lore anyone might know, depending on how well known it is.";
    }
  switch (kind) {
    case "person":
      return `How ${who} sees ${subject}: their impression, what they've noticed and their relation. "What they think of me" is ${who}'s guess at what ${subject} thinks of ${who}, and it can be wrong. Only ${who} reads this page; ${subject} never sees it.`;
    case "place":
      return `What ${who} remembers of it and when they last saw it.`;
    case "day":
      return `${who}'s diary for this day, written while they sleep.`;
    default:
      return `${who}'s own take on it, or an idea that is theirs alone.`;
  }
}

/** What saving does, shown under the editor. */
export function describeSaving(side: WikiSide, owner?: string): string {
  return side === "world"
    ? "Changing the text changes what was always true, for everyone who knows it. To make something happen on a date instead, add a dated line under ## History."
    : `${owner ? `${owner} reads` : "They read"} this as their own memory on their next turn, and may rewrite it while they sleep.`;
}
