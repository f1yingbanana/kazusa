/** The World Wiki, or one character's own. */
export type WikiSide = "world" | "own";

/** What saving does, shown under the Markdown editor. */
export function describeSaving(side: WikiSide, owner?: string): string {
  return side === "world"
    ? "Edits change what was always true. For something that happens on a date, add it under ## History."
    : `${owner ?? "They"} read${owner ? "s" : ""} this as their own memory, and may rewrite it in their sleep.`;
}
