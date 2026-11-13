import { describe, expect, it } from "vitest";

import { heardAs, readAs, written } from "./conversations.ts";

describe("written", () => {
  it("takes a bubble wholly inside asterisks as an action, in person", () => {
    expect(written("*sets the bag down*")).toEqual({
      text: "sets the bag down",
      type: "action",
    });
    expect(written("  *waves*\n")).toEqual({ text: "waves", type: "action" });
    // The item is the action, whatever is inside it.
    expect(written('*renames the chat to "*cool*"*')).toEqual({
      text: 'renames the chat to "*cool*"',
      type: "action",
    });
    // By text nothing is done: it is sent as typed.
    expect(written("*sighs*", [], false)).toEqual({ text: "*sighs*" });
  });

  it("takes a face tag opening a bubble as its face, and never says it", () => {
    const moods = ["annoyed", "wide-eyed"];
    expect(written("[face=annoyed] I said no.", moods)).toEqual({
      text: "I said no.",
      face: "annoyed",
    });
    expect(written("[face=wide_eyed] *steps back*", moods)).toEqual({
      text: "steps back",
      type: "action",
      face: "wide-eyed",
    });
    // Someone else's mood: nothing to show, and still not said.
    expect(written("[face=smug] Fine.", moods)).toEqual({ text: "Fine." });
  });

  it("takes a bubble that is only a sticker tag as a sticker", () => {
    expect(written("[sticker=maid-happy]")).toEqual({ sticker: "maid-happy" });
    expect(written("[sticker=maid_happy]")).toEqual({ sticker: "maid-happy" });
  });

  it("keeps anything else as speech, as typed", () => {
    for (const text of [
      "I *really* mean it.",
      "*waves* Hey!",
      "Rule three? *tucks the pouch tighter*",
      "**No.**",
      "*",
      "(annoyed) I said no.",
      "I said [face=annoyed] no.",
      "lol [sticker=laughing]",
      "[face=annoyed]",
      "[type=action] waves",
    ])
      expect(written(text, ["annoyed"])).toEqual({ text });
  });

  it("reads back what characters are shown", () => {
    const action = { text: "sets the bag down", type: "action" } as const;
    expect(written(readAs(action))).toEqual(action);
    expect(readAs({ text: "Hi." })).toBe("Hi.");
    const heard = heardAs({
      ...action,
      face: { name: "calm", seen: "[face=calm]" },
    });
    expect(heard).toBe("[face=calm] *sets the bag down*");
    expect(written(heard, ["calm"])).toEqual({ ...action, face: "calm" });
    const sticker = readAs({
      text: "Alice, laughing",
      type: "sticker",
      sticker: { name: "laughing", v: "abc" },
    });
    expect(sticker).toBe("[sticker=laughing]");
    expect(written(sticker)).toEqual({ sticker: "laughing" });
  });
});
