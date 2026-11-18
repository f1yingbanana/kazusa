import { WikiKindSchema } from "@kazusa/client";
import { parseAsString, parseAsStringLiteral } from "nuqs/server";

/** A character's page has these tabs; any other page is its page alone. */
export const PAGE_PARTS = ["page", "memory", "looks", "stickers"] as const;
export type PagePart = (typeof PAGE_PARTS)[number];

export const wikiParsers = {
  /** Whose view: a character's own wiki beside the world's. */
  "wiki.agent": parseAsString,
  "wiki.page": parseAsString,
  /** A backdrop set open from the Backdrops folder. */
  "wiki.backdrop": parseAsString,
  "wiki.part": parseAsStringLiteral(PAGE_PARTS),
  "wiki.tab": parseAsStringLiteral(["lint", "nights"]),
  "wiki.edit": parseAsStringLiteral(["world", "own"]),
  /** Editing as Markdown instead of the form. */
  "wiki.raw": parseAsStringLiteral(["1"]),
  "wiki.kind": parseAsStringLiteral(WikiKindSchema.options),
  "wiki.name": parseAsString,
};
