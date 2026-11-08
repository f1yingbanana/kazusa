import { parseAsString, parseAsStringLiteral } from "nuqs/server";

// Defaults depend on the world's capabilities and belong in useWorldParams.
export const worldParsers = {
  "world.by": parseAsStringLiteral([
    "place",
    "affiliation",
    "activity",
    "brain",
  ]),
  "world.in": parseAsString,
  "world.kind": parseAsStringLiteral([
    "characters",
    "onstage",
    "offstage",
    "npc",
    "everyone",
  ]),
  "world.as": parseAsStringLiteral(["map", "list"]),
  "world.plane": parseAsString,
};
