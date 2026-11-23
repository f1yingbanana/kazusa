import { describe, expect, it } from "vitest";
import { chatSections, liveliestChat } from "./sections";
import type { ChatInfo } from "./types";

const chat = (id: string, type: ChatInfo["type"], ended = false): ChatInfo => ({
  id,
  type,
  name: id,
  members: ["alice", "bob"],
  ...(ended ? { ended } : {}),
});

describe("chatSections", () => {
  it("puts talking in person first, then texts, then talks that are over", () => {
    const sections = chatSections([
      chat("dm-1", "direct"),
      chat("old-talk", "huddle", true),
      chat("talk-1", "huddle"),
      chat("group-1", "group"),
      chat("talk-2", "huddle"),
    ]);
    expect(
      sections.map((section) => [
        section.label,
        section.chats.map((each) => each.id),
      ]),
    ).toEqual([
      ["In person", ["talk-1", "talk-2"]],
      ["Messages", ["dm-1", "group-1"]],
      ["Earlier in person", ["old-talk"]],
    ]);
  });

  it("leaves out a section with nothing in it", () => {
    expect(chatSections([chat("dm-1", "direct")]).map(({ id }) => id)).toEqual([
      "messages",
    ]);
    expect(chatSections([])).toEqual([]);
  });
});

describe("liveliestChat", () => {
  const chats = [
    chat("dm-new", "direct"),
    chat("old-talk", "huddle", true),
    chat("talk", "huddle"),
    chat("dm-old", "direct"),
  ];

  it("prefers where someone is speaking or typing now, in person first", () => {
    expect(liveliestChat(chats, new Set(["dm-old", "talk"]))?.id).toBe("talk");
    expect(liveliestChat(chats, new Set(["dm-old"]))?.id).toBe("dm-old");
  });

  it("else people talking in person, else the latest thing said", () => {
    expect(liveliestChat(chats, new Set())?.id).toBe("talk");
    expect(liveliestChat([chats[0], chats[1], chats[3]], new Set())?.id).toBe(
      "dm-new",
    );
  });

  it("shows a talk that is over only when there is nothing else", () => {
    expect(liveliestChat([chats[1]], new Set(["old-talk"]))?.id).toBe(
      "old-talk",
    );
    expect(liveliestChat([], new Set())).toBeUndefined();
  });
});
