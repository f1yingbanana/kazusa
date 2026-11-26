import { parseAsString, parseAsStringLiteral } from "nuqs";
import { wikiParsers } from "../wiki/search-params";

export const CAST_ARRANGEMENTS = ["group", "name"] as const;
export type CastArrangement = (typeof CAST_ARRANGEMENTS)[number];

export const CAST_SHOWS = ["onstage", "offstage", "favorites"] as const;
export type CastShow = (typeof CAST_SHOWS)[number];

/**
 * `character` opens someone's page; `chars.look` tries a portrait on them; the
 * rest narrow and arrange the cast.
 */
export const charactersParsers = {
  character: parseAsString,
  "chars.look": parseAsString,
  "chars.show": parseAsStringLiteral(CAST_SHOWS),
  "chars.by": parseAsStringLiteral(CAST_ARRANGEMENTS).withDefault("group"),
  "chars.q": parseAsString.withDefault(""),
};

/** Opening someone starts on their page, in their usual look. */
export function profilePatch(id: string | null) {
  return {
    view: "characters",
    character: id,
    "wiki.part": null as (typeof wikiParsers)["wiki.part"] extends {
      parse: (v: string) => infer T | null;
    }
      ? T | null
      : never,
    "wiki.edit": null,
    "wiki.raw": null,
    "chars.look": null,
  } as const;
}
