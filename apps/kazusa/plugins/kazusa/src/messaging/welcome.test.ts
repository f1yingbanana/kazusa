import { describe, expect, it, vi } from "vitest";
import { sendWelcome } from "./welcome.ts";

const welcome = {
  agentId: "arona",
  agentName: "ARONA",
  userId: "user:player",
  messages: ["Welcome!", "Ask me anything."],
  agents: new Set(["arona"]),
};

function fakeMessaging(chats: readonly { kind: string }[]) {
  return {
    listChats: vi.fn(async () => chats),
    speak: vi.fn(async () => ({})),
  } as unknown as Parameters<typeof sendWelcome>[0] & {
    speak: ReturnType<typeof vi.fn>;
    listChats: ReturnType<typeof vi.fn>;
  };
}

describe("sendWelcome", () => {
  it("opens the direct chat with the world's words", async () => {
    const messaging = fakeMessaging([]);
    await sendWelcome(messaging, welcome);
    expect(messaging.listChats).toHaveBeenCalledWith("arona", {
      query: "user:player",
    });
    expect(messaging.speak).toHaveBeenCalledWith(
      "arona",
      "ARONA",
      {
        members: ["user:player"],
        messages: ["Welcome!", "Ask me anything."],
        requestId: "welcome",
      },
      undefined,
      welcome.agents,
      "arona",
    );
  });

  it("says nothing once that chat exists", async () => {
    const messaging = fakeMessaging([{ kind: "direct" }]);
    await sendWelcome(messaging, welcome);
    expect(messaging.speak).not.toHaveBeenCalled();
  });

  it("isn't put off by a group the player shares", async () => {
    const messaging = fakeMessaging([{ kind: "group" }]);
    await sendWelcome(messaging, welcome);
    expect(messaging.speak).toHaveBeenCalledOnce();
  });
});
