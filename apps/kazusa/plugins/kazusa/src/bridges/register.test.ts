import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { Readable } from "node:stream";
import {
  BridgeLinkCodeResponseSchema,
  BridgesResponseSchema,
} from "@kazusa/client";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Messaging, MessagingEvent } from "../messaging/messaging.ts";
import type { ProviderKeys } from "../providers/keys.ts";
import { createUserSettings, type UserSettings } from "../user-settings.ts";
import type {
  BridgeLink,
  BridgeTransport,
  IncomingLine,
  PlatformAccount,
  TransportHandlers,
} from "./bridge.ts";
import { registerBridges, resetSharedBridge } from "./register.ts";

type Handler = (req: unknown, res: unknown) => Promise<boolean>;

afterEach(() => resetSharedBridge());

function setup() {
  const config = { gateway: { auth: { token: "test-service-token" } } };
  const routes: Record<string, Handler> = {};
  const starts: ((
    event: unknown,
    ctx: { abortSignal?: AbortSignal },
  ) => void)[] = [];
  const tokens = new Map<string, string>();
  const keys: ProviderKeys = {
    has: (id) => tokens.has(id),
    read: (id) => tokens.get(id),
    save: async (id, key) => void tokens.set(id, key),
    remove: async (id) => void tokens.delete(id),
  };
  const links = new Map<string, BridgeLink>();
  let playing: { id: string; name: string } | undefined = {
    id: "sensei",
    name: "Sensei",
  };
  const settingsRows = new Map<string, UserSettings>();
  const settingsStore = {
    lookup: async (key: string) => settingsRows.get(key),
    register: async (key: string, value: UserSettings) =>
      void settingsRows.set(key, value),
    delete: async (key: string) => settingsRows.delete(key),
    entries: async () =>
      [...settingsRows].map(([key, value]) => ({ key, value, createdAt: 0 })),
  };
  const store = {
    lookup: async (key: string) => links.get(key),
    register: async (key: string, value: BridgeLink) =>
      void links.set(key, value),
    delete: async (key: string) => links.delete(key),
    entries: async () =>
      [...links].map(([key, value]) => ({ key, value, createdAt: 0 })),
  };
  let listener: ((event: MessagingEvent) => void) | undefined;
  const members = new Map<string, string[]>();
  const messaging = {
    postAsGuest: vi.fn(async () => "id"),
    membersOf: vi.fn(async (chatId: string) => members.get(chatId) ?? []),
    hasChat: vi.fn(async (chatId: string) => chatId !== "group:gone"),
    manageChat: vi.fn(
      async (agentId: string, input: { sessionKey: string }) => {
        const chatId = `group:${input.sessionKey.split(":").at(-1)}`;
        if (chatId === "group:closed")
          throw new Error("That chat isn't open to join, so this did not run.");
        members.set(chatId, [...(members.get(chatId) ?? []), agentId]);
        return {};
      },
    ),
    send: vi.fn(async () => ({})),
    onAnyEvent: (next: (event: MessagingEvent) => void) => {
      listener = next;
      return () => (listener = undefined);
    },
  };
  let handlers: TransportHandlers | undefined;
  const removed: string[] = [];
  const undelivered: [string, string | undefined][] = [];
  const transport = vi.fn((token: string): BridgeTransport => ({
    start: async (given) => {
      if (token !== "good") throw new Error("Discord refused the token.");
      handlers = given;
      return { name: "Office Bot" };
    },
    post: async () => {},
    remove: async (_channelId, messageId) => void removed.push(messageId),
    typing: async () => {},
    markUndelivered: async (line, reason) =>
      void undelivered.push([line.messageId, reason]),
    stop: async () => {},
    check: async (channelId) =>
      channelId === "333"
        ? { problem: "The bot can't see this channel." }
        : { name: `channel-${channelId}`, server: "Kivotos" },
  }));
  registerBridges(
    {
      config,
      runtime: {
        config: { current: () => config },
        agent: { resolveAgentWorkspaceDir: () => "/nowhere" },
      },
      logger: { warn: vi.fn() },
      on: (name: string, handler: (typeof starts)[number]) => {
        if (name === "gateway_start") starts.push(handler);
      },
      registerHttpRoute: (route: { path: string; handler: Handler }) => {
        routes[route.path] = route.handler;
      },
    } as unknown as OpenClawPluginApi,
    {
      messaging: messaging as unknown as Messaging,
      player: {
        operator: { id: "user:sensei", name: "Sensei" },
        playing: async () => playing,
      },
      userSettings: createUserSettings(settingsStore),
      roster: () => new Set(["sensei", "hina"]),
      keys,
      transport,
      store,
      world: "/nowhere",
    },
  );

  const call = async (route: string, body?: unknown) => {
    const req = Readable.from(
      body === undefined ? [] : [Buffer.from(JSON.stringify(body))],
    ) as unknown as IncomingMessage;
    Object.assign(req, {
      method: body === undefined ? "GET" : "POST",
      headers: { authorization: "Bearer test-service-token" },
      url: route,
      socket: new Socket(),
    });
    const res = new ServerResponse(req);
    let text = "";
    res.write = ((chunk: string) => ((text += chunk), true)) as never;
    res.end = ((chunk?: string) => {
      if (chunk) text += chunk;
      return res;
    }) as never;
    await routes[route](req, res);
    return { status: res.statusCode, body: JSON.parse(text) as unknown };
  };
  return {
    call,
    tokens,
    links,
    messaging,
    starts,
    write: (line: IncomingLine) => handlers?.line(line),
    link: (code: string, account: PlatformAccount) =>
      handlers?.link(code, account) ?? Promise.resolve(""),
    watch: () => (playing = undefined),
    removed,
    undelivered,
    members,
    settingsRows,
    listening: () => listener !== undefined,
  };
}

describe("registerBridges", () => {
  it("connects with a saved token, says when Discord refuses one, and never sends it back", async () => {
    const h = setup();
    expect(h.listening()).toBe(true);
    const off = await h.call("/kazusa/bridges");
    expect(BridgesResponseSchema.parse(off.body)).toEqual({
      discord: { hasToken: false, status: { state: "off" } },
      links: [],
    });

    const bad = await h.call("/kazusa/bridges/token", { token: "bad" });
    expect(BridgesResponseSchema.parse(bad.body).discord).toEqual({
      hasToken: true,
      status: { state: "failed", error: "Error: Discord refused the token." },
    });
    const good = await h.call("/kazusa/bridges/token", { token: "good" });
    expect(good.body).toEqual({
      discord: {
        hasToken: true,
        status: { state: "connected", name: "Office Bot" },
      },
      links: [],
    });
    expect(JSON.stringify(good.body)).not.toContain('good"');

    const removed = await h.call("/kazusa/bridges/token", { token: null });
    expect(removed.body).toMatchObject({
      discord: { hasToken: false, status: { state: "off" } },
    });
  });

  it("links one group to one channel, and takes in what is written there", async () => {
    const h = setup();
    h.tokens.set("discord", "good");
    h.links.set("group:office", { platform: "discord", channelId: "111" });
    for (const start of h.starts) start({}, {});
    await vi.waitFor(async () =>
      expect((await h.call("/kazusa/bridges")).body).toMatchObject({
        discord: { status: { state: "connected" } },
        links: [
          { chatId: "group:office", platform: "discord", channelId: "111" },
        ],
      }),
    );

    h.write({
      channelId: "111",
      messageId: "1",
      author: { id: "42", name: "Fan" },
      text: "Hello?",
    });
    await vi.waitFor(() =>
      expect(h.messaging.postAsGuest).toHaveBeenCalledWith(
        expect.objectContaining({
          chatId: "group:office",
          guest: "guest:discord-21iy4g9bqg",
        }),
      ),
    );

    const taken = await h.call("/kazusa/bridges/link", {
      chatId: "group:other",
      channelId: "111",
    });
    expect(taken.status).toBeGreaterThanOrEqual(400);
    const gone = await h.call("/kazusa/bridges/link", {
      chatId: "group:gone",
      channelId: "444",
    });
    expect(gone).toEqual({
      status: 400,
      body: { error: "That chat isn't in this world." },
    });
    // A conversation in person ends, and nobody on Discord is there.
    const huddle = await h.call("/kazusa/bridges/link", {
      chatId: "huddle:abc",
      channelId: "222",
    });
    expect(huddle).toEqual({
      status: 400,
      body: { error: "Only a group or a direct chat can be linked." },
    });

    const moved = await h.call("/kazusa/bridges/link", {
      chatId: "group:office",
      channelId: "222",
    });
    expect(moved.body).toMatchObject({
      links: [{ chatId: "group:office", channelId: "222" }],
    });
    // A channel the bot can't see is refused with why, and the link stays.
    const hidden = await h.call("/kazusa/bridges/link", {
      chatId: "group:office",
      channelId: "333",
    });
    expect(hidden).toEqual({
      status: 400,
      body: { error: "The bot can't see this channel." },
    });
    expect((await h.call("/kazusa/bridges")).body).toMatchObject({
      links: [
        {
          chatId: "group:office",
          channelId: "222",
          channelName: "channel-222",
          server: "Kivotos",
        },
      ],
    });
    const unlinked = await h.call("/kazusa/bridges/link", {
      chatId: "group:office",
      channelId: null,
    });
    expect(unlinked.body).toMatchObject({ links: [] });
  });

  it("links a person's own Discord account, and says what they write as whoever they play", async () => {
    const h = setup();
    expect((await h.call("/kazusa/bridges/account")).body).toEqual({
      account: null,
      bot: null,
    });
    // No bot to send a code to yet.
    expect((await h.call("/kazusa/bridges/account/code", {})).status).toBe(400);

    h.tokens.set("discord", "good");
    h.links.set("group:office", { platform: "discord", channelId: "111" });
    for (const start of h.starts) start({}, {});
    await vi.waitFor(async () =>
      expect((await h.call("/kazusa/bridges/account")).body).toMatchObject({
        bot: "Office Bot",
      }),
    );
    const made = await h.call("/kazusa/bridges/account/code", {});
    const { code } = BridgeLinkCodeResponseSchema.parse(made.body);
    const fan = { id: "42", name: "Flying_Banana" };
    expect(await h.link(code, fan)).toContain("Linked");
    expect((await h.call("/kazusa/bridges/account")).body).toMatchObject({
      account: { name: "Flying_Banana" },
    });

    // Their line is said as Sensei, who joins the open group first.
    h.write({
      channelId: "111",
      messageId: "900",
      author: fan,
      text: "On my way.",
    });
    await vi.waitFor(() => expect(h.removed).toEqual(["900"]));
    expect(h.messaging.manageChat).toHaveBeenCalledWith(
      "sensei",
      { action: "join", sessionKey: "chat:group:office" },
      undefined,
      new Set(["sensei", "hina"]),
    );
    expect(h.messaging.send).toHaveBeenCalledWith(
      "sensei",
      "Sensei",
      {
        sessionKey: "chat:group:office",
        text: "On my way.",
        requestId: "discord:900",
      },
      undefined,
      new Set(["sensei", "hina"]),
      true,
    );
    expect(h.messaging.postAsGuest).not.toHaveBeenCalled();

    const unlinked = await h.call("/kazusa/bridges/account/unlink", {});
    expect(unlinked.body).toMatchObject({ account: null });
    expect(h.settingsRows.size).toBe(0);
    // Unlinked, they write as a guest again.
    h.write({ channelId: "111", messageId: "901", author: fan, text: "Hi." });
    await vi.waitFor(() =>
      expect(h.messaging.postAsGuest).toHaveBeenCalledWith(
        expect.objectContaining({ requestId: "discord:901" }),
      ),
    );
  });

  it("links a direct chat: only a linked account speaks into it", async () => {
    const h = setup();
    h.tokens.set("discord", "good");
    h.links.set("direct:dm", { platform: "discord", channelId: "555" });
    h.members.set("direct:dm", ["hina", "sensei"]);
    for (const start of h.starts) start({}, {});
    await vi.waitFor(async () =>
      expect((await h.call("/kazusa/bridges/account")).body).toMatchObject({
        bot: "Office Bot",
      }),
    );
    const { code } = BridgeLinkCodeResponseSchema.parse(
      (await h.call("/kazusa/bridges/account/code", {})).body,
    );
    await h.link(code, { id: "42", name: "Flying_Banana" });

    // Someone else in the channel: a direct chat is two people's.
    h.write({
      channelId: "555",
      messageId: "1",
      author: { id: "77", name: "Stranger" },
      text: "Hi?",
    });
    h.write({
      channelId: "555",
      messageId: "2",
      author: { id: "42", name: "Flying_Banana" },
      text: "Hina, are you free?",
    });
    await vi.waitFor(() =>
      expect(h.messaging.send).toHaveBeenCalledWith(
        "sensei",
        "Sensei",
        {
          sessionKey: "chat:direct:hina",
          text: "Hina, are you free?",
          requestId: "discord:2",
        },
        undefined,
        new Set(["sensei", "hina"]),
        true,
      ),
    );
    expect(h.messaging.postAsGuest).not.toHaveBeenCalled();
    expect(h.messaging.manageChat).not.toHaveBeenCalled();
  });

  it("marks a line that can't be said, and tells its writer why", async () => {
    const h = setup();
    h.tokens.set("discord", "good");
    h.links.set("group:closed", { platform: "discord", channelId: "666" });
    for (const start of h.starts) start({}, {});
    await vi.waitFor(async () =>
      expect((await h.call("/kazusa/bridges/account")).body).toMatchObject({
        bot: "Office Bot",
      }),
    );
    const { code } = BridgeLinkCodeResponseSchema.parse(
      (await h.call("/kazusa/bridges/account/code", {})).body,
    );
    await h.link(code, { id: "42", name: "Flying_Banana" });
    h.write({
      channelId: "666",
      messageId: "1",
      author: { id: "42", name: "Flying_Banana" },
      text: "Hello?",
    });
    await vi.waitFor(() =>
      expect(h.undelivered).toEqual([
        [
          "1",
          "Sensei, whom you play in Kazusa, isn't in the chat this channel is linked to, and it isn't open to join, so nobody heard that.",
        ],
      ]),
    );
    expect(h.messaging.send).not.toHaveBeenCalled();
    expect(h.removed).toEqual([]);
  });
});
