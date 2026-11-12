import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
import {
  MessagesResponseSchema,
  ObservedChatsResponseSchema,
} from "@kazusa/client";
import type { Messaging, MessageDelivery } from "./messaging.ts";
import type { ConversationSource } from "../perception/types.ts";
import { registerMessaging, speechReply } from "./register.ts";
import { mirroredStore } from "./message-store.fake.ts";

vi.mock("openclaw/plugin-sdk/session-transcript-runtime", () => ({
  appendSessionTranscriptMessageByIdentityStrict: vi.fn(),
  publishSessionTranscriptUpdateByIdentity: vi.fn(async () => {}),
}));

const directories: string[] = [];
const instances: Messaging[] = [];
const append = vi.mocked(appendSessionTranscriptMessageByIdentityStrict);

async function setup(
  pluginConfig: Record<string, unknown> = {},
  options: Partial<
    Pick<
      Parameters<typeof registerMessaging>[1],
      | "release"
      | "observer"
      | "broadcaster"
      | "perception"
      | "placeOf"
      | "appendLedger"
    >
  > = {},
) {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "kazusa-message-"));
  directories.push(workspace);
  await writeFile(
    path.join(workspace, "IDENTITY.md"),
    "---\nagent_id: alice\nname: Alice Lin\n---\nCharacter biography.",
  );
  const registerTool = vi.fn();
  const registerService = vi.fn();
  type HttpRoute = Parameters<OpenClawPluginApi["registerHttpRoute"]>[0];
  const routes = new Map<string, HttpRoute>();
  const registerHttpRoute = vi.fn((params: HttpRoute) => {
    routes.set(params.path, params);
  });
  const dispose = vi.fn();
  const retained = new Map<string, MessageDelivery>();
  const chats = new Map<string, unknown>();
  const outbox = new Map<string, unknown>();
  const config = {
    gateway: { auth: { token: "test-service-token" } },
    agents: { entries: { alice: {}, bob: {}, carol: {} } },
  };
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
    pluginConfig,
    registerTool,
    registerService,
    registerHttpRoute,
    lifecycle: {
      onDispose: dispose,
      runInBackgroundContext: <T>(run: () => T): T => run(),
    },
    logger: { warn: vi.fn() },
    runtime: {
      state: {
        openKeyedStore: ({ namespace }: { namespace: string }) => {
          const map: Map<string, unknown> =
            namespace === "chats"
              ? chats
              : namespace === "outbox"
                ? outbox
                : retained;
          return {
            lookup: async (key: string) => structuredClone(map.get(key)),
            register: async (
              key: string,
              value: unknown,
              options?: { assertCurrent?: () => void },
            ) => {
              options?.assertCurrent?.();
              map.set(key, structuredClone(value));
            },
            delete: async (key: string) => map.delete(key),
            entries: async () =>
              [...map].map(([key, value]) => ({
                key,
                value: structuredClone(value),
                createdAt: Date.now(),
              })),
          };
        },
      },
      agent: {
        resolveAgentIdentity,
        resolveAgentWorkspaceDir: () => workspace,
        session: { patchSessionEntry },
      },
    },
  } as unknown as OpenClawPluginApi;
  Object.assign(api, {
    runtime: { ...api.runtime, config: { current: () => api.config } },
  });
  const receive = vi.fn(async () => {});
  const messaging = registerMessaging(api, {
    // The test clock is paused; nothing here is about holding still.
    release: AbortSignal.abort(),
    clock: {
      init: async () => {},
      time: () => 123456,
      now: () => ({ simTime: 123456, speed: 0, formatted: "" }),
    },
    perception: { receive },
    messages: mirroredStore(retained),
    ...options,
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
      sessionKey: "chat:direct:bob",
      messages: ["Hello Bob"],
    },
    overrides: Partial<OpenClawPluginToolContext<2>> = {},
  ) => executeTool("send_message", input, overrides);
  /** Start a group of Alice, Bob and Carol, then say something in it. */
  const inGroup = async (
    title: string,
    messages: unknown[],
    overrides: Partial<OpenClawPluginToolContext<2>> = {},
  ) => {
    const group = await executeTool(
      "create_group",
      { members: ["bob", "carol"], title },
      overrides,
    );
    return execute(
      { sessionKey: group.details.sessionKey, messages },
      overrides,
    );
  };
  return {
    execute,
    inGroup,
    executeTool,
    entries,
    chats,
    api,
    workspace,
    registerService,
    dispose,
    messaging,
    receive,
    retained,
    patchSessionEntry,
    registerTool,
    routes,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Each test is a fresh process: no world state left from the last one.
  delete (globalThis as Record<symbol, unknown>)[
    Symbol.for("kazusa.messaging.state")
  ];
  append.mockImplementation(async ({ message }) => ({
    kind: "result",
    result: { messageId: message.idempotencyKey ?? "" },
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
  it("lets the system agent send and manage chats while a peer waits for resume", async () => {
    const release = new AbortController();
    const h = await setup(
      {},
      {
        release: release.signal,
      },
    );
    Object.assign(h.api.config, {
      agents: {
        ...h.api.config.agents,
        defaults: { systemAgent: { agentId: "alice" } },
      },
    });
    const sent = await h.inGroup("Console", ["Ready"]);
    await h.executeTool("manage_chat", {
      action: "rename",
      sessionKey: sent.details.sessionKey,
      title: "Admin",
    });
    let finished = false;
    vi.mocked(h.api.runtime.agent.resolveAgentIdentity).mockReturnValue({
      name: "Bob",
    });
    const peer = h
      .execute(
        { sessionKey: "chat:direct:alice", messages: ["Waiting"] },
        {
          agentId: "bob",
          sessionKey: "agent:bob:brain",
          sessionId: "bob-brain",
        },
      )
      .then(() => {
        finished = true;
      });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(finished).toBe(false);
    release.abort();
    await peer;
    expect(finished).toBe(true);
  });
  it("accepts new sends when the same tool instance receives a reused provider call ID", async () => {
    const h = await setup();
    const group = await h.executeTool("create_group", {
      members: ["bob", "carol"],
      title: "Tea",
    });
    const input = { sessionKey: group.details.sessionKey, messages: ["Hello"] };
    const tool = h.registerTool.mock.calls[0][0].create({
      agentId: "alice",
      sessionKey: "agent:alice:brain",
      sessionId: "alice-brain-session",
      assertInvocationCurrent: vi.fn(),
    })[0];
    const first = await tool.execute("call_0", input);
    const changed = await tool.execute("call_0", {
      ...input,
      messages: ["Changed"],
    });
    const repeated = await tool.execute("call_0", input);
    expect(first.details.said).toEqual(["Hello"]);
    expect(changed.details.said).toEqual(["Changed"]);
    expect(repeated.details.said).toEqual(["Hello"]);
    expect(
      new Set([
        first.details.messageIds[0],
        changed.details.messageIds[0],
        repeated.details.messageIds[0],
      ]).size,
    ).toBe(3);
    expect(append).toHaveBeenCalledTimes(9);
    expect(h.chats.size).toBe(1);
  });

  it("notes in their own records that they stopped following a conversation", async () => {
    let source: ConversationSource | undefined;
    const appendLedger = vi.fn(async () => {});
    const h = await setup(
      {},
      {
        perception: {
          receive: vi.fn(async () => {}),
          attachConversations: (attached) => {
            source = attached;
          },
        },
        placeOf: async () => ({ placeId: "club", title: "Club" }),
        appendLedger,
      },
    );
    const lunch = await h.messaging.talk("alice", ["bob", "carol"]);
    const address = lunch.sessionKey.replace("agent:alice:", "");
    await source?.tuneOut("carol", address);
    expect(appendLedger).toHaveBeenCalledOnce();
    const [[note]] = appendLedger.mock.calls as unknown as [
      [{ agentId: string; stream: string; text: string; timestamp: number }],
    ];
    expect(note).toMatchObject({
      agentId: "carol",
      stream: "tasks",
      timestamp: 123456,
    });
    // As the skill words it (wrapped lines and all).
    expect(note.text.replace(/\s+/g, " ")).toBe(
      `You stopped following the conversation with Alice Lin and bob (${address}) and no longer hear it.`,
    );
    // Out of it already: nothing to leave, nothing to note.
    await source?.tuneOut("carol", address);
    expect(appendLedger).toHaveBeenCalledOnce();
  });

  it("tells a character whether its words went out, never the words again", async () => {
    const h = await setup();
    const text = (result: { content: { text: string }[] }) =>
      JSON.parse(result.content[0].text);
    const group = await h.executeTool("create_group", {
      members: ["bob", "carol"],
      title: "Tea",
    });
    expect(text(group)).toEqual({
      sessionKey: expect.stringMatching(/^chat:group:[0-9a-z]{10}$/),
      title: "Tea",
      members: ["alice", "bob", "carol"],
    });
    expect(
      text(
        await h.execute({
          sessionKey: text(group).sessionKey,
          messages: ["Hi"],
        }),
      ),
    ).toEqual({ status: "delivered" });
    // Live: an interrupted send repeated every word in `said` and `unsaid`.
    const cut = {
      status: "interrupted" as const,
      sessionKey: "agent:alice:chat:huddle:abc",
      recipients: ["bob"],
      messageIds: ["1", "2"],
      said: ["Wait...", "I told you n—"],
      unsaid: ["I told you not to go!", "Why?"],
      heard: "I told you n—",
    };
    expect(speechReply(cut)).toEqual({
      status: "interrupted",
      said: 1,
      of: 3,
      heard: "I told you n—",
    });
    // What stopped them follows as its own text, read as a delivery is.
    expect(speechReply({ ...cut, meanwhile: "- [Bob] …" })).not.toHaveProperty(
      "meanwhile",
    );
    const { heard: _heard, ...whole } = cut;
    expect(speechReply({ ...whole, said: ["Wait..."] })).toEqual({
      status: "interrupted",
      said: 1,
      of: 3,
    });
  });

  it("owns send identity without requiring a brain UUID or model-supplied ID", async () => {
    const h = await setup();
    const input = { sessionKey: "chat:direct:bob", messages: ["Hello"] };
    const result = await h.execute(input, { sessionId: undefined });
    expect(result.details.status).toBe("delivered");
    expect(result.details).not.toHaveProperty("requestId");
    await expect(
      h.execute({ ...input, requestId: "model-id" }),
    ).rejects.toThrow();
    expect(append).toHaveBeenCalledTimes(2);
    const tool = h.registerTool.mock.calls[0][0].create({})[0];
    expect(tool.parameters.properties).not.toHaveProperty("requestId");
  });

  it("offers a character only its own stickers and sends one as everyone reads it", async () => {
    const h = await setup();
    const tool = () =>
      h.registerTool.mock.calls[0][0].create({ agentId: "alice" })[0];
    // No stickers: nothing to pick.
    expect(JSON.stringify(tool().parameters)).not.toContain("sticker");

    const dir = path.join(h.workspace, "stickers");
    await mkdir(dir);
    await Promise.all(
      ["laughing.webp", "maid-happy.webp", "notes.txt"].map((file) =>
        writeFile(path.join(dir, file), "RIFF"),
      ),
    );
    await writeFile(
      path.join(dir, "stickers.json"),
      JSON.stringify({
        outfits: { maid: "a maid dress" },
        stickers: { laughing: { look: "laughing with eyes shut" } },
      }),
    );
    const options = tool().parameters.properties.messages.items.anyOf;
    const picker = options.find(
      (option: { properties?: object }) =>
        option.properties && "sticker" in option.properties,
    ).properties.sticker;
    expect(picker.enum).toEqual(["laughing", "maid-happy"]);
    expect(picker.description).toContain("maid: a maid dress");

    const sent = await h.execute({
      sessionKey: "chat:direct:bob",
      messages: [
        "So funny",
        { sticker: "laughing" },
        { sticker: "maid-happy" },
      ],
    });
    expect(sent.details.said).toEqual([
      "So funny",
      "[type=sticker] Alice Lin, laughing with eyes shut",
      "[type=sticker] Alice Lin, happy, in a maid dress",
    ]);
    const stored = [...h.retained.values()].find(
      ({ params }) => params.sticker?.name === "maid-happy",
    );
    expect(stored?.params).toMatchObject({
      type: "sticker",
      sticker: { name: "maid-happy", v: expect.stringMatching(/^[a-z0-9]+$/) },
    });
    await expect(
      h.execute({
        sessionKey: "chat:direct:bob",
        messages: [{ sticker: "crying" }],
      }),
    ).rejects.toThrow();

    // One added while running is offered and sendable on the next turn.
    await writeFile(path.join(dir, "crying.webp"), "RIFF");
    expect(JSON.stringify(tool().parameters)).toContain('"crying"');
    const cried = await h.execute({
      sessionKey: "chat:direct:bob",
      messages: [{ sticker: "crying" }],
    });
    expect(cried.details.said).toEqual(["[type=sticker] Alice Lin, crying"]);
  });

  it("offers a character with portraits its moods as a line's face, frozen as everyone sees it, and drops one it lacks", async () => {
    const h = await setup(
      {},
      { placeOf: async () => ({ placeId: "club", title: "Club" }) },
    );
    const tool = () =>
      h.registerTool.mock.calls[0][0].create({ agentId: "alice" })[0];
    const textBubble = () =>
      tool().parameters.properties.messages.items.anyOf.find(
        (option: { properties?: object }) =>
          option.properties && "text" in option.properties,
      );
    // No portraits: no face to give.
    expect(JSON.stringify(tool().parameters)).not.toContain("face");

    const portraits = path.join(h.workspace, "portraits");
    const stickers = path.join(h.workspace, "stickers");
    await mkdir(portraits);
    await mkdir(stickers);
    await Promise.all(
      [
        "neutral.webp",
        "annoyed.webp",
        "happy.webp",
        "gym-happy.webp",
        "gym-smug.webp",
      ].map((file) => writeFile(path.join(portraits, file), "RIFF")),
    );
    await writeFile(
      path.join(stickers, "stickers.json"),
      JSON.stringify({
        outfits: { gym: "gym clothes" },
        stickers: { annoyed: { look: "annoyed, a flat stare" } },
      }),
    );
    await writeFile(path.join(stickers, "annoyed.webp"), "RIFF");
    // Moods, not names, of the usual clothes only: nobody wears an outfit
    // yet, so a mood only an outfit has (smug) is not offered.
    const face = textBubble().properties.face;
    expect(face.enum).toEqual(["annoyed", "happy", "neutral"]);
    expect(face.description).toContain("Face to face only");

    const lunch = await h.messaging.talk("alice", ["bob", "carol"]);
    const sessionKey = lunch.sessionKey.replace("agent:alice:", "");
    const sent = await h.execute({
      sessionKey,
      messages: [
        { text: "I said no.", face: "annoyed" },
        { text: "Really.", face: "annoyed" },
        { text: "looks away", type: "action", face: "sulking" },
        { text: "Fine.", face: "happy" },
      ],
    });
    // A mood they don't have is dropped and the line is still said.
    expect(sent.details).toMatchObject({ status: "delivered" });
    const faces = [...h.retained.values()]
      .filter(({ sender }) => sender === "alice")
      .sort((a, b) => a.sequence - b.sequence)
      .map(({ params }) => params.face);
    expect(faces).toEqual([
      // Everyone reads it, in the sticker's words, only as it changes.
      { name: "annoyed", seen: "(annoyed, a flat stare)" },
      { name: "annoyed" },
      undefined,
      // No picture of it in the usual clothes: the scene shows the neutral
      // face, and the mood is still read.
      { name: "happy", seen: "(happy)" },
    ]);
    // The next send remembers the face they last showed there.
    await h.execute({
      sessionKey,
      messages: [{ text: "Anyway.", face: "happy" }],
    });
    const last = [...h.retained.values()].find(
      ({ params }) => params.text === "Anyway.",
    );
    expect(last?.params.face).toEqual({ name: "happy" });
    // By text it is dropped, as an action is.
    await h.execute({
      sessionKey: "chat:direct:bob",
      messages: [{ text: "No.", face: "annoyed" }],
    });
    const texted = [...h.retained.values()].find(
      ({ params }) => params.text === "No.",
    );
    expect(texted?.params).not.toHaveProperty("face");
  });

  it("offers up to the configured number of bubbles, nine by default", async () => {
    const maxItems = (h: Awaited<ReturnType<typeof setup>>) =>
      h.registerTool.mock.calls[0][0].create({})[0].parameters.properties
        .messages.maxItems;
    expect(maxItems(await setup())).toBe(9);
    expect(maxItems(await setup({ messaging: { maxBubbles: 3 } }))).toBe(3);
    await expect(
      (await setup({ messaging: { maxBubbles: 3 } })).execute({
        sessionKey: "chat:direct:bob",
        messages: ["a", "b", "c", "d"],
      }),
    ).rejects.toThrow();
  });

  it("registers discovery, send and group management as guarded tools", async () => {
    const h = await setup();
    expect(h.registerTool.mock.calls[0][1]).toEqual({
      names: [
        "send_message",
        "create_group",
        "talk",
        "list_chats",
        "manage_chat",
      ],
    });
    const first = await h.inGroup("Tea", ["Hello"]);
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
    // "Hello" and Bob's rename line, each to all three.
    expect(append).toHaveBeenCalledTimes(6);
    vi.spyOn(h.api.runtime.agent, "resolveAgentIdentity").mockReturnValue({
      name: "Bob",
    });
    const reply = await h.execute(
      { sessionKey, messages: ["See you there"] },
      bob,
    );
    expect(reply.details.recipients).toEqual(["alice", "carol"]);
    expect(
      append.mock.calls
        .slice(6)
        .map(([params]) => params.message.__openclaw?.senderId),
    ).toEqual(["bob", "bob", "bob"]);
  });

  it("rejects invalid management arguments, unknown additions and expired membership edits", async () => {
    const h = await setup();
    const first = await h.inGroup("Tea", ["Hello"]);
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
      expect.objectContaining({
        title: "Tea",
        members: ["alice", "bob", "carol"],
      }),
    ]);
    await expect(
      h.executeTool("list_chats", {}, { sessionKey: "agent:bob:brain" }),
    ).rejects.toThrow("brain");
    expect(append).toHaveBeenCalledTimes(3);
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
    // Own copies too: the catalog only projects sender identity for user rows.
    expect(append.mock.calls.map(([params]) => params.message.role)).toEqual([
      "user",
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
        sessionKey: "chat:direct:bob",
        messages: ["Hi"],
        sender: "carol",
      }),
    ).rejects.toThrow();
    await expect(
      h.execute({ sessionKey: "chat:direct:missing", messages: ["Hi"] }),
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
    expect(append.mock.calls[0][0].message.__openclaw?.senderName).toBe(
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

  it("forwards what happens in others' chats to observers, wrapped as observed", async () => {
    const broadcast = vi.fn();
    const h = await setup(
      {},
      {
        observer: true,
        broadcaster: { broadcast, subscribe: vi.fn(() => () => {}) } as never,
      },
    );
    const observed = () =>
      broadcast.mock.calls
        .map(([event]) => event)
        .filter((event) => event.type === "observed")
        .map((event) => event.event);

    const theirs = await h.messaging.send("alice", "Alice", {
      requestId: "agents-only",
      members: ["bob"],
      text: "between us",
    });
    expect(observed()).toEqual(
      expect.arrayContaining([
        { type: "chats" },
        expect.objectContaining({
          type: "message",
          chatId: theirs.chatId,
          message: expect.objectContaining({ text: "between us" }),
        }),
      ]),
    );
    await h.messaging.setTyping("alice", "Alice", theirs.sessionKey, "typing");
    expect(observed()).toContainEqual(
      expect.objectContaining({ type: "typing", isTyping: true }),
    );

    // The player's own chats reach them by the audience-filtered stream.
    broadcast.mockClear();
    const mine = await h.messaging.send("user:sensei", "Sensei", {
      requestId: "player",
      members: ["alice"],
      text: "hello",
    });
    expect(observed().map((event) => event.type)).toEqual(["chats"]);
    await h.messaging.setTyping(
      "alice",
      "Alice",
      "agent:alice:chat:direct:user:sensei",
      "typing",
    );
    expect(observed().map((event) => event.type)).toEqual(["chats"]);
    expect(mine.chatId).toBeDefined();
  });

  it("serves observed chats and any chat's history only when observing is on", async () => {
    const off = await setup();
    expect(off.routes.has("/kazusa/observe/chats")).toBe(false);
    expect(off.routes.has("/kazusa/observe/messages")).toBe(false);

    const h = await setup({}, { observer: true });
    const theirs = await h.messaging.send("alice", "Alice", {
      requestId: "agents-only",
      members: ["bob"],
      text: "between us",
    });
    await h.messaging.send("user:sensei", "Sensei", {
      requestId: "player",
      members: ["alice"],
      text: "hello",
    });
    async function get(routePath: string, url = routePath) {
      const route = h.routes.get(routePath);
      if (!route) throw new Error(`Missing route: ${routePath}`);
      let body = "";
      await route.handler(
        Object.assign(Readable.from([]), {
          method: "GET",
          url,
          headers: { authorization: "Bearer test-service-token" },
          socket: new Socket(),
        }) as unknown as IncomingMessage,
        {
          writeHead: () => {},
          setHeader: () => {},
          end: (data: string) => {
            body = data;
          },
        } as unknown as ServerResponse,
      );
      return JSON.parse(body) as unknown;
    }

    const parsedChats = ObservedChatsResponseSchema.parse(
      await get("/kazusa/observe/chats"),
    );
    expect(parsedChats.chats).toEqual([
      expect.objectContaining({
        id: theirs.chatId,
        type: "direct",
        name: "",
        members: ["alice", "bob"],
        lastMessage: expect.objectContaining({
          text: "between us",
          senderId: "alice",
        }),
      }),
    ]);
    expect(parsedChats.chats[0]).not.toHaveProperty("sessionKey");
    expect(
      MessagesResponseSchema.parse(
        await get(
          "/kazusa/observe/messages",
          `/kazusa/observe/messages?chatId=${theirs.chatId}`,
        ),
      ).messages.map((message) => message.text),
    ).toEqual(["between us"]);
  });

  it("keeps an event stream open through backpressure", async () => {
    const h = await setup();
    const route = h.routes.get("/kazusa/events");
    if (!route) throw new Error("Missing route: /kazusa/events");
    const chunks: string[] = [];
    const res = Object.assign(new EventEmitter(), {
      destroyed: false,
      writableEnded: false,
      writableLength: 0,
      setHeader: () => {},
      writeHead: () => {},
      // A full socket buffer: Node keeps the chunk and returns false.
      write: (chunk: string) => {
        chunks.push(chunk);
        return false;
      },
      end: () => {
        res.writableEnded = true;
      },
      destroy: () => {
        res.destroyed = true;
      },
    });
    const req = Object.assign(Readable.from([]), {
      method: "GET",
      url: "/kazusa/events",
      headers: { authorization: "Bearer test-service-token" },
      socket: new Socket(),
    });
    await route.handler(
      req as unknown as IncomingMessage,
      res as unknown as ServerResponse,
    );
    expect(chunks[0]).toContain("event: connected");
    expect(res.writableEnded).toBe(false);
    // Unhandled, this event would end the process.
    expect(res.listenerCount("error")).toBeGreaterThan(0);
    res.emit("close");
  });

  it("refuses visitor messages, typing and membership changes before touching the world", async () => {
    const h = await setup();
    for (const path of ["send", "typing", "chats/manage"]) {
      const route = h.routes.get(`/kazusa/${path}`);
      if (!route) throw new Error(`Missing route: ${path}`);
      const req = Object.assign(Readable.from([Buffer.from("not json")]), {
        method: "POST",
        url: `/kazusa/${path}`,
        headers: {
          authorization: "Bearer test-service-token",
          "x-kazusa-role": "visitor",
        },
        socket: new Socket(),
      });
      let status = 0;
      await route.handler(
        req as unknown as IncomingMessage,
        {
          setHeader: () => {},
          writeHead: (code: number) => {
            status = code;
          },
          end: () => {},
        } as unknown as ServerResponse,
      );
      expect(status).toBe(403);
      expect(req.readableDidRead).toBe(false);
    }
    expect(h.chats.size).toBe(0);
    expect(h.retained.size).toBe(0);
    expect(h.receive).not.toHaveBeenCalled();
    expect(h.patchSessionEntry).not.toHaveBeenCalled();
  });

  it("registers Gateway HTTP routes and handles chats, messages, and send", async () => {
    const h = await setup();
    Object.assign(h.api.config.agents ?? {}, {
      defaults: { systemAgent: { agentId: "alice" } },
    });
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
          headers: { authorization: "Bearer test-service-token" },
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

    const roster = await invoke("/kazusa/agents");
    expect(roster.body).toMatchObject({
      agents: [
        { id: "alice", isSystemAgent: true },
        { id: "bob", isSystemAgent: false },
        { id: "carol", isSystemAgent: false },
      ],
    });
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
