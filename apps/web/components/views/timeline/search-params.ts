import { JOURNAL_KINDS } from "@kazusa/client";
import {
  createParser,
  parseAsArrayOf,
  parseAsString,
  parseAsStringLiteral,
} from "nuqs/server";

// Retain existing ?tl.watch=1 bookmarks while exposing boolean state.
const watchParser = createParser({
  parse: (value) => value === "1",
  serialize: (value: boolean) => (value ? "1" : "0"),
}).withDefault(false);

export const timelineParsers = {
  "tl.actors": parseAsArrayOf(parseAsString).withDefault([]),
  "tl.kinds": parseAsArrayOf(parseAsStringLiteral(JOURNAL_KINDS)).withDefault(
    [],
  ),
  "tl.watch": watchParser,
};
