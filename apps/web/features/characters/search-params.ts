import { parseAsString, parseAsStringLiteral } from "nuqs";

export const CAST_ARRANGEMENTS = ["group", "name"] as const;
export type CastArrangement = (typeof CAST_ARRANGEMENTS)[number];

export const PROFILE_TABS = [
  "about",
  "story",
  "people",
  "looks",
  "memory",
] as const;
export type ProfileTab = (typeof PROFILE_TABS)[number];

export const CAST_SHOWS = ["onstage", "offstage", "favorites"] as const;
export type CastShow = (typeof CAST_SHOWS)[number];

/**
 * `character` opens someone's profile (wiki links already point here);
 * `chars.look` tries a portrait on them; the rest narrow and arrange the cast.
 */
export const charactersParsers = {
  character: parseAsString,
  "chars.tab": parseAsStringLiteral(PROFILE_TABS),
  "chars.look": parseAsString,
  "chars.show": parseAsStringLiteral(CAST_SHOWS),
  "chars.by": parseAsStringLiteral(CAST_ARRANGEMENTS).withDefault("group"),
  "chars.q": parseAsString.withDefault(""),
};

/** Opening someone starts on About, in their usual look. */
export function profilePatch(id: string | null) {
  return {
    view: "characters",
    character: id,
    "chars.tab": null,
    "chars.look": null,
  } as const;
}
