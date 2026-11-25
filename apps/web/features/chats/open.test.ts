import { describe, expect, it } from "vitest";
import type { ChatInfo } from "@/lib/source/chats/types";
import { conversationPatch } from "./open";

const chat = (type: ChatInfo["type"], members: string[]): ChatInfo => ({
  id: `${type}:1`,
  name: "",
  type,
  members,
});

describe("conversationPatch", () => {
  it("opens texts in Chats, pointing the panel at a DM's partner", () => {
    expect(conversationPatch(chat("direct", ["me", "airi"]), "me")).toEqual({
      view: "chats",
      "chats.id": "direct:1",
      "world.talk": null,
      sel: { kind: "character", id: "airi" },
    });
    expect(
      conversationPatch(chat("group", ["me", "airi", "noa"]), "me").sel,
    ).toEqual({ kind: "chat", id: "group:1" });
  });

  it("opens a talk face to face in World, over the map", () => {
    expect(conversationPatch(chat("huddle", ["me", "a", "b"]), "me")).toEqual({
      view: "world",
      "chats.id": null,
      "world.talk": "huddle:1",
      sel: { kind: "chat", id: "huddle:1" },
    });
  });
});
