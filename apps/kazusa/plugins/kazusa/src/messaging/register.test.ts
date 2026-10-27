import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { Socket } from "node:net";
import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import path from "node:path";
import type {
  OpenClawPluginApi,
  OpenClawPluginToolContext,
} from "openclaw/plugin-sdk/core";
import {
  appendSessionTranscriptMessageByIdentityStrict,
  publishSessionTranscriptUpdateByIdentity,
} from "openclaw/plugin-sdk/session-transcript-runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Messaging, MessageDelivery } from "./messaging.ts";
import { registerMessaging } from "./register.ts";

vi.mock("openclaw/plugin-sdk/session-transcript-runtime", () => ({
  appendSessionTranscriptMessageByIdentityStrict: vi.fn(),
  publishSessionTranscriptUpdateByIdentity: vi.fn(async () => {}),
}));

const directories: string[] = [];
const instances: Messaging[] = [];
const append = vi.mocked(appendSessionTranscriptMessageByIdentityStrict);

async function setup() {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "kazusa-message-"));
  directories.push(workspace);
  await writeFile(
    path.join(workspace, "IDENTITY.md"),
    "---\nagent_id: alice\nname: Alice Lin\n---\nCharacter biography.",
  );
  const registerTool = vi.fn();
  const registerService = vi.fn();
  const registerAgentEventSubscription = vi.fn();
  type HttpRoute = Parameters<OpenClawPluginApi["registerHttpRoute"]>[0];
  const routes = new Map<string, HttpRoute>();
  const registerHttpRoute = vi.fn((params: HttpRoute) => {
    routes.set(params.path, params);
  });
  const dispose = vi.fn();
  const retained = new Map<string, MessageDelivery>();
  const chats = new Map<string, unknown>();
  const config = { agents: { entries: { alice: {}, bob: {}, carol: {} } } };
  const resolveAgentIdentity = vi.fn(() => undefined);
  const entries = new Map<
    string,
    { sessionId: string; displayName?: string }
  >();
  const patchSessionEntry = vi.fn(async ({ sessionKey, update }) => {
    const current = entries.get(sessionKey) ?? { sessionId: "" };
    const next = { ...current, ...update(current) };
    entries.set(sessionKey, next);
    return next;
  });
  // Partial SDK host, confined to the test boundary.
  const api = {
    config,
    agent: { events: { registerAgentEventSubscription } },
    registerTool,
    registerService,
    registerHttpRoute,
    lifecycle: { onDispose: dispose },
    logger: { warn: vi.fn() },
    runtime: {
      state: {
        openKeyedStore: ({ namespace }: { namespace: string }) =>
          namespace === "chats"
            ? {
                lookup: async (key: string) => structuredClone(chats.get(key)),
                register: async (
                  key: string,
                  value: unknown,
                  options?: { assertCurrent?: () => void },
                ) => {
                  options?.assertCurrent?.();
                  chats.set(key, structuredClone(value));
                },
                entries: async () =>
                  [...chats].map(([key, value]) => ({
                    key,
                    value: structuredClone(value),
                    createdAt: Date.now(),
                  })),
              }
            : {
                lookup: async (key: string) =>
                  structuredClone(retained.get(key)),
                register: async (
                  key: string,
                  value: MessageDelivery,
                  options?: { assertCurrent?: () => void },
                ) => {
                  options?.assertCurrent?.();
                  retained.set(key, structuredClone(value));
                },
                entries: async () =>
                  [...retained].map(([key, value]) => ({
                    key,
                    value: structuredClone(value),
                    createdAt: Date.now(),
                  })),
              },
      },
      agent: {
        resolveAgentIdentity,
        resolveAgentWorkspaceDir: () => workspace,
        session: { patchSessionEntry },
      },
    },
  } as unknown as OpenClawPluginApi;
  const receive = vi.fn(async () => {});
  let adoptedListener:
    | ((delivery: {
        id: string;
        agentId: string;
        mode: "steer" | "followup";
        message: string;
        ids: string[];
        keys: string[];
        sessionKeys?: string[];
      }) => void | Promise<void>)
    | undefined;
  const onAdopted = vi.fn((listener) => {
    adoptedListener = listener;
    return () => {};
  });
  const messaging = registerMessaging(api, {
    clock: { init: async () => {}, time: () => 123456 },
    perception: { receive, onAdopted },
  });
  instances.push(messaging);
  const context: OpenClawPluginToolContext<2> = {
    agentId: "alice",
    sessionKey: "agent:alice:brain",
    sessionId: "alice-brain-session",
    assertInvocationCurrent: vi.fn(),
  };
  let nextCall = 0;
  const executeTool = (
    name: string,
    input: unknown,
    overrides: Partial<OpenClawPluginToolContext<2>> = {},
    toolCallId = `call-${++nextCall}`,
  ) =>
    registerTool.mock.calls[0][0]
      .create({ ...context, ...overrides })
      .find((tool: { name: string }) => tool.name === name)
      .execute(toolCallId, input);
  const execute = (
    input: unknown = {
      members: ["bob"],
      text: "Hello Bob",
    },
    overrides: Partial<OpenClawPluginToolContext<2>> = {},
  ) => executeTool("send_message", input, overrides);
  return {
    execute,
    executeTool,
    entries,
    chats,
    api,
    workspace,
    registerService,
    registerAgentEventSubscription,
    dispose,
    messaging,
    receive,
    retained,
    patchSessionEntry,
    registerTool,
    routes,
    adopt: async (
      delivery: Parameters<NonNullable<typeof adoptedListener>>[0],
    ) => adoptedListener?.(delivery),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  append.mockImplementation(async ({ message }) => ({
    kind: "result",
    result: { messageId: message.idempotencyKey },
  }));
});

afterEach(async () => {
  for (const instance of instances.splice(0)) instance.dispose();
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("send_message SDK integration", () => {
  it("deduplicates host replays without model-supplied IDs and scopes calls to the brain session", async () => {
    const h = await setup();
    const input = { members: ["bob"], title: "Tea", text: "Hello" };
    const first = await h.executeTool("send_message", input, {}, "same-call");
    const replay = await h.executeTool("send_message", input, {}, "same-call");
    expect(replay.details).toEqual(first.details);
    expect(replay.details).not.toHaveProperty("requestId");
    expect(append).toHaveBeenCalledTimes(2);
    expect(h.chats.size).toBe(1);
    await expect(
      h.executeTool(
        "send_message",
        { ...input, text: "Changed" },
        {},
        "same-call",
      ),
    ).rejects.toThrow("different message");
    const fresh = await h.executeTool("send_message", input, {}, "new-call");
    expect(fresh.details.messageId).not.toBe(first.details.messageId);
    const reset = await h.executeTool(
      "send_message",
      input,
      { sessionId: "new-brain-session" },
      "same-call",
    );
    expect(reset.details.messageId).not.toBe(first.details.messageId);
    expect(h.chats.size).toBe(3);
    await expect(
      h.execute({ ...input, requestId: "model-id" }),
    ).rejects.toThrow();
    await expect(h.execute(input, { sessionId: undefined })).rejects.toThrow();
    const tool = h.registerTool.mock.calls[0][0].create({})[0];
    expect(tool.parameters.properties).not.toHaveProperty("requestId");
  });

  it("registers discovery, send and group management as guarded tools", async () => {
    const h = await setup();
    expect(h.registerTool.mock.calls[0][1]).toEqual({
      names: ["send_message", "list_chats", "manage_chat"],
    });
    const first = await h.execute({
      title: "Tea",
      members: ["bob"],
      text: "Hello",
    });
    const bob = { agentId: "bob", sessionKey: "agent:bob:brain" };
    const found = await h.executeTool("list_chats", { query: "tea" }, bob);
    const sessionKey = found.details.chats[0].sessionKey;
    expect(sessionKey).toBe(
      first.details.sessionKey.replace("agent:alice:", "agent:bob:"),
    );
    await h.executeTool(
      "manage_chat",
      { action: "rename", sessionKey, title: "Lunch" },
      bob,
    );
    await h.executeTool(
      "manage_chat",
      { action: "add_members", sessionKey, members: ["carol"] },
      bob,
    );
    expect([...h.entries.values()]).toHaveLength(3);
    expect([...h.entries.values()].map((entry) => entry.displayName)).toEqual([
      "Lunch",
      "Lunch",
      "Lunch",
    ]);
    expect(
      h.patchSessionEntry.mock.calls.every(
        ([params]) => params.preserveActivity,
      ),
    ).toBe(true);
    expect(append).toHaveBeenCalledTimes(2);
    vi.spyOn(h.api.runtime.agent, "resolveAgentIdentity").mockReturnValue({
      name: "Bob",
    });
    const reply = await h.execute({ sessionKey, text: "See you there" }, bob);
    expect(reply.details.recipients).toEqual(["alice", "carol"]);
    expect(
      append.mock.calls
        .slice(2)
        .map(([params]) => params.message.__openclaw.senderId),
    ).toEqual(["bob", "bob", "bob"]);
  });

  it("rejects invalid management arguments, unknown additions and expired membership edits", async () => {
    const h = await setup();
    const first = await h.execute({
      title: "Tea",
      members: ["bob"],
      text: "Hello",
    });
    const sessionKey = first.details.sessionKey;
    await expect(
      h.executeTool("manage_chat", { action: "rename", sessionKey }),
    ).rejects.toThrow();
    await expect(
      h.executeTool("manage_chat", {
        action: "leave",
        sessionKey,
        sender: "carol",
      }),
    ).rejects.toThrow();
    await expect(
      h.executeTool("manage_chat", {
        action: "add_members",
        sessionKey,
        members: ["missing"],
      }),
    ).rejects.toThrow("Unknown character");
    await expect(
      h.executeTool(
        "manage_chat",
        { action: "rename", sessionKey, title: "Changed" },
        {
          assertInvocationCurrent: () => {
            throw new Error("expired");
          },
        },
      ),
    ).rejects.toThrow("expired");
    expect((await h.executeTool("list_chats", {})).details.chats).toEqual([
      expect.objectContaining({ title: "Tea", members: ["alice", "bob"] }),
    ]);
    await expect(
      h.executeTool("list_chats", {}, { sessionKey: "agent:bob:brain" }),
    ).rejects.toThrow("brain");
    expect(append).toHaveBeenCalledTimes(2);
  });

  it("writes native sender metadata, one text block, stable keys, and real-time session bookkeeping", async () => {
    const h = await setup();
    const result = await h.execute();
    expect(result.details.status).toBe("delivered");
    for (const [{ message }] of append.mock.calls) {
      expect(message).toMatchObject({
        content: [{ type: "text", text: "Hello Bob" }],
        timestamp: 123456,
        __openclaw: {
          senderId: "alice",
          senderName: "Alice Lin",
          senderIdentity: {
            type: "observation",
            id: "alice",
            pluginId: "kazusa",
            accountId: null,
            senderKind: "bot",
          },
        },
      });
    }
    expect(append.mock.calls.map(([params]) => params.message.role)).toEqual([
      "assistant",
      "user",
    ]);
    expect(append.mock.calls[0][0].message.idempotencyKey).not.toBe(
      append.mock.calls[1][0].message.idempotencyKey,
    );
    expect(
      h.patchSessionEntry.mock.calls[0][0].fallbackEntry.updatedAt,
    ).toBeGreaterThan(123456);
    await vi.waitFor(() => expect(h.receive).toHaveBeenCalledTimes(1));
    expect(publishSessionTranscriptUpdateByIdentity).toHaveBeenCalledTimes(2);
  });

  it.each([
    { agentId: undefined },
    { sessionKey: undefined },
    { sessionKey: "agent:bob:brain" },
    { sessionKey: "agent:alice:chat:direct:bob" },
  ])("fails closed without the sender's brain context: %j", async (context) => {
    const h = await setup();
    await expect(h.execute(undefined, context)).rejects.toThrow();
    expect(append).not.toHaveBeenCalled();
  });

  it("rejects spoofed authorship, unknown targets and extra fields before any write", async () => {
    const h = await setup();
    await expect(
      h.execute({
        members: ["bob"],
        text: "Hi",
        sender: "carol",
      }),
    ).rejects.toThrow();
    await expect(
      h.execute({ members: ["missing"], text: "Hi" }),
    ).rejects.toThrow("Unknown character");
    expect(append).not.toHaveBeenCalled();
  });

  it.each(["suppressed", "rejected"] as const)(
    "retains %s appends and never notifies an uncommitted recipient",
    async (kind) => {
      const h = await setup();
      append.mockResolvedValue({ kind, reason: "session-rebound" });
      expect((await h.execute()).details.status).toBe("pending");
      expect(h.receive).not.toHaveBeenCalled();
      expect(publishSessionTranscriptUpdateByIdentity).not.toHaveBeenCalled();
    },
  );

  it("checks identity file ownership and uses configured identity before file metadata", async () => {
    const h = await setup();
    await writeFile(
      path.join(h.workspace, "IDENTITY.md"),
      "---\nagent_id: carol\nname: Carol\n---\n",
    );
    await expect(h.execute()).rejects.toThrow("identity");
    vi.spyOn(h.api.runtime.agent, "resolveAgentIdentity").mockReturnValue({
      name: "Configured Alice",
    });
    await h.execute();
    expect(append.mock.calls[0][0].message.__openclaw.senderName).toBe(
      "Configured Alice",
    );
  });

  it("registers startup recovery and rejects retained writes after disposal", async () => {
    const h = await setup();
    expect(h.registerTool.mock.calls[0][0].contextVersion).toBe(2);
    const service = h.registerService.mock.calls[0][0];
    expect(service.id).toBe("kazusa-messaging");
    await service.start();
    await h.execute();
    h.dispose.mock.calls[0][0]();
    expect(() => append.mock.calls[0][0].preparation?.source?.()).toThrow();
  });

  it("checks invocation authority at durable acceptance after identity resolution", async () => {
    const h = await setup();
    const assertInvocationCurrent = vi.fn(() => {
      throw new Error("Invocation expired");
    });
    await expect(
      h.execute(undefined, { assertInvocationCurrent }),
    ).rejects.toThrow("Invocation expired");
    expect(h.retained.size).toBe(0);
    expect(append).not.toHaveBeenCalled();
  });

  it("signals typing automatically on turn adoption and clears it on turn end or send", async () => {
    const h = await setup();
    await h.execute();
    const lifecycle = h.registerAgentEventSubscription.mock.calls[0][0];
    const event = (phase: string, runId: string) =>
      lifecycle.handle({
        stream: "lifecycle",
        sessionKey: "agent:alice:brain",
        runId,
        data: { phase },
      });
    expect(await h.messaging.getTyping("bob")).toEqual([]);
    await h.adopt({
      id: "run-1",
      agentId: "alice",
      mode: "followup",
      message: "Hello",
      ids: ["msg-1"],
      keys: ["key-1"],
      sessionKeys: ["agent:alice:chat:direct:bob"],
    });
    expect(await h.messaging.getTyping("bob")).toHaveLength(1);
    event("start", "run-1");
    expect(await h.messaging.getTyping("bob")).toHaveLength(1);
    event("end", "old-run");
    expect(await h.messaging.getTyping("bob")).toHaveLength(1);
    event("error", "run-1");
    expect(await h.messaging.getTyping("bob")).toEqual([]);
  });

  it("registers Gateway HTTP routes and handles chats, messages, and send", async () => {
    const h = await setup();
    async function invoke(routePath: string, body?: unknown, url = routePath) {
      const route = h.routes.get(routePath);
      if (!route) throw new Error(`Missing route: ${routePath}`);
      const req = Object.assign(
        Readable.from(
          body === undefined ? [] : [Buffer.from(JSON.stringify(body))],
        ),
        {
          method: body === undefined ? "GET" : "POST",
          url,
          headers: {},
          socket: new Socket(),
        },
      );
      const res = {
        statusCode: 200,
        headers: new Map<string, string>(),
        body: "",
        writeHead(status: number, headers: Record<string, string>) {
          this.statusCode = status;
          for (const [key, value] of Object.entries(headers))
            this.headers.set(key, value);
        },
        setHeader(name: string, value: string) {
          this.headers.set(name, value);
        },
        end(data: string) {
          this.body = data;
        },
      };
      // Minimal HTTP objects at the test boundary; the Gateway owns real sockets.
      expect(
        await route.handler(
          req as unknown as IncomingMessage,
          res as unknown as ServerResponse,
        ),
      ).toBe(true);
      return {
        statusCode: res.statusCode,
        body: JSON.parse(res.body) as unknown,
      };
    }

    const sent = await invoke("/kazusa/send", {
      requestId: "browser-submit",
      members: ["alice", "bob"],
      title: "Study Group",
      text: "Hello everyone from Sensei!",
    });
    expect(sent.statusCode).toBe(200);
    const sendData = z
      .object({
        message: z.object({
          id: z.string(),
          requestId: z.string(),
          sequence: z.number(),
          senderId: z.string(),
          timestamp: z.number(),
        }),
        chatId: z.string(),
        status: z.literal("delivered"),
      })
      .parse(sent.body);
    expect(sendData.message).toMatchObject({
      requestId: "browser-submit",
      senderId: "user:sensei",
      timestamp: 123456,
    });
    expect(
      append.mock.calls.map(([params]) => params.message.__openclaw),
    ).toEqual([
      expect.objectContaining({
        senderId: "user:sensei",
        senderIdentity: expect.objectContaining({
          id: "user:sensei",
          senderKind: "human",
        }),
      }),
      expect.objectContaining({
        senderId: "user:sensei",
        senderIdentity: expect.objectContaining({
          id: "user:sensei",
          senderKind: "human",
        }),
      }),
    ]);

    const listed = await invoke(
      "/kazusa/chats",
      undefined,
      "/kazusa/chats?userId=user:sensei",
    );
    expect(listed.statusCode).toBe(200);
    const chats = z
      .object({
        chats: z.array(z.object({ name: z.string(), sessionKey: z.string() })),
      })
      .parse(listed.body).chats;
    expect(chats).toHaveLength(1);
    expect(chats[0].name).toBe("Study Group");

    const chatId = h.retained.get(sendData.message.id)?.chatId;
    expect(chatId).toBeDefined();
    const history = await invoke(
      "/kazusa/messages",
      undefined,
      `/kazusa/messages?chatId=${chatId}&userId=user:sensei`,
    );
    expect(history.statusCode).toBe(200);
    expect(history.body).toMatchObject({
      messages: [
        { text: "Hello everyone from Sensei!", senderId: "user:sensei" },
      ],
    });

    const retry = await invoke("/kazusa/send", {
      requestId: "browser-submit",
      members: ["alice", "bob"],
      title: "Study Group",
      text: "Hello everyone from Sensei!",
    });
    expect(retry.body).toEqual(sent.body);
    expect(h.retained.size).toBe(1);
    expect(append).toHaveBeenCalledTimes(2);
    const spoofed = await invoke("/kazusa/send", {
      requestId: "spoof",
      sender: "alice",
      sessionKey: chats[0].sessionKey,
      text: "Fake",
    });
    expect(spoofed.statusCode).toBe(400);
    const next = await invoke("/kazusa/send", {
      requestId: "browser-next",
      sessionKey: chats[0].sessionKey,
      text: "Same conversation",
    });
    expect(next.statusCode).toBe(200);
    expect(next.body).toMatchObject({
      chatId,
      message: { senderId: "user:sensei", sequence: 2 },
    });
    expect(h.chats.size).toBe(1);

    const managed = await invoke("/kazusa/chats/manage", {
      action: "rename",
      sessionKey: chats[0].sessionKey,
      title: "Renamed Study Group",
    });
    expect(managed.statusCode).toBe(200);
    expect(managed.body).toMatchObject({
      chat: { name: "Renamed Study Group" },
    });
  });
});
