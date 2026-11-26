import { WikiKindSchema } from "@kazusa/client";
import { parseAsString, parseAsStringLiteral } from "nuqs";

/** A place's page has its backdrop beside it; every other page is one part. */
export const PAGE_PARTS = ["page", "backdrop"] as const;
export type PagePart = (typeof PAGE_PARTS)[number];

export const WIKI_TABS = ["lint", "nights"] as const;
export type WikiTab = (typeof WIKI_TABS)[number];

/** Whose notes are being edited: the world's page, or the character's own. */
export const WIKI_SIDES = ["world", "own"] as const;
export type WikiSide = (typeof WIKI_SIDES)[number];

/**
 * `wiki.agent` reads the wiki as one character: their own pages, each beside
 * the world's. `wiki.edit` opens an editor on one side, `wiki.raw` as Markdown;
 * `wiki.kind` and `wiki.name` name a page not written yet.
 */
export const wikiParsers = {
  "wiki.agent": parseAsString,
  "wiki.page": parseAsString,
  "wiki.part": parseAsStringLiteral(PAGE_PARTS),
  "wiki.tab": parseAsStringLiteral(WIKI_TABS),
  "wiki.edit": parseAsStringLiteral(WIKI_SIDES),
  "wiki.raw": parseAsStringLiteral(["1"]),
  "wiki.kind": parseAsStringLiteral(WikiKindSchema.options),
  "wiki.name": parseAsString,
};
