import { describe, expect, it } from "vitest";
import { parseReply } from "./reply";

describe("parseReply", () => {
  it.each<[string, string, "speech" | "action"]>([
    // Wrapped whole: an action, without the asterisks.
    ["*waves*", "waves", "action"],
    ["**waves**", "waves", "action"],
    ["  *waves*  ", "waves", "action"],
    ["* waves *", "waves", "action"],
    [
      "*leans back.\nShe sips her tea.*",
      "leans back.\nShe sips her tea.",
      "action",
    ],
    ["*waves, then sits down.*", "waves, then sits down.", "action"],
    // Plain speech, as typed (trimmed).
    ["Hello there", "Hello there", "speech"],
    ["  Hello there \n", "Hello there", "speech"],
    ["", "", "speech"],
    ["   ", "", "speech"],
    // Asterisks inside a longer message are left alone.
    ["I *really* mean it", "I *really* mean it", "speech"],
    ["*waves* and says hi", "*waves* and says hi", "speech"],
    ["Hi *waves*", "Hi *waves*", "speech"],
    ["*waves* and *smiles*", "*waves* and *smiles*", "speech"],
    // Unbalanced, too many, or nothing inside.
    ["*waves", "*waves", "speech"],
    ["waves*", "waves*", "speech"],
    ["**waves*", "**waves*", "speech"],
    ["*waves**", "*waves**", "speech"],
    ["***waves***", "***waves***", "speech"],
    ["**", "**", "speech"],
    ["* *", "* *", "speech"],
    ["****", "****", "speech"],
    ["*", "*", "speech"],
    ["** **", "** **", "speech"],
  ])("%j → %j (%s)", (typed, text, type) => {
    expect(parseReply(typed, true)).toEqual({ text, type });
  });

  it("reads nothing into a message where actions are not allowed", () => {
    expect(parseReply(" *waves* ", false)).toEqual({
      text: "*waves*",
      type: "speech",
    });
  });
});
