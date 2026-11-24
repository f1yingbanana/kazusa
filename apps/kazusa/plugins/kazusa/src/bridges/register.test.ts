import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { Readable } from "node:stream";
import { BridgesResponseSchema } from "@kazusa/client";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Messaging, MessagingEvent } from "../messaging/messaging.ts";
import type { ProviderKeys } from "../providers/keys.ts";
import type { BridgeLink, BridgeTransport, IncomingLine } from "./bridge.ts";
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
  const store = {
    lookup: async (key: string) => links.get(key),
    register: async (key: string, value: BridgeLink) =>
      void links.set(key, value),
    delete: async (key: string) => links.delete(key),
    entries: async () =>
      [...links].map(([key, value]) => ({ key, value, createdAt: 0 })),
  };
  let listener: ((event: MessagingEvent) => void) | undefined;
  const messaging = {
    postAsGuest: vi.fn(async () => "id"),
    onAnyEvent: (next: (event: MessagingEvent) => void) => {
      listener = next;
      return () => (listener = undefined);
    },
  };
  let onLine: ((line: IncomingLine) => void) | undefined;
  const transport = vi.fn((token: string): BridgeTransport => ({
    start: async (next) => {
      if (token !== "good") throw new Error("Discord refused the token.");
      onLine = next;
      return { name: "Office Bot" };
    },
    post: async () => {},
    stop: async () => {},
    check: async (channelId) =>
      channelId === "333" ? "The bot can't see this channel." : undefined,
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
    write: (line: IncomingLine) => onLine?.(line),
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
          guest: "guest:discord-42",
        }),
      ),
    );

    const taken = await h.call("/kazusa/bridges/link", {
      chatId: "group:other",
      channelId: "111",
    });
    expect(taken.status).toBeGreaterThanOrEqual(400);
    const direct = await h.call("/kazusa/bridges/link", {
      chatId: "direct:abc",
      channelId: "222",
    });
    expect(direct.status).toBeGreaterThanOrEqual(400);

    const moved = await h.call("/kazusa/bridges/link", {
      chatId: "group:office",
      channelId: "222",
    });
    expect(moved.body).toMatchObject({
      links: [{ chatId: "group:office", channelId: "222" }],
    });
    const hidden = await h.call("/kazusa/bridges/link", {
      chatId: "group:office",
      channelId: "333",
    });
    expect(hidden.body).toMatchObject({
      links: [
        {
          chatId: "group:office",
          channelId: "333",
          problem: "The bot can't see this channel.",
        },
      ],
    });
    const unlinked = await h.call("/kazusa/bridges/link", {
      chatId: "group:office",
      channelId: null,
    });
    expect(unlinked.body).toMatchObject({ links: [] });
  });
});
