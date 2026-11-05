import { describe, expect, it } from "vitest";
import {
  actionLine,
  chatSubject,
  chatTitle,
  openChatPatch,
  messagePreview,
  messageReceipt,
  receiptLabel,
} from "./display";
import type { Chat } from "./types";

const names: Record<string, string> = {
  "kurimura-airi": "Kurimura Airi",
  "yutori-natsu": "Yutori Natsu",
  kazusa: "Kazusa",
  "user:me": "Sensei",
};
const nameOf = (id: string) => names[id] ?? id;

function chat(patch: Partial<Chat>): Chat {
  return {
    id: "c",
    sessionKey: "chat:direct:x",
    type: "direct",
    name: "",
    members: [],
    ...patch,
  };
}

describe("chatTitle", () => {
  it("names a direct chat after the partner, not their id", () => {
    const dm = chat({ name: "kazusa", members: ["kazusa", "user:me"] });
    expect(chatTitle(dm, "user:me", nameOf)).toBe("Kazusa");
  });

  it("points the inspector at a draft group, or the one person a draft is with", () => {
    const group = chat({
      id: "draft:1",
      type: "group",
      members: ["user:me", "kazusa", "yutori-natsu"],
      draft: true,
    });
    expect(chatSubject(group, "user:me")).toEqual({
      kind: "chat",
      id: "draft:1",
    });
    const talk = chat({
      type: "huddle",
      members: ["user:me", "kazusa"],
      draft: true,
    });
    expect(chatSubject(talk, "user:me")).toEqual({
      kind: "character",
      id: "kazusa",
    });
  });

  it("opens a chat with its subject selected in the same change", () => {
    const dm = chat({ id: "d", members: ["kazusa", "user:me"] });
    expect(openChatPatch(dm, "user:me")).toEqual({
      view: "chats",
      "chats.id": "d",
      sel: "character:kazusa",
    });
    const group = chat({
      id: "group:g",
      type: "group",
      members: ["user:me", "kazusa", "yutori-natsu"],
    });
    expect(openChatPatch(group, "user:me").sel).toBe("chat:group:g");
  });

  it("names a direct chat between two others after both of them", () => {
    const dm = chat({ name: "", members: ["kazusa", "yutori-natsu"] });
    expect(chatTitle(dm, "user:me", nameOf)).toBe("Kazusa & Yutori Natsu");
    expect(chatSubject(dm, "user:me")).toEqual({ kind: "chat", id: "c" });
    expect(
      messagePreview({ text: "hi", senderId: "kazusa" }, dm, "user:me", nameOf),
    ).toBe("Kazusa: hi");
  });

  it("names an untitled huddle after everyone else in it", () => {
    const huddle = chat({
      type: "huddle",
      name: "kurimura-airi",
      members: ["kurimura-airi", "user:me", "yutori-natsu"],
    });
    expect(chatTitle(huddle, "user:me", nameOf)).toBe(
      "Kurimura Airi, Yutori Natsu",
    );
  });

  it("keeps a real title", () => {
    const group = chat({
      type: "group",
      name: "Sweets Club",
      members: ["kazusa", "user:me"],
    });
    expect(chatTitle(group, "user:me", nameOf)).toBe("Sweets Club");
  });
});

describe("actionLine", () => {
  it("supplies the subject", () => {
    expect(actionLine("Kazusa", "leans back. She sips her tea.")).toEqual({
      subject: "Kazusa",
      rest: " leans back. She sips her tea.",
    });
  });

  it("does not double a subject the model wrote anyway", () => {
    expect(actionLine("Kazusa", "Kazusa leans back.")).toEqual({
      subject: "Kazusa",
      rest: " leans back.",
    });
    expect(actionLine("Kurimura Airi", "Airi waves.")).toEqual({
      subject: "Airi",
      rest: " waves.",
    });
    expect(actionLine("Kazusa", "Kazusa's tea goes cold.").rest).toBe(
      "'s tea goes cold.",
    );
  });

  it("does not mistake a longer word for the name", () => {
    expect(actionLine("Ann", "Announces the plan.").rest).toBe(
      " Announces the plan.",
    );
  });

  it("strips roleplay asterisks", () => {
    expect(actionLine("Kazusa", "*leans back.* She sighs.").rest).toBe(
      " leans back. She sighs.",
    );
  });
});

describe("messagePreview", () => {
  const group = chat({
    type: "group",
    name: "Club",
    members: ["kazusa", "user:me"],
  });

  it("attributes group lines and your own", () => {
    const base = { text: "hi", senderName: "x", type: undefined };
    expect(
      messagePreview({ ...base, senderId: "kazusa" }, group, "user:me", nameOf),
    ).toBe("Kazusa: hi");
    expect(
      messagePreview(
        { ...base, senderId: "user:me" },
        group,
        "user:me",
        nameOf,
      ),
    ).toBe("You: hi");
  });

  it("narrates actions in third person, the player's too", () => {
    const action = {
      text: "waves.",
      senderName: "Sensei",
      type: "action" as const,
    };
    expect(
      messagePreview(
        { ...action, senderId: "user:me" },
        group,
        "user:me",
        nameOf,
      ),
    ).toBe("Sensei waves.");
  });

  it("says a sticker is one rather than describing it", () => {
    const sticker = {
      text: "Kazusa, smug, sipping tea",
      senderId: "kazusa",
      type: "sticker" as const,
    };
    expect(messagePreview(sticker, group, "user:me", nameOf)).toBe(
      "Kazusa: Sticker",
    );
    expect(
      messagePreview(
        sticker,
        chat({ type: "direct", members: ["kazusa", "user:me"] }),
        "user:me",
        nameOf,
      ),
    ).toBe("Sticker");
  });
});

describe("messageReceipt", () => {
  const time = (at: number) => `t${at}`;

  it("has none face to face or for people", () => {
    expect(messageReceipt({})).toBeUndefined();
    expect(messageReceipt({ receipts: [] })).toBeUndefined();
  });

  it("is sent until the character reads it", () => {
    const sent = messageReceipt({ receipts: [{ id: "kazusa" }] });
    expect(sent).toEqual({ read: false, readers: [], total: 1 });
    expect(sent && receiptLabel(sent, nameOf, time)).toBe("Sent");
    const read = messageReceipt({ receipts: [{ id: "kazusa", readAt: 5 }] });
    expect(read).toEqual({
      read: true,
      readers: ["kazusa"],
      total: 1,
      readAt: 5,
    });
    expect(read && receiptLabel(read, nameOf, time)).toBe("Read t5");
  });

  it("face to face, says observed", () => {
    const heard = messageReceipt({ receipts: [{ id: "kazusa", readAt: 3 }] });
    expect(heard && receiptLabel(heard, nameOf, time, true)).toBe(
      "Observed by Kazusa t3",
    );
    const some = messageReceipt({
      receipts: [{ id: "kazusa", readAt: 3 }, { id: "yutori-natsu" }],
    });
    expect(some && receiptLabel(some, nameOf, time, true)).toBe(
      "Observed by Kazusa · 1 of 2",
    );
    const none = messageReceipt({ receipts: [{ id: "kazusa" }] });
    expect(none && receiptLabel(none, nameOf, time, true)).toBe(
      "Not observed yet",
    );
  });

  it("in a group, is read once everyone has, as of the last of them", () => {
    const some = messageReceipt({
      receipts: [{ id: "yutori-natsu" }, { id: "kurimura-airi", readAt: 9 }],
    });
    expect(some?.read).toBe(false);
    expect(some && receiptLabel(some, nameOf, time)).toBe(
      "Read by Kurimura Airi · 1 of 2",
    );
    const all = messageReceipt({
      receipts: [
        { id: "yutori-natsu", readAt: 12 },
        { id: "kurimura-airi", readAt: 9 },
      ],
    });
    expect(all).toMatchObject({
      read: true,
      readers: ["kurimura-airi", "yutori-natsu"],
      readAt: 12,
    });
    expect(all && receiptLabel(all, nameOf, time)).toBe("Read by everyone t12");
  });
});
