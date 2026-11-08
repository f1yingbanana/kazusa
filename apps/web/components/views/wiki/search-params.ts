import { WikiKindSchema } from "@kazusa/client";
import { parseAsString, parseAsStringLiteral } from "nuqs/server";

export const wikiParsers = {
  "wiki.agent": parseAsString,
  "wiki.page": parseAsString,
  "wiki.tab": parseAsStringLiteral(["lint", "nights"]),
  "wiki.edit": parseAsStringLiteral(["world", "own"]),
  "wiki.kind": parseAsStringLiteral(WikiKindSchema.options),
  "wiki.name": parseAsString,
};
