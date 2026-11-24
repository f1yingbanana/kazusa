import { describe, expect, it, vi } from "vitest";
import { PARTICIPANT_ID } from "../messaging/conversations.ts";
import type { MessageDelivery } from "../messaging/messaging.ts";
import {
  Bridge,
  guestId,
  guestName,
  MISSING_GROUP,
  type BridgeDeps,
  type BridgeTransport,
  type ChannelCheck,
  type IncomingLine,
  type LinkedPerson,
  type OutgoingLine,
  type PlatformAccount,
  type TransportHandlers,
} from "./bridge.ts";

function fakeTransport(
  options: { fail?: string; problems?: Map<string, string> } = {},
) {
  let handlers: TransportHandlers | undefined;
  const posts: [string, OutgoingLine][] = [];
  const transport: BridgeTransport = {
    start: vi.fn(async (given: TransportHandlers) => {
      if (options.fail) throw new Error(options.fail);
      handlers = given;
      return { name: "Kazusa Bot" };
    }),
    post: vi.fn(async (channelId: string, line: OutgoingLine) => {
      posts.push([channelId, line]);
    }),
    remove: vi.fn(async () => {}),
    typing: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    check: vi.fn(async (channelId: string): Promise<ChannelCheck> => {
      const problem = options.problems?.get(channelId);
      return {
        name: "schale-office",
        server: "Kivotos",
        ...(problem ? { problem } : {}),
      };
    }),
  };
  return {
    transport,
    posts,
    write: (line: IncomingLine) => handlers?.line(line),
    link: (code: string, account: PlatformAccount) =>
      handlers?.link(code, account) ?? Promise.resolve(""),
  };
}

function setup() {
  const postAsGuest = vi.fn<BridgeDeps["postAsGuest"]>(async () => "id");
  const postAsCharacter = vi.fn<BridgeDeps["postAsCharacter"]>(
    async () => "id",
  );
  const linkAccount = vi.fn<BridgeDeps["linkAccount"]>(async () => {});
  const people = new Map<string, LinkedPerson>();
  const chats = new Set(["group:office"]);
  const warn = vi.fn();
  const bridge = new Bridge({
    postAsGuest,
    postAsCharacter,
    linkAccount,
    personOf: async (accountId) => people.get(accountId),
    chatExists: async (chatId) => chats.has(chatId),
    avatarOf: (agentId, face) => `https://pics/${agentId}/${face ?? "rest"}`,
    stickerOf: (agentId, name) => `https://pics/${agentId}/stickers/${name}`,
    warn,
  });
  bridge.setLinks(
    new Map([["group:office", { platform: "discord", channelId: "111" }]]),
  );
  return {
    bridge,
    postAsGuest,
    postAsCharacter,
    linkAccount,
    people,
    chats,
    warn,
  };
}

function delivery(
  overrides: Omit<Partial<MessageDelivery>, "params"> & {
    params?: Partial<MessageDelivery["params"]>;
  } = {},
): MessageDelivery {
  const { params, ...rest } = overrides;
  return {
    id: "m1",
    sequence: 1,
    sender: "hina-sorasaki",
    senderName: "Hina",
    chatId: "group:office",
    audience: ["hina-sorasaki"],
    timestamp: 0,
    copies: [],
    ...rest,
    params: {
      sessionKey: "chat:group:office",
      text: "SCHALE office, Hina speaking.",
      requestId: "r1",
      title: null,
      ...params,
    },
  };
}

describe("Bridge", () => {
  it("takes in what people write in a linked channel as guests, and nothing else", async () => {
    const h = setup();
    const discord = fakeTransport();
    await h.bridge.connect(discord.transport);
    expect(h.bridge.status).toEqual({ state: "connected", name: "Kazusa Bot" });

    discord.write({
      channelId: "111",
      messageId: "900",
      author: { id: "42", name: "`Sensei` [bot]\nfan" },
      text: "  Is anyone on duty?  ",
    });
    discord.write({
      channelId: "222",
      messageId: "901",
      author: { id: "42", name: "Fan" },
      text: "Not linked",
    });
    discord.write({
      channelId: "111",
      messageId: "902",
      author: { id: "42", name: "Fan" },
      text: "   ",
    });
    await vi.waitFor(() => expect(h.postAsGuest).toHaveBeenCalled());
    expect(h.postAsGuest.mock.calls).toEqual([
      [
        {
          chatId: "group:office",
          guest: "guest:discord-21iy4g9bqg",
          name: "Sensei bot fan",
          text: "Is anyone on duty?",
          requestId: "discord:900",
        },
      ],
    ]);
  });

  it("shows the group's lines in the channel as their speakers, once each, in order", async () => {
    const h = setup();
    const discord = fakeTransport();
    await h.bridge.connect(discord.transport);

    const said = delivery();
    h.bridge.outgoing({ type: "message", delivery: said });
    // Another instance emitting the same message posts nothing more.
    h.bridge.outgoing({ type: "message", delivery: said });
    h.bridge.outgoing({
      type: "message",
      delivery: delivery({
        id: "m2",
        params: { text: "signs in", type: "action", face: { name: "annoyed" } },
      }),
    });
    h.bridge.outgoing({
      type: "message",
      delivery: delivery({
        id: "m3",
        params: {
          text: "",
          type: "sticker",
          sticker: { name: "happy", v: "1" },
        },
      }),
    });
    // A guest's own line is already in the channel; an unlinked chat isn't shown.
    h.bridge.outgoing({
      type: "message",
      delivery: delivery({ id: "m4", sender: "guest:discord-21iy4g9bqg" }),
    });
    h.bridge.outgoing({
      type: "message",
      delivery: delivery({ id: "m5", chatId: "group:elsewhere" }),
    });
    await h.bridge.settled();
    expect(discord.posts).toEqual([
      [
        "111",
        {
          name: "Hina",
          avatarUrl: "https://pics/hina-sorasaki/rest",
          text: "SCHALE office, Hina speaking.",
        },
      ],
      [
        "111",
        {
          name: "Hina",
          avatarUrl: "https://pics/hina-sorasaki/annoyed",
          text: "*signs in*",
        },
      ],
      [
        "111",
        {
          name: "Hina",
          avatarUrl: "https://pics/hina-sorasaki/rest",
          text: "https://pics/hina-sorasaki/stickers/happy",
        },
      ],
    ]);
  });

  it("posts nothing while disconnected, and says why a connection failed", async () => {
    const h = setup();
    h.bridge.outgoing({ type: "message", delivery: delivery() });
    const broken = fakeTransport({ fail: "Discord refused the token." });
    await h.bridge.connect(broken.transport);
    expect(h.bridge.status).toEqual({
      state: "failed",
      error: "Error: Discord refused the token.",
    });
    expect(broken.transport.stop).toHaveBeenCalled();
    h.bridge.outgoing({ type: "message", delivery: delivery({ id: "m9" }) });
    await h.bridge.settled();
    expect(broken.posts).toEqual([]);
  });

  it("says what stops a link working, and when it works again", async () => {
    const h = setup();
    const blind =
      "The bot can't see this channel, so nothing written there reaches the group.";
    const problems = new Map([["111", blind]]);
    const discord = fakeTransport({ problems });
    // Nothing connected: nothing to tell.
    expect(h.bridge.checkOf("group:office")).toBeUndefined();
    await h.bridge.connect(discord.transport);
    expect(h.bridge.checkOf("group:office")).toEqual({
      name: "schale-office",
      server: "Kivotos",
      problem: blind,
    });
    expect(h.warn).toHaveBeenCalledWith(expect.stringContaining(blind));

    // Fixed in Discord: a recent answer stands until it's old enough.
    problems.clear();
    await h.bridge.checkLinks(60_000);
    expect(h.bridge.checkOf("group:office")?.problem).toBe(blind);
    await h.bridge.checkLinks(0);
    expect(h.bridge.checkOf("group:office")).toEqual({
      name: "schale-office",
      server: "Kivotos",
    });

    await h.bridge.disconnect();
    expect(h.bridge.checkOf("group:office")).toBeUndefined();
    await expect(h.bridge.checkChannel("111")).rejects.toThrow("Connect a bot");
  });

  it("says a linked person's line as whoever they play, and takes theirs down", async () => {
    const h = setup();
    const discord = fakeTransport();
    await h.bridge.connect(discord.transport);
    h.people.set("42", {
      person: "user:sensei",
      actor: { id: "sensei", name: "Sensei" },
    });
    discord.write({
      channelId: "111",
      messageId: "900",
      author: { id: "42", name: "Flying_Banana" },
      text: "I'm here.",
    });
    await vi.waitFor(() =>
      expect(discord.transport.remove).toHaveBeenCalledWith("111", "900"),
    );
    expect(h.postAsCharacter).toHaveBeenCalledWith({
      chatId: "group:office",
      actor: { id: "sensei", name: "Sensei" },
      text: "I'm here.",
      requestId: "discord:900",
    });
    expect(h.postAsGuest).not.toHaveBeenCalled();

    // Their message can't come down: the link says what to allow.
    vi.mocked(discord.transport.remove).mockRejectedValueOnce(
      Object.assign(new Error("Missing Permissions"), { status: 403 }),
    );
    discord.write({
      channelId: "111",
      messageId: "901",
      author: { id: "42", name: "Flying_Banana" },
      text: "Again.",
    });
    await vi.waitFor(() =>
      expect(h.bridge.checkOf("group:office")?.problem).toContain(
        "Manage Messages",
      ),
    );

    // Watching, they play nobody: nothing is said, and nothing comes down.
    h.people.set("42", { person: "user:sensei" });
    discord.write({
      channelId: "111",
      messageId: "902",
      author: { id: "42", name: "Flying_Banana" },
      text: "Hello?",
    });
    await vi.waitFor(() =>
      expect(h.warn).toHaveBeenCalledWith(
        expect.stringContaining("while watching"),
      ),
    );
    expect(h.postAsCharacter).toHaveBeenCalledTimes(2);
    expect(h.postAsGuest).not.toHaveBeenCalled();
  });

  it("links an account with a fresh code, once, and nothing else", async () => {
    const h = setup();
    const discord = fakeTransport();
    await h.bridge.connect(discord.transport);
    const fan = { id: "42", name: "Flying_Banana" };

    const first = h.bridge.makeCode("user:sensei");
    expect(first.code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    // A new code replaces the person's last one.
    const { code } = h.bridge.makeCode("user:sensei");
    expect(await discord.link(first.code, fan)).toContain("isn't one");
    expect(await discord.link(` ${code.toLowerCase()} `, fan)).toContain(
      "Linked",
    );
    expect(h.linkAccount).toHaveBeenCalledExactlyOnceWith("user:sensei", fan);
    // Used once.
    expect(await discord.link(code, fan)).toContain("isn't one");

    vi.useFakeTimers();
    try {
      const late = h.bridge.makeCode("user:sensei");
      vi.advanceTimersByTime(10 * 60_000 + 1);
      expect(await discord.link(late.code, fan)).toContain("ten minutes");
    } finally {
      vi.useRealTimers();
    }
    expect(h.linkAccount).toHaveBeenCalledTimes(1);
  });

  it("says a link's group is gone, and takes in nothing for it", async () => {
    const h = setup();
    h.chats.clear();
    const discord = fakeTransport();
    await h.bridge.connect(discord.transport);
    expect(h.bridge.checkOf("group:office")).toEqual({
      name: "schale-office",
      server: "Kivotos",
      problem: MISSING_GROUP,
    });
    discord.write({
      channelId: "111",
      messageId: "900",
      author: { id: "42", name: "Fan" },
      text: "Hello?",
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(h.postAsGuest).not.toHaveBeenCalled();
  });

  it("shows the bot typing while anyone in the group types, and stops", async () => {
    const h = setup();
    const discord = fakeTransport();
    await h.bridge.connect(discord.transport);
    const typing = (
      senderId: string,
      isTyping: boolean,
      mode: "typing" | "speaking" = "typing",
      chatId = "group:office",
    ) =>
      h.bridge.outgoing({
        type: "typing",
        audience: [],
        typing: {
          type: "typing",
          chatId,
          senderId,
          senderName: senderId,
          isTyping,
          mode,
        },
      });
    vi.useFakeTimers();
    try {
      // Said aloud, a guest, or another chat: nothing shows.
      typing("hina", true, "speaking");
      typing("guest:discord-21iy4g9bqg", true);
      typing("hina", true, "typing", "group:elsewhere");
      expect(discord.transport.typing).not.toHaveBeenCalled();

      typing("hina", true);
      typing("yuuka", true);
      expect(discord.transport.typing).toHaveBeenCalledExactlyOnceWith("111");
      // Shown again before Discord's ten seconds run out.
      vi.advanceTimersByTime(8_000);
      expect(discord.transport.typing).toHaveBeenCalledTimes(2);
      typing("hina", false);
      vi.advanceTimersByTime(8_000);
      expect(discord.transport.typing).toHaveBeenCalledTimes(3);
      // Nobody typing: it lapses.
      typing("yuuka", false);
      vi.advanceTimersByTime(30_000);
      expect(discord.transport.typing).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps a failed post from stopping the ones after it", async () => {
    const h = setup();
    const discord = fakeTransport();
    vi.mocked(discord.transport.post).mockRejectedValueOnce(new Error("429"));
    await h.bridge.connect(discord.transport);
    h.bridge.outgoing({ type: "message", delivery: delivery() });
    h.bridge.outgoing({ type: "message", delivery: delivery({ id: "m2" }) });
    await h.bridge.settled();
    expect(h.warn).toHaveBeenCalledWith(expect.stringContaining("429"));
    expect(discord.transport.post).toHaveBeenCalledTimes(2);
  });
});

describe("guestId", () => {
  it("is short, the same for one account every time, and a valid participant", () => {
    expect(guestId("discord", "42")).toBe("guest:discord-21iy4g9bqg");
    expect(guestId("discord", "42")).toBe(guestId("discord", "42"));
    expect(guestId("discord", "43")).not.toBe(guestId("discord", "42"));
    expect(
      PARTICIPANT_ID.parse(guestId("discord", "212557115179532288")),
    ).toMatch(/^guest:discord-[0-9a-z]{10}$/);
  });
});

describe("guestName", () => {
  it("keeps a name to one plain line of at most 32 characters", () => {
    expect(guestName("  Nice\n\nname  ")).toBe("Nice name");
    expect(guestName("Flying_Banana*~|")).toBe("Flying_Banana*~|");
    expect(guestName("```")).toBe("Someone");
    expect(guestName("x".repeat(40))).toHaveLength(32);
  });
});
