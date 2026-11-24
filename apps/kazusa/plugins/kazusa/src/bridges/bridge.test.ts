import { describe, expect, it, vi } from "vitest";
import { PARTICIPANT_ID } from "../messaging/conversations.ts";
import type { MessageDelivery } from "../messaging/messaging.ts";
import {
  Bridge,
  guestId,
  guestName,
  type BridgeDeps,
  type BridgeTransport,
  type IncomingLine,
  type OutgoingLine,
} from "./bridge.ts";

function fakeTransport(
  options: { fail?: string; problems?: Map<string, string> } = {},
) {
  let onLine: ((line: IncomingLine) => void) | undefined;
  const posts: [string, OutgoingLine][] = [];
  const transport: BridgeTransport = {
    start: vi.fn(async (listener: (line: IncomingLine) => void) => {
      if (options.fail) throw new Error(options.fail);
      onLine = listener;
      return { name: "Kazusa Bot" };
    }),
    post: vi.fn(async (channelId: string, line: OutgoingLine) => {
      posts.push([channelId, line]);
    }),
    stop: vi.fn(async () => {}),
    check: vi.fn(async (channelId: string) => options.problems?.get(channelId)),
  };
  return { transport, posts, write: (line: IncomingLine) => onLine?.(line) };
}

function setup() {
  const postAsGuest = vi.fn<BridgeDeps["postAsGuest"]>(async () => "id");
  const warn = vi.fn();
  const bridge = new Bridge({
    postAsGuest,
    avatarOf: (agentId, face) => `https://pics/${agentId}/${face ?? "rest"}`,
    stickerOf: (agentId, name) => `https://pics/${agentId}/stickers/${name}`,
    warn,
  });
  bridge.setLinks(
    new Map([["group:office", { platform: "discord", channelId: "111" }]]),
  );
  return { bridge, postAsGuest, warn };
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
          guest: "guest:21iy4g9bqg",
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
      delivery: delivery({ id: "m4", sender: "guest:21iy4g9bqg" }),
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
    expect(h.bridge.problemOf("group:office")).toBeUndefined();
    await h.bridge.connect(discord.transport);
    expect(h.bridge.problemOf("group:office")).toBe(blind);
    expect(h.warn).toHaveBeenCalledWith(expect.stringContaining(blind));

    // Fixed in Discord: a recent answer stands until it's old enough.
    problems.clear();
    await h.bridge.checkLinks(60_000);
    expect(h.bridge.problemOf("group:office")).toBe(blind);
    await h.bridge.checkLinks(0);
    expect(h.bridge.problemOf("group:office")).toBeUndefined();

    await h.bridge.disconnect();
    expect(h.bridge.problemOf("group:office")).toBeUndefined();
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
    expect(guestId("discord", "42")).toBe("guest:21iy4g9bqg");
    expect(guestId("discord", "42")).toBe(guestId("discord", "42"));
    expect(guestId("discord", "43")).not.toBe(guestId("discord", "42"));
    expect(
      PARTICIPANT_ID.parse(guestId("discord", "212557115179532288")),
    ).toMatch(/^guest:[0-9a-z]{10}$/);
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
