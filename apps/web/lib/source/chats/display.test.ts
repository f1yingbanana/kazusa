import { describe, expect, it } from "vitest";
import { actionLine, chatTitle, messagePreview } from "./display";
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
});
