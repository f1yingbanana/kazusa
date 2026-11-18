import { WikiKindSchema } from "@kazusa/client";
import { parseAsString, parseAsStringLiteral } from "nuqs/server";

/** The tabs a page can have: a character's, and a place's. */
export const PAGE_PARTS = [
  "page",
  "memory",
  "looks",
  "stickers",
  "backdrop",
] as const;
export type PagePart = (typeof PAGE_PARTS)[number];
export const CHARACTER_PARTS: readonly PagePart[] = [
  "page",
  "memory",
  "looks",
  "stickers",
];
export const PLACE_PARTS: readonly PagePart[] = ["page", "backdrop"];

export const wikiParsers = {
  /** Whose view: a character's own wiki beside the world's. */
  "wiki.agent": parseAsString,
  "wiki.page": parseAsString,
  "wiki.part": parseAsStringLiteral(PAGE_PARTS),
  "wiki.tab": parseAsStringLiteral(["lint", "nights"]),
  "wiki.edit": parseAsStringLiteral(["world", "own"]),
  /** Editing as Markdown instead of the form. */
  "wiki.raw": parseAsStringLiteral(["1"]),
  "wiki.kind": parseAsStringLiteral(WikiKindSchema.options),
  "wiki.name": parseAsString,
};
