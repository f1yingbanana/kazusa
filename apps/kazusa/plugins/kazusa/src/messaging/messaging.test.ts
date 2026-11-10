import { z } from "zod";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  Messaging,
  createMessagingState,
  type MessageCopy,
  type MessageDelivery,
  type MessagingDeps,
  type MessagingState,
  type OutboxPlan,
  clientMessage,
} from "./messaging.ts";
import type { ChatConversation, SendMessageParams } from "./conversations.ts";
import { stimulusKey } from "../stimulus.ts";
import { mirroredStore } from "./message-store.fake.ts";
import type { MessageStore } from "./message-database.ts";

const NOW = Date.parse("2026-10-26T12:00:00Z");
const active: Messaging[] = [];

function setup(
  retained = new Map<string, MessageDelivery>(),
  committed = new Map<string, { timestamp: number; text: string }>(),
  chats = new Map<string, ChatConversation>(),
  outbox = new Map<string, OutboxPlan>(),
  /** Where each participant stands, for huddles. */
  places = new Map<string, string>(),
  /** Another instance's state, as the plugin shares it in one process. */
  state?: MessagingState,
  /**
   * Lets go of speech frozen on the paused test clock. Released by default, so
   * a paused test world says everything at once.
   */
  release: AbortSignal = AbortSignal.abort(),
  /** More dependencies, such as the floor judgment. */
  extra: Partial<MessagingDeps> = {},
) {
  let now = NOW;
  // Paused unless a test runs the world: then sim time follows the wall clock.
  let speed = 0;
  let anchor = Date.now();
  const simNow = () => now + Math.round((Date.now() - anchor) * speed);
  const store = mirroredStore(retained, () => NOW);
  const register = vi.fn<MessageStore["register"]>(
    async (key, value, options) => {
      z.json().parse(value);
      await store.register(key, value, options);
    },
  );
  const append = vi.fn(async (delivery: MessageDelivery, copy: MessageCopy) => {
    const key = `${delivery.id}:${copy.agentId}`;
    if (!committed.has(key))
      committed.set(key, {
        timestamp: delivery.timestamp,
        text: delivery.params.text,
      });
    return key;
  });
  const receive = vi.fn<MessagingDeps["receive"]>(async () => {});
  const ensureSession = vi.fn<MessagingDeps["ensureSession"]>(
    async (copy) => `session:${copy.sessionKey}`,
  );
  const publish = vi.fn(async () => {});
  const warn = vi.fn();
  const messaging = new Messaging({
    api: {
      lifecycle: {
        runInBackgroundContext: async (run: () => Promise<unknown>) => run(),
      },
    } as unknown as import("openclaw/plugin-sdk/core").OpenClawPluginApi,
    ...(state ? { state } : {}),
    store: { ...store, register },
    conversations: {
      lookup: async (key) => structuredClone(chats.get(key)),
      register: async (key, value, options) => {
        options?.assertCurrent?.();
        z.json().parse(value);
        chats.set(key, structuredClone(value));
      },
      entries: async () =>
        [...chats].map(([key, value]) => ({
          key,
          value: structuredClone(value),
          createdAt: NOW,
        })),
    },
    outbox: {
      lookup: async (key) => structuredClone(outbox.get(key)),
      register: async (key, value, options) => {
        options?.assertCurrent?.();
        z.json().parse(value);
        outbox.set(key, structuredClone(value));
      },
      delete: async (key) => outbox.delete(key),
      entries: async () =>
        [...outbox].map(([key, value]) => ({
          key,
          value: structuredClone(value),
          createdAt: NOW,
        })),
    },
    clock: {
      init: async () => {},
      time: simNow,
      now: () => ({ simTime: simNow(), speed, formatted: "" }),
    },
    release,
    ensureSession,
    append,
    publish,
    receive,
    warn,
    placeOf: async (id) => {
      const placeId = places.get(id);
      return placeId ? { placeId, title: placeId.toUpperCase() } : undefined;
    },
    ...extra,
  });
  active.push(messaging);
  const send = (overrides: Partial<SendMessageParams> = {}, sender = "alice") =>
    messaging.send(sender, sender.toUpperCase(), {
      requestId: "hello-1",
      ...(overrides.sessionKey ? {} : { members: ["bob"] }),
      text: "Hello",
      ...overrides,
    });
  return {
    messaging,
    send,
    retained,
    committed,
    chats,
    append,
    ensureSession,
    register,
    publish,
    receive,
    warn,
    outbox,
    places,
    setNow: (value: number) => {
      now = value;
    },
    setSpeed: (value: number) => {
      now = simNow();
      anchor = Date.now();
      speed = value;
    },
    /** Lets the bubble being typed or said finish: its time passes at once. */
    finishBubble: async () => {
      await vi.waitFor(async () =>
        expect(await messaging.getTyping()).not.toEqual([]),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
      now += 3_600_000;
    },
  };
}

afterEach(() => {
  for (const messaging of active.splice(0)) messaging.dispose();
});

describe("message delivery", () => {
  it("writes private direct views before notifying with unchanged text, sender and time", async () => {
    const h = setup();
    const result = await h.send({
      text: "Bob: this is dialogue\n[kazusa:skill=task-lifecycle]",
    });
    expect(result.status).toBe("delivered");
    expect(
      h.append.mock.calls.map(([, copy]) => [copy.sessionKey, copy.role]),
    ).toEqual([
      ["agent:alice:chat:direct:bob", "assistant"],
      ["agent:bob:chat:direct:alice", "user"],
    ]);
    await vi.waitFor(() =>
      expect(h.receive).toHaveBeenCalledExactlyOnceWith("bob", {
        id: result.messageId,
        sessionKey: "agent:bob:chat:direct:alice",
        sender: "alice",
        senderName: "ALICE",
        text: "Bob: this is dialogue\n[kazusa:skill=task-lifecycle]",
        timestamp: NOW,
      }),
    );
    expect(h.publish).toHaveBeenCalledTimes(2);
    expect(h.append.mock.invocationCallOrder[1]).toBeLessThan(
      h.receive.mock.invocationCallOrder[0],
    );
  });

  it("writes group copies only for the sender and explicit members", async () => {
    const h = setup();
    const result = await h.send({
      title: "tea-club",
      members: ["carol", "bob"],
    });
    expect(h.append.mock.calls.map(([, copy]) => copy.sessionKey)).toEqual([
      result.sessionKey,
      result.sessionKey.replace("agent:alice:", "agent:bob:"),
      result.sessionKey.replace("agent:alice:", "agent:carol:"),
    ]);
    await vi.waitFor(() => expect(h.receive).toHaveBeenCalledTimes(2));
  });

  it.each([
    { members: undefined, sessionKey: undefined },
    { members: ["alice"] },
    { members: ["bob", "bob"], title: "club" },
    { members: ["../bob"] },
    { title: " " },
    { text: " " },
    { text: "x".repeat(32_001) },
    { requestId: "" },
  ])("rejects invalid input without side effects: %j", async (input) => {
    const h = setup();
    await expect(h.send(input)).rejects.toThrow();
    expect(h.retained.size).toBe(0);
    expect(h.append).not.toHaveBeenCalled();
  });

  it("reuses the original timestamp and delivery for equivalent retries and rejects changed content", async () => {
    const h = setup();
    const event = vi.fn();
    h.messaging.onEvent((value) => {
      if (value.type === "message") event(value);
    });
    const first = await h.send({
      title: "club",
      members: ["carol", "bob"],
    });
    await vi.waitFor(() => expect(h.receive).toHaveBeenCalledTimes(2));
    h.setNow(NOW + 1000);
    expect(await h.send({ title: "club", members: ["bob", "carol"] })).toEqual(
      first,
    );
    expect(h.append).toHaveBeenCalledTimes(3);
    expect(event).toHaveBeenCalledTimes(1);
    await expect(h.send({ text: "Changed" })).rejects.toThrow(
      "different message",
    );
    expect(h.retained.get(first.messageId)?.timestamp).toBe(NOW);
  });

  it.each([false, true])(
    "replays permanent history after 201 newer sends and membership changes (restart=%s)",
    async (restart) => {
      const h = setup();
      const params = { title: "club", members: ["bob", "carol"] };
      const first = await h.send(params);
      for (let i = 0; i < 201; i++) {
        await h.send({ requestId: `later-${i}`, sessionKey: first.sessionKey });
      }
      await vi.waitFor(() => {
        expect(
          [...h.retained.values()].every((message) =>
            message.copies.every(
              (copy) =>
                copy.published && (copy.role === "assistant" || copy.notified),
            ),
          ),
        ).toBe(true);
      });
      await h.messaging.manageChat("alice", {
        sessionKey: first.sessionKey,
        action: "add_members",
        members: ["dave"],
      });
      await h.messaging.manageChat("alice", {
        sessionKey: first.sessionKey,
        action: "leave",
      });
      // Both changes were announced in the chat; let those deliveries settle.
      await vi.waitFor(() => {
        expect(
          [...h.retained.values()].every((message) =>
            message.copies.every(
              (copy) =>
                copy.published && (copy.role === "assistant" || copy.notified),
            ),
          ),
        ).toBe(true);
      });
      if (restart) h.messaging.dispose();
      const replay = restart ? setup(h.retained, h.committed, h.chats) : h;
      replay.setNow(NOW + 1000);
      replay.append.mockClear();
      replay.receive.mockClear();
      expect(await replay.send(params)).toEqual(first);
      await replay.messaging.resume();
      expect(replay.append).not.toHaveBeenCalled();
      expect(replay.receive).not.toHaveBeenCalled();
      expect(h.retained.get(first.messageId)?.timestamp).toBe(NOW);
      expect(h.retained.size).toBe(204);
      await expect(replay.send({ ...params, text: "Changed" })).rejects.toThrow(
        "different message",
      );
    },
  );

  it("scopes request IDs to each authenticated sender", async () => {
    const h = setup();
    const a = await h.send();
    const b = await h.send({ members: ["alice"] }, "bob");
    expect(a.messageId).not.toBe(b.messageId);
    expect(h.committed.size).toBe(4);
  });

  it("retains partial group delivery and recovers only missing copies after restart", async () => {
    const h = setup();
    const append = h.append.getMockImplementation();
    h.append.mockImplementation(async (delivery, copy) => {
      if (copy.agentId === "carol") throw new Error("disk unavailable");
      return (await append?.(delivery, copy)) ?? "";
    });
    const result = await h.send({
      title: "club",
      members: ["bob", "carol"],
    });
    expect(result.status).toBe("pending");
    await vi.waitFor(() => expect(h.receive).toHaveBeenCalledTimes(1));
    expect(h.receive.mock.calls[0]?.[0]).toBe("bob");
    h.messaging.dispose();
    const recovered = setup(h.retained, h.committed, h.chats);
    recovered.setNow(NOW + 60_000);
    await recovered.messaging.resume();
    await vi.waitFor(() => expect(recovered.receive).toHaveBeenCalledTimes(1));
    expect(recovered.append.mock.calls.map(([, copy]) => copy.agentId)).toEqual(
      ["carol"],
    );
    expect(recovered.receive.mock.calls[0]).toEqual([
      "carol",
      expect.objectContaining({ timestamp: NOW, id: result.messageId }),
    ]);
    expect(h.committed.size).toBe(3);
  });

  it("replays stable copy identities after commit succeeded but its receipt could not be saved", async () => {
    const h = setup();
    const save = h.register.getMockImplementation();
    let fail = true;
    h.register.mockImplementation(async (key, value, options) => {
      if (fail && value.copies.some((copy) => copy.messageId))
        throw new Error("receipt failure");
      await save?.(key, value, options);
    });
    expect((await h.send()).status).toBe("pending");
    expect(h.committed.size).toBe(2);
    expect(h.receive).not.toHaveBeenCalled();
    fail = false;
    h.messaging.dispose();
    const recovered = setup(h.retained, h.committed, h.chats);
    await recovered.messaging.resume();
    expect(h.committed.size).toBe(2);
    expect(recovered.append.mock.calls[0][1].sessionId).toBe(
      h.append.mock.calls[0][1].sessionId,
    );
    expect(recovered.append.mock.results).toHaveLength(2);
  });

  it("does not accept or append if initial durable acceptance fails or invocation expires", async () => {
    const h = setup();
    h.register.mockRejectedValueOnce(new Error("store unavailable"));
    await expect(h.send()).rejects.toThrow("store unavailable");
    expect(h.append).not.toHaveBeenCalled();
    await expect(
      h.messaging.send(
        "alice",
        "Alice",
        { requestId: "r", members: ["bob"], text: "Hi" },
        () => {
          throw new Error("expired");
        },
      ),
    ).rejects.toThrow("expired");
    expect(h.retained.size).toBe(0);
  });

  it("keeps older unfinished copies ahead of newer concurrent group sends", async () => {
    const h = setup();
    h.append.mockRejectedValue(new Error("offline"));
    const first = await h.send({ title: "club", members: ["bob", "carol"] });
    h.setNow(NOW + 1000);
    expect(
      (
        await h.send({
          requestId: "next",
          sessionKey: first.sessionKey,
        })
      ).status,
    ).toBe("pending");
    h.append.mockImplementation(async (delivery, copy) => {
      const key = `${delivery.id}:${copy.agentId}`;
      h.committed.set(key, {
        timestamp: delivery.timestamp,
        text: delivery.params.text,
      });
      return key;
    });
    await Promise.all([
      h.messaging.resume(),
      h.send(
        {
          requestId: "third",
          sessionKey: first.sessionKey.replace("agent:alice:", "agent:bob:"),
        },
        "bob",
      ),
    ]);
    expect([...h.committed.values()].map((item) => item.timestamp)).toEqual([
      NOW,
      NOW,
      NOW,
      NOW + 1000,
      NOW + 1000,
      NOW + 1000,
      NOW + 1000,
      NOW + 1000,
      NOW + 1000,
    ]);
  });

  it("retries publication and perception failures without rewriting ledgers", async () => {
    const h = setup();
    h.publish.mockRejectedValueOnce(new Error("subscriber unavailable"));
    h.receive.mockRejectedValueOnce(new Error("inbox unavailable"));
    await h.send();
    await vi.waitFor(() => expect(h.warn).toHaveBeenCalledTimes(2));
    await h.messaging.resume();
    await vi.waitFor(() => expect(h.receive).toHaveBeenCalledTimes(2));
    expect(h.append).toHaveBeenCalledTimes(2);
    expect(h.receive.mock.calls[0]).toEqual(h.receive.mock.calls[1]);
  });

  it("blocks only the failing ledger and preserves its order when it recovers", async () => {
    const h = setup();
    const append = h.append.getMockImplementation();
    let offline = true;
    h.append.mockImplementation(async (delivery, copy) => {
      if (offline && copy.agentId === "carol")
        throw new Error("Carol unavailable");
      return (await append?.(delivery, copy)) ?? "";
    });
    const first = await h.send({ title: "club", members: ["bob", "carol"] });
    h.setNow(NOW + 1000);
    await h.send(
      {
        requestId: "second",
        sessionKey: first.sessionKey.replace("agent:alice:", "agent:bob:"),
      },
      "bob",
    );
    expect(h.committed.size).toBe(4);
    offline = false;
    h.append.mockClear();
    await h.messaging.resume();
    expect(
      h.append.mock.calls.map(([delivery, copy]) => [
        copy.agentId,
        delivery.timestamp,
      ]),
    ).toEqual([
      ["carol", NOW],
      ["carol", NOW + 1000],
    ]);
  });

  it("does not hold the ledger queue or wait for a recipient who sends an immediate reply", async () => {
    const h = setup();
    h.receive.mockImplementationOnce(async () => {
      await h.send(
        { requestId: "reply", members: ["alice"], text: "Hello back" },
        "bob",
      );
    });
    expect((await h.send()).status).toBe("delivered");
    await vi.waitFor(() => expect(h.committed.size).toBe(4));
  });

  it("retries automatically and stops background work on disposal", async () => {
    vi.useFakeTimers();
    try {
      const h = setup();
      h.append.mockRejectedValueOnce(new Error("temporary"));
      await h.send();
      await vi.advanceTimersByTimeAsync(1000);
      expect(h.committed.size).toBe(2);
      h.messaging.dispose();
      await vi.advanceTimersByTimeAsync(5000);
      expect(h.append).toHaveBeenCalledTimes(3);
      await expect(h.send({ requestId: "stale" })).rejects.toThrow();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("conversation routing and management", () => {
  it("reuses direct pairs and lets either member reply by its own session key", async () => {
    const h = setup();
    const first = await h.send();
    expect(first.sessionKey).toBe("agent:alice:chat:direct:bob");
    const reply = await h.send(
      { requestId: "reply", sessionKey: "chat:direct:alice" },
      "bob",
    );
    expect(reply.recipients).toEqual(["alice"]);
    await h.send({ requestId: "again", members: ["alice"] }, "bob");
    expect(h.chats.size).toBe(1);
    expect(await h.messaging.listChats("bob")).toEqual([
      {
        sessionKey: "agent:bob:chat:direct:alice",
        kind: "direct",
        title: "alice",
        members: ["alice", "bob"],
      },
    ]);
  });

  it("auto-creates first-time direct chat from sessionKey and drops unnecessary fields", async () => {
    const h = setup();
    const first = await h.send({
      sessionKey: "chat:direct:bob",
      members: ["bob"],
      title: "Ignored Title",
    });
    expect(first.status).toBe("delivered");
    expect(first.sessionKey).toBe("agent:alice:chat:direct:bob");
    expect(first.recipients).toEqual(["bob"]);
    expect(h.chats.size).toBe(1);
    expect(await h.messaging.listChats("bob")).toEqual([
      {
        sessionKey: "agent:bob:chat:direct:alice",
        kind: "direct",
        title: "alice",
        members: ["alice", "bob"],
      },
    ]);
  });

  it("discovers only current memberships and resolves group replies without member lists", async () => {
    const h = setup();
    const group = await h.send({
      members: ["bob", "carol"],
      title: "Tea Club",
    });
    await h.send({ requestId: "private", members: ["dave"] });
    const chats = await h.messaging.listChats("bob", { query: "TEA" });
    expect(chats).toEqual([
      {
        sessionKey: group.sessionKey.replace("agent:alice:", "agent:bob:"),
        kind: "group",
        title: "Tea Club",
        members: ["alice", "bob", "carol"],
      },
    ]);
    expect(await h.messaging.listChats("bob", { query: "dave" })).toEqual([]);
    expect(await h.messaging.listChats("outsider")).toEqual([]);
    expect(
      (
        await h.send(
          { sessionKey: chats[0].sessionKey, requestId: "reply" },
          "bob",
        )
      ).recipients,
    ).toEqual(["alice", "carol"]);
    expect(await h.messaging.listChats("bob")).toHaveLength(1);
  });

  it("sends to the direct chat when a title names only one other person", async () => {
    const h = setup();
    const direct = await h.send();
    const titled = await h.send({ requestId: "group", title: "Weekend Plans" });
    expect(titled.sessionKey).toBe(direct.sessionKey);
    expect(titled.recipients).toEqual(["bob"]);
    expect(await h.messaging.listChats("alice")).toEqual([
      expect.objectContaining({ kind: "direct", title: "bob" }),
    ]);
  });

  it("lets any member rename, add or remove members, and leave without copying history", async () => {
    const h = setup();
    const first = await h.send({ members: ["bob", "carol"], title: "Tea" });
    const sessionKey = first.sessionKey.replace("agent:alice:", "agent:bob:");
    await h.messaging.manageChat("bob", {
      action: "rename",
      sessionKey,
      title: "Lunch",
    });
    await h.messaging.manageChat("bob", {
      action: "add_members",
      sessionKey,
      members: ["dave"],
    });
    await h.messaging.manageChat("bob", {
      action: "remove_members",
      sessionKey,
      members: ["carol"],
    });
    // The first message to three, then each change told to the chat: the
    // rename to three, the addition to the four now in it, and the removal to
    // the four still in it before Carol goes.
    expect(h.append).toHaveBeenCalledTimes(14);
    const lines = [...h.retained.values()]
      .sort((a, b) => a.sequence - b.sequence)
      .map((message) => [
        message.params.type,
        message.params.text,
        [...message.audience].sort(),
      ]);
    // Told as actions: the stored text is plain; characters read it starred.
    expect(lines.slice(1)).toEqual([
      ["action", 'renames the chat to "Lunch"', ["alice", "bob", "carol"]],
      ["action", "adds dave to the chat", ["alice", "bob", "carol", "dave"]],
      [
        "action",
        "removes carol from the chat",
        ["alice", "bob", "carol", "dave"],
      ],
    ]);
    expect(await h.messaging.listChats("carol")).toEqual([]);
    const [joined] = await h.messaging.listChats("dave");
    expect(joined).toMatchObject({
      title: "Lunch",
      members: ["alice", "bob", "dave"],
    });
    expect(h.ensureSession).toHaveBeenCalledWith(
      { agentId: "dave", sessionKey: joined.sessionKey },
      "Lunch",
    );
    expect(
      (
        await h.send(
          { requestId: "new", sessionKey: joined.sessionKey },
          "dave",
        )
      ).recipients,
    ).toEqual(["alice", "bob"]);
    await h.messaging.manageChat("bob", { action: "leave", sessionKey });
    expect(await h.messaging.listChats("bob")).toEqual([]);
    expect((await h.messaging.listChats("dave"))[0].members).toEqual([
      "alice",
      "dave",
    ]);
  });

  it("rejects foreign keys, outsiders, removed members and edits to direct chats", async () => {
    const h = setup();
    const group = await h.send({ members: ["bob", "carol"] });
    await expect(
      h.send({ requestId: "foreign", sessionKey: group.sessionKey }, "bob"),
    ).rejects.toThrow("own chat");
    await expect(
      h.send({ requestId: "unknown", sessionKey: "chat:group:missing" }),
    ).rejects.toThrow("unavailable");
    const outsiderKey = group.sessionKey.replace("agent:alice:", "agent:dave:");
    await expect(
      h.messaging.manageChat("dave", {
        action: "add_members",
        sessionKey: outsiderKey,
        members: ["dave"],
      }),
    ).rejects.toThrow("unavailable");
    await h.messaging.manageChat("alice", {
      action: "remove_members",
      sessionKey: group.sessionKey,
      members: ["carol"],
    });
    await expect(
      h.send(
        {
          requestId: "removed",
          sessionKey: group.sessionKey.replace("agent:alice:", "agent:carol:"),
        },
        "carol",
      ),
    ).rejects.toThrow("unavailable");
    const direct = await h.send({ requestId: "direct" });
    await expect(
      h.messaging.manageChat("bob", {
        action: "leave",
        sessionKey: "chat:direct:alice",
      }),
    ).rejects.toThrow("fixed membership");
    expect(direct.recipients).toEqual(["bob"]);
  });

  it("freezes pending recipients across membership edits, removal of the sender and restart", async () => {
    const h = setup();
    const append = h.append.getMockImplementation();
    h.append.mockImplementation(async (delivery, copy) => {
      if (copy.agentId === "carol") throw new Error("offline");
      return (await append?.(delivery, copy)) ?? "";
    });
    const original = { members: ["bob", "carol"], title: "Tea" };
    const first = await h.send(original);
    expect(first.status).toBe("pending");
    const sessionKey = first.sessionKey.replace("agent:alice:", "agent:bob:");
    await h.messaging.manageChat("bob", {
      action: "add_members",
      sessionKey,
      members: ["dave"],
    });
    await h.messaging.manageChat("bob", {
      action: "remove_members",
      sessionKey,
      members: ["alice", "carol"],
    });
    h.messaging.dispose();
    const recovered = setup(h.retained, h.committed, h.chats);
    const retry = await recovered.send(original);
    expect(retry).toEqual({ ...first, status: "delivered" });
    expect(recovered.append.mock.calls.map(([, copy]) => copy.agentId)).toEqual(
      // The first message, and the two changes Carol was told of.
      ["carol", "carol", "carol"],
    );
    expect(recovered.committed.has(`${first.messageId}:dave`)).toBe(false);
    expect(
      (await recovered.send({ requestId: "later", sessionKey }, "bob"))
        .recipients,
    ).toEqual(["dave"]);
    expect(await recovered.messaging.listChats("alice")).toEqual([]);
  });

  it("serializes membership edits with send acceptance", async () => {
    const h = setup();
    const group = await h.send({ members: ["bob", "carol"] });
    const before = h.send({
      requestId: "before",
      sessionKey: group.sessionKey,
    });
    const edit = h.messaging.manageChat("bob", {
      action: "remove_members",
      sessionKey: group.sessionKey.replace("agent:alice:", "agent:bob:"),
      members: ["carol"],
    });
    const after = h.send({ requestId: "after", sessionKey: group.sessionKey });
    const [first, , last] = await Promise.all([before, edit, after]);
    expect(first.recipients).toEqual(["bob", "carol"]);
    expect(last.recipients).toEqual(["bob"]);
  });

  it("gives each new group a short id of its own", async () => {
    // Live: 64-character hashes cost tokens in every reply and were miscopied.
    const h = setup();
    const tea = await h.send({ title: "Tea", members: ["bob", "carol"] });
    const lunch = await h.send({
      requestId: "hello-2",
      title: "Lunch",
      members: ["bob", "carol"],
    });
    expect(tea.sessionKey).toMatch(/^agent:alice:chat:group:[0-9a-z]{10}$/);
    expect(lunch.sessionKey).not.toBe(tea.sessionKey);
    const reply = await h.send(
      {
        requestId: "reply",
        sessionKey: tea.sessionKey.slice("agent:alice:".length),
      },
      "alice",
    );
    expect(reply.chatId).toBe(tea.chatId);
  });

  it("retains failed native title projections and retries without writing dialogue", async () => {
    const h = setup();
    const group = await h.send({ title: "Tea", members: ["bob", "carol"] });
    h.ensureSession.mockRejectedValueOnce(new Error("session store offline"));
    expect(
      await h.messaging.manageChat("bob", {
        action: "rename",
        sessionKey: group.sessionKey.replace("agent:alice:", "agent:bob:"),
        title: "Lunch",
      }),
    ).toMatchObject({ title: "Lunch" });
    expect([...h.chats.values()][0].needsProjection).toBe(true);
    h.messaging.dispose();
    const recovered = setup(h.retained, h.committed, h.chats);
    await recovered.messaging.resume();
    expect([...h.chats.values()][0].needsProjection).toBe(false);
    expect(
      recovered.ensureSession.mock.calls.map(([, title]) => title),
    ).toEqual(["Lunch", "Lunch", "Lunch"]);
    expect(recovered.append).not.toHaveBeenCalled();
  });

  it("delivers directly to human users without creating agent sessions or waking brains", async () => {
    const h = setup();
    const sent = await h.send({
      requestId: "msg-user-1",
      members: ["user:sensei"],
      text: "Hello Sensei!",
    });
    expect(sent.status).toBe("delivered");
    expect(sent.recipients).toEqual(["user:sensei"]);
    expect(h.retained.get(sent.messageId)?.audience).toEqual([
      "alice",
      "user:sensei",
    ]);
    expect(
      h.retained.get(sent.messageId)?.copies.map((copy) => copy.agentId),
    ).toEqual(["alice"]);
    expect(sent.sessionKey).toBe("agent:alice:chat:direct:user:sensei");

    // Sender copy is appended to Alice's ledger
    expect(h.committed.has(`${sent.messageId}:alice`)).toBe(true);
    expect(h.committed.get(`${sent.messageId}:alice`)?.text).toBe(
      "Hello Sensei!",
    );

    // Human copy never attempts session creation or perception wake
    expect(
      h.ensureSession.mock.calls.some(
        ([copy]) => copy.agentId === "user:sensei",
      ),
    ).toBe(false);
    expect(h.receive).not.toHaveBeenCalledWith(
      "user:sensei",
      expect.anything(),
    );

    // Reply using sessionKey works without error
    const reply = await h.send({
      requestId: "msg-user-2",
      sessionKey: "agent:alice:chat:direct:user:sensei",
      text: "Are you coming today?",
    });
    expect(reply.status).toBe("delivered");
    expect(reply.recipients).toEqual(["user:sensei"]);
  });

  it("opens a direct conversation from a human address and fans out only to the agent", async () => {
    const h = setup();
    const result = await h.messaging.send("user:sensei", "Sensei", {
      requestId: "human-direct",
      sessionKey: "chat:direct:alice",
      text: "Hello Alice",
    });
    expect(result.sessionKey).toBe("chat:direct:alice");
    expect(result.recipients).toEqual(["alice"]);
    expect(
      h.append.mock.calls.map(([, copy]) => [copy.sessionKey, copy.role]),
    ).toEqual([["agent:alice:chat:direct:user:sensei", "user"]]);
    await vi.waitFor(() =>
      expect(h.receive).toHaveBeenCalledExactlyOnceWith(
        "alice",
        expect.objectContaining({ sender: "user:sensei", text: "Hello Alice" }),
      ),
    );
  });

  it("supports group chats containing both agents and human users", async () => {
    const h = setup();
    const group = await h.send({
      requestId: "grp-1",
      title: "Sweets Strategy",
      members: ["bob", "user:sensei"],
      text: "Welcome to the group!",
    });
    expect(group.status).toBe("delivered");
    expect(group.recipients).toEqual(["bob", "user:sensei"]);
    expect(h.retained.get(group.messageId)?.audience).toEqual([
      "alice",
      "bob",
      "user:sensei",
    ]);
    expect(
      h.retained.get(group.messageId)?.copies.map((copy) => copy.agentId),
    ).toEqual(["alice", "bob"]);

    // Bob gets notified; human user does not
    await vi.waitFor(() =>
      expect(h.receive).toHaveBeenCalledWith("bob", expect.anything()),
    );
    expect(h.receive).not.toHaveBeenCalledWith(
      "user:sensei",
      expect.anything(),
    );

    // Adding a user to an existing group chat succeeds
    const agentsGroup = await h.send({
      requestId: "grp-2",
      title: "Club Talk",
      members: ["bob", "carol"],
      text: "Starting club chat",
    });
    const updated = await h.messaging.manageChat("alice", {
      action: "add_members",
      sessionKey: agentsGroup.sessionKey,
      members: ["user:sensei"],
    });
    expect(updated.members).toContain("user:sensei");
  });

  it("strictly respects join and leave timeline boundaries in getChatHistory without history leakage", async () => {
    const h = setup();
    // 1. Alice and Bob chat in a group (messages 1 and 2)
    const grp = await h.send({
      requestId: "msg-1",
      title: "Secret Strategy",
      members: ["bob", "carol"],
      text: "Secret message 1 before Sensei joined",
    });
    const actualChatId = [...h.chats.values()].find(
      (c) => c.title === "Secret Strategy",
    )!.id;

    await h.send({
      requestId: "msg-2",
      sessionKey: grp.sessionKey,
      text: "Secret message 2 before Sensei joined",
    });

    // Sensei is not yet in the chat; getChatHistory returns 0 messages for Sensei
    const preJoinHistory = await h.messaging.getChatHistory({
      chatId: actualChatId,
      userId: "user:sensei",
    });
    expect(preJoinHistory.messages).toHaveLength(0);

    // 2. Alice adds user:sensei
    await h.messaging.manageChat("alice", {
      action: "add_members",
      sessionKey: grp.sessionKey,
      members: ["user:sensei"],
    });

    // 3. Alice sends message 3
    await h.send({
      requestId: "msg-3",
      sessionKey: grp.sessionKey,
      text: "Hello Sensei! Welcome to the group.",
    });

    // 4. Sensei sends message 4
    const senseiSend = await h.messaging.send("user:sensei", "Sensei", {
      sessionKey: `chat:group:${actualChatId.replace("group:", "")}`,
      text: "Thanks Alice! Glad to be here.",
      requestId: "sensei-msg-4",
    });
    expect(senseiSend.status).toBe("delivered");
    expect(senseiSend.recipients).toEqual(["alice", "bob", "carol"]);

    // Both Alice and Bob receive native copies and Perception stimuli from Sensei's message
    await vi.waitFor(() => {
      expect(h.receive).toHaveBeenCalledWith(
        "alice",
        expect.objectContaining({
          sender: "user:sensei",
          text: "Thanks Alice! Glad to be here.",
        }),
      );
      expect(h.receive).toHaveBeenCalledWith(
        "bob",
        expect.objectContaining({
          sender: "user:sensei",
          text: "Thanks Alice! Glad to be here.",
        }),
      );
    });

    // 5. Query Sensei's history: Sensei sees being added, then messages 3 and
    // 4, NOT 1 or 2!
    const senseiHistory = await h.messaging.getChatHistory({
      chatId: actualChatId,
      userId: "user:sensei",
    });
    expect(senseiHistory.messages).toHaveLength(3);
    expect(senseiHistory.messages[0]).toMatchObject({
      text: "adds user:sensei to the chat",
      type: "action",
    });
    expect(senseiHistory.messages[1].text).toBe(
      "Hello Sensei! Welcome to the group.",
    );
    expect(senseiHistory.messages[2].text).toBe(
      "Thanks Alice! Glad to be here.",
    );

    // Alice sees all 4 messages and her line adding Sensei
    const aliceHistory = await h.messaging.getChatHistory({
      chatId: actualChatId,
      userId: "alice",
    });
    expect(aliceHistory.messages).toHaveLength(5);

    // 6. Test cursor pagination for Sensei
    const page1 = await h.messaging.getChatHistory({
      chatId: actualChatId,
      userId: "user:sensei",
      limit: 1,
    });
    expect(page1.messages).toHaveLength(1);
    expect(page1.messages[0].text).toBe("Thanks Alice! Glad to be here.");
    expect(page1.hasMore).toBe(true);
    expect(page1.nextCursor).toBeDefined();

    const page2 = await h.messaging.getChatHistory({
      chatId: actualChatId,
      userId: "user:sensei",
      before: page1.nextCursor,
      limit: 1,
    });
    expect(page2.messages).toHaveLength(1);
    expect(page2.messages[0].text).toBe("Hello Sensei! Welcome to the group.");

    // 7. Test listChats for human user:
    const senseiChats = await h.messaging.listChats("user:sensei");
    expect(senseiChats).toHaveLength(1);
    expect(senseiChats[0].title).toBe("Secret Strategy");
    expect(senseiChats[0].sessionKey).toBe(
      `chat:group:${actualChatId.replace("group:", "")}`,
    );
  });
});

describe("observing chats from outside", () => {
  it("reads any chat in full, whoever it was said to, and pages by sequence", async () => {
    const h = setup();
    const first = await h.send({ requestId: "a", text: "one" });
    await h.send({ requestId: "b", sessionKey: first.sessionKey, text: "two" });
    await h.send({
      requestId: "c",
      sessionKey: first.sessionKey,
      text: "three",
    });

    const page = await h.messaging.observeChatHistory({
      chatId: first.chatId,
      limit: 2,
    });
    expect(page.messages.map((message) => message.text)).toEqual([
      "two",
      "three",
    ]);
    expect(page.hasMore).toBe(true);
    const older = await h.messaging.observeChatHistory({
      chatId: first.chatId,
      before: page.nextCursor,
    });
    expect(older.messages.map((message) => message.text)).toEqual(["one"]);
    // A participant's own view still ends at their frozen audience.
    expect(
      await h.messaging.getChatHistory({
        chatId: first.chatId,
        userId: "user:sensei",
      }),
    ).toMatchObject({ messages: [] });
  });

  it("changes nothing: no membership, no copies, no notifications", async () => {
    const h = setup();
    const first = await h.send();
    // Let delivery finish, so only a read could change anything from here.
    await vi.waitFor(() => {
      expect([...h.retained.values()][0].copies[1].notified).toBe(true);
    });
    const chatsBefore = structuredClone([...h.chats]);
    const retainedBefore = structuredClone([...h.retained]);
    h.append.mockClear();
    h.receive.mockClear();
    const emitted: unknown[] = [];
    h.messaging.onEvent((event) => emitted.push(event));

    await h.messaging.observeChats("user:sensei");
    await h.messaging.observeChatHistory({ chatId: first.chatId });

    expect([...h.chats]).toEqual(chatsBefore);
    expect([...h.retained]).toEqual(retainedBefore);
    expect(h.append).not.toHaveBeenCalled();
    expect(h.receive).not.toHaveBeenCalled();
    expect(emitted).toEqual([]);
  });

  it("lists chats the viewer isn't in, newest first, with no chat of theirs", async () => {
    const h = setup();
    const older = await h.send({ requestId: "dm", text: "hi bob" });
    const newer = await h.send({
      requestId: "group",
      members: ["bob", "carol"],
      title: "Study",
      text: "hi both",
    });
    await h.send(
      { requestId: "mine", members: ["alice"], text: "hello" },
      "user:sensei",
    );

    const observed = await h.messaging.observeChats("user:sensei");
    expect(observed.map(({ chat }) => chat.id)).toEqual([
      newer.chatId,
      older.chatId,
    ]);
    expect(observed[0]).toMatchObject({
      ended: false,
      members: ["alice", "bob", "carol"],
      latest: { sender: "alice", params: { text: "hi both" } },
    });
  });

  it("keeps a dissolved huddle readable, named by who took part", async () => {
    const h = setup();
    h.places.set("alice", "park");
    h.places.set("bob", "park");
    const huddle = await h.send({ aloud: true, text: "nice day" });
    await h.messaging.leavePlace("alice", "Alice", "park", { at: 1 });

    const [ended] = await h.messaging.observeChats("user:sensei");
    expect(ended).toMatchObject({
      ended: true,
      members: ["alice", "bob"],
      chat: { id: huddle.chatId, kind: "huddle", members: [], placeId: "park" },
    });
    expect(
      (await h.messaging.observeChatHistory({ chatId: huddle.chatId })).messages
        .length,
    ).toBeGreaterThan(0);
  });

  it("reports everyone composing to an observer, and only theirs to a member", async () => {
    const h = setup();
    const result = await h.send();
    await h.messaging.setTyping("alice", "Alice", result.sessionKey, "typing");
    expect(await h.messaging.getTyping()).toMatchObject([
      { chatId: result.chatId, senderId: "alice" },
    ]);
    expect(await h.messaging.getTyping("user:sensei")).toEqual([]);
  });
});

describe("composition presence", () => {
  it("is explicit, scoped to current members and cleared on acceptance", async () => {
    const h = setup();
    const result = await h.send({
      members: ["bob", "user:sensei"],
      title: "Club",
    });
    expect(await h.messaging.getTyping("user:sensei")).toEqual([]);
    await h.messaging.setTyping("alice", "Alice", result.sessionKey, "typing");
    expect(await h.messaging.getTyping("user:sensei")).toMatchObject([
      { chatId: result.chatId, senderId: "alice", isTyping: true },
    ]);
    expect(await h.messaging.getTyping("carol")).toEqual([]);
    await expect(
      h.messaging.setTyping(
        "carol",
        "Carol",
        result.sessionKey.replace("agent:alice:", "agent:carol:"),
        "typing",
      ),
    ).rejects.toThrow("unavailable");
    h.messaging.clearTyping("alice", "group:elsewhere");
    expect(await h.messaging.getTyping("bob")).toHaveLength(1);
    await h.send({ requestId: "reply", sessionKey: result.sessionKey });
    expect(await h.messaging.getTyping("bob")).toEqual([]);
  });

  it("expires human activity, removes departed typists and rejects stale invocations", async () => {
    const h = setup();
    const result = await h.send({
      members: ["bob", "user:sensei"],
      title: "Club",
    });
    const humanKey = result.sessionKey.replace("agent:alice:", "");
    await h.messaging.setTyping("user:sensei", "Sensei", humanKey, "typing");
    const time = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 8001);
    expect(await h.messaging.getTyping("alice")).toEqual([]);
    time.mockRestore();
    await h.messaging.setTyping(
      "bob",
      "Bob",
      result.sessionKey.replace("agent:alice:", "agent:bob:"),
      "typing",
    );
    await h.messaging.manageChat("alice", {
      sessionKey: result.sessionKey,
      action: "remove_members",
      members: ["bob"],
    });
    expect(
      (await h.messaging.getTyping("alice")).map((x) => x.senderId),
    ).not.toContain("bob");
    await expect(
      h.messaging.setTyping(
        "alice",
        "Alice",
        result.sessionKey,
        "typing",
        () => {
          throw new Error("expired");
        },
      ),
    ).rejects.toThrow("expired");
    expect(
      (await h.messaging.getTyping("alice")).map((x) => x.senderId),
    ).not.toContain("alice");
  });
});

describe("paced speech", () => {
  const speech = (messages: string[], requestId = "speech-1") => ({
    requestId,
    members: ["bob"],
    messages,
  });
  const texts = (retained: Map<string, MessageDelivery>) =>
    [...retained.values()]
      .sort((a, b) => a.sequence - b.sequence)
      .map((delivery) => delivery.params.text);

  it("types every bubble on the simulation clock and sends each as its own message", async () => {
    const h = setup();
    h.setSpeed(1_000_000);
    const typing: string[] = [];
    h.messaging.onEvent((event) => {
      if (event.type === "typing")
        typing.push(event.typing.isTyping ? event.typing.mode : "sent");
    });
    const result = await h.messaging.speak(
      "alice",
      "ALICE",
      speech(["Wait...", "Are you serious?", "Why?"]),
    );
    expect(result).toMatchObject({
      status: "delivered",
      said: ["Wait...", "Are you serious?", "Why?"],
      unsaid: [],
      sessionKey: "agent:alice:chat:direct:bob",
      recipients: ["bob"],
    });
    expect(result.messageIds).toHaveLength(3);
    expect(texts(h.retained)).toEqual(["Wait...", "Are you serious?", "Why?"]);
    // Thinking is not typing: typing starts before each bubble, the first
    // included, and each send clears it.
    expect(typing).toEqual([
      "typing",
      "sent",
      "typing",
      "sent",
      "typing",
      "sent",
    ]);
    // Each bubble took its typing time: "Wait..." is seven keys.
    const [first] = [...h.retained.values()];
    expect(first.timestamp - NOW).toBeGreaterThanOrEqual(2_333);
    expect(h.outbox.size).toBe(0);
    expect(h.messaging.currentSpeech("alice")).toBeUndefined();
  });

  it("stops at an interrupt and never records the unsaid bubbles", async () => {
    const h = setup();
    h.setSpeed(0.000_001); // Each typing interval would take days of wall time.
    const pending = h.messaging.speak(
      "alice",
      "ALICE",
      speech(["Wait...", "I told you not to go!", "What were you thinking?"]),
    );
    await h.finishBubble();
    await vi.waitFor(() =>
      expect(h.messaging.currentSpeech("alice")).toEqual({
        sessionKey: "agent:alice:chat:direct:bob",
        said: ["Wait..."],
        unsaid: ["I told you not to go!", "What were you thinking?"],
      }),
    );
    expect(h.messaging.interrupt("alice")).toBe(true);
    const result = await pending;
    expect(result).toMatchObject({
      status: "interrupted",
      said: ["Wait..."],
      unsaid: ["I told you not to go!", "What were you thinking?"],
    });
    expect(texts(h.retained)).toEqual(["Wait..."]);
    expect(h.outbox.size).toBe(0);
    expect(await h.messaging.getTyping("bob")).toEqual([]);
    expect(h.messaging.interrupt("alice")).toBe(false);
  });

  it("hands back what stopped it with the result, and says when a send begins", async () => {
    const speaking = vi.fn();
    const h = setup(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { speaking },
    );
    h.setSpeed(0.000_001);
    const pending = h.messaging.speak(
      "alice",
      "ALICE",
      speech(["Wait...", "I told you not to go!"]),
    );
    await vi.waitFor(() => expect(speaking).toHaveBeenCalledWith("alice"));
    expect(
      h.messaging.interrupt("alice", {
        message: "- [Bob] (chat:direct:bob): hi",
      }),
    ).toBe(true);
    expect(await pending).toMatchObject({
      status: "interrupted",
      said: [],
      unsaid: ["Wait...", "I told you not to go!"],
      meanwhile: "- [Bob] (chat:direct:bob): hi",
    });
    // A text being typed when stopped is never sent.
    expect(texts(h.retained)).toEqual([]);
  });

  it("cancels remaining bubbles immediately when the native run aborts on a paused clock", async () => {
    const gateway = new AbortController();
    const invocation = new AbortController();
    const h = setup(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      gateway.signal,
    );
    const pending = h.messaging.speak(
      "alice",
      "ALICE",
      speech(["One", "Two"]),
      undefined,
      undefined,
      undefined,
      invocation.signal,
    );
    await h.finishBubble();
    await vi.waitFor(() => expect(texts(h.retained)).toEqual(["One"]));
    invocation.abort(new Error("Operator stopped run"));
    expect(await pending).toMatchObject({
      status: "interrupted",
      said: ["One"],
      unsaid: ["Two"],
    });
    expect(texts(h.retained)).toEqual(["One"]);
    expect(h.outbox.size).toBe(0);
    expect(await h.messaging.getTyping("bob")).toEqual([]);
  });

  it("holds the next bubble while the world is paused, and goes on when it runs", async () => {
    // Live: paused mid-meeting, every bubble went out at once and four
    // characters talked a hundred lines at one sim instant.
    const stopping = new AbortController();
    const h = setup(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      stopping.signal,
    );
    const result = h.messaging.speak(
      "alice",
      "ALICE",
      speech(["One", "Two", "Three"]),
    );
    await h.finishBubble();
    await vi.waitFor(() => expect(texts(h.retained)).toEqual(["One"]));
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(texts(h.retained)).toEqual(["One"]);
    h.setSpeed(1_000_000);
    expect((await result).status).toBe("delivered");
    expect(texts(h.retained)).toEqual(["One", "Two", "Three"]);
  });

  it("sends every system-agent bubble at once: she is outside the world's time", async () => {
    const stopping = new AbortController();
    const h = setup(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      stopping.signal,
    );
    const result = h.messaging.speak(
      "alice",
      "ALICE",
      speech(["One", "Two"]),
      undefined,
      undefined,
      "alice",
    );
    // No typing, though the world is paused: both go out at once.
    expect((await result).status).toBe("delivered");
    expect(await h.messaging.getTyping()).toEqual([]);
    expect(texts(h.retained)).toEqual(["One", "Two"]);
    expect([...h.retained.values()].map((d) => d.timestamp)).toEqual([
      NOW,
      NOW,
    ]);
  });

  it("says the rest at once when the Gateway stops during a pause", async () => {
    const stopping = new AbortController();
    const h = setup(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      stopping.signal,
    );
    const result = h.messaging.speak(
      "alice",
      "ALICE",
      speech(["One", "Two", "Three"]),
    );
    await h.finishBubble();
    await vi.waitFor(() => expect(texts(h.retained)).toEqual(["One"]));
    stopping.abort();
    expect((await result).status).toBe("delivered");
    expect(texts(h.retained)).toEqual(["One", "Two", "Three"]);
  });

  it("flushes a plan left by a crashed generation without repeating sent bubbles", async () => {
    const retained = new Map<string, MessageDelivery>();
    const committed = new Map<string, { timestamp: number; text: string }>();
    const chats = new Map<string, ChatConversation>();
    const outbox = new Map<string, OutboxPlan>();
    const first = setup(retained, committed, chats, outbox);
    first.setSpeed(0.000_001);
    const crashed = first.messaging
      .speak("alice", "ALICE", speech(["Hi", "Are you free?", "Lunch?"]))
      .catch((error: unknown) => error);
    await first.finishBubble();
    await vi.waitFor(() => expect(retained.size).toBe(1));
    first.messaging.dispose();
    expect(await crashed).toBeInstanceOf(Error);
    expect(outbox.size).toBe(1);

    const next = setup(retained, committed, chats, outbox);
    await next.messaging.resume();
    expect(texts(retained)).toEqual(["Hi", "Are you free?", "Lunch?"]);
    expect(outbox.size).toBe(0);
  });

  it("says a goodbye on the way out when they leave while waiting to speak", async () => {
    // Live, a goodbye sent with start_task was lost: the line waited for the
    // floor while the move took the speaker out of the conversation.
    const h = setup();
    for (const who of ["alice", "bob", "carol"]) h.places.set(who, "club");
    const club = await h.messaging.talk("alice", ["bob", "carol"]);
    const address = club.sessionKey.replace("agent:alice:", "");
    h.setSpeed(0.000_001); // Every line would take days to say.
    // Carol holds the floor with a long story; Alice waits to say goodbye.
    const carol = h.messaging.speak("carol", "CAROL", {
      requestId: "story",
      sessionKey: address,
      messages: ["So the thing about the vending machine is this."],
    });
    await vi.waitFor(() =>
      expect(h.messaging.currentSpeech("carol")).toBeDefined(),
    );
    const goodbye = h.messaging.speak("alice", "ALICE", {
      requestId: "bye",
      sessionKey: address,
      messages: ["Sorry, I have to run. See you!", "Bye, Bob."],
    });
    await vi.waitFor(() =>
      expect(h.messaging.currentSpeech("alice")).toBeDefined(),
    );
    await h.messaging.leavePlace("alice", "ALICE", "club", {
      toward: "Main Gate",
      at: NOW,
    });
    expect(await goodbye).toMatchObject({ status: "delivered" });
    // Said before she went, over Carol, heard by both.
    expect(texts(h.retained)).toEqual([
      "Sorry, I have to run. See you!",
      "Bye, Bob.",
      "leaves, heading toward Main Gate",
    ]);
    expect(h.messaging.interrupt("carol")).toBe(true);
    await carol;
  });

  it("never lets another instance flush a plan still being said, or taken back", async () => {
    // Live: another instance's outbox flush sent the bubbles an interrupted
    // speaker was told "nobody saw", so the character said them twice.
    const state = createMessagingState();
    const turn = setup(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      state,
    );
    const http = setup(
      turn.retained,
      turn.committed,
      turn.chats,
      turn.outbox,
      undefined,
      state,
    );
    turn.setSpeed(0.000_001);
    const pending = turn.messaging.speak(
      "alice",
      "ALICE",
      speech(["Wait...", "I told you not to go!", "What were you thinking?"]),
    );
    await turn.finishBubble();
    await vi.waitFor(() => expect(texts(turn.retained)).toEqual(["Wait..."]));
    await http.messaging.resume();
    expect(texts(turn.retained)).toEqual(["Wait..."]);
    // Whichever instance serves the client or steers sees the speech.
    expect(await http.messaging.getTyping()).toHaveLength(1);
    expect(http.messaging.currentSpeech("alice")?.said).toEqual(["Wait..."]);
    expect(http.messaging.interrupt("alice")).toBe(true);
    expect(await pending).toMatchObject({
      status: "interrupted",
      unsaid: ["I told you not to go!", "What were you thinking?"],
    });
    await http.messaging.resume();
    expect(texts(turn.retained)).toEqual(["Wait..."]);
    expect(turn.outbox.size).toBe(0);
  });

  it("skips a plan taken back after the outbox was read", async () => {
    const retained = new Map<string, MessageDelivery>();
    const committed = new Map<string, { timestamp: number; text: string }>();
    const chats = new Map<string, ChatConversation>();
    const outbox = new Map<string, OutboxPlan>();
    const first = setup(retained, committed, chats, outbox);
    first.setSpeed(0.000_001);
    const crashed = first.messaging
      .speak("alice", "ALICE", speech(["Hi", "Are you free?", "Lunch?"]))
      .catch((error: unknown) => error);
    await first.finishBubble();
    await vi.waitFor(() => expect(retained.size).toBe(1));
    first.messaging.dispose();
    await crashed;
    // Read before the plan was deleted: the entries still list it.
    const stale = [...outbox].map(([key, value]) => ({
      key,
      value,
      createdAt: NOW,
    }));
    outbox.clear();
    const next = setup(
      retained,
      committed,
      chats,
      outbox,
      undefined,
      undefined,
      undefined,
      {
        outbox: {
          lookup: async (key) => structuredClone(outbox.get(key)),
          register: async () => {},
          delete: async (key) => outbox.delete(key),
          entries: async () => stale,
        },
      },
    );
    await next.messaging.resume();
    expect(texts(retained)).toEqual(["Hi"]);
  });

  it("judges how fast they type, and shows typing only while they do", async () => {
    const judgeSpeech = vi.fn<NonNullable<MessagingDeps["judgeSpeech"]>>(
      async () => ({ floor: "NEXT", pace: 2 }),
    );
    const h = setup(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      new AbortController().signal,
      { judgeSpeech },
    );
    const result = h.messaging.speak(
      "alice",
      "ALICE",
      speech(["ok I'll be right there"]),
    );
    await vi.waitFor(async () =>
      expect(await h.messaging.getTyping("bob")).toMatchObject([
        { senderId: "alice", isTyping: true, mode: "typing" },
      ]),
    );
    // A text has no floor: only the pace is asked.
    expect(judgeSpeech).toHaveBeenCalledExactlyOnceWith("alice", {
      sessionKey: "agent:alice:chat:direct:bob",
      medium: "typing",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    // Twice as fast: 22 keys in half of 7,333 ms.
    h.setNow(NOW + 3_666);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(h.retained.size).toBe(0);
    h.setNow(NOW + 3_667);
    expect(await result).toMatchObject({ status: "delivered" });
    expect([...h.retained.values()][0].timestamp).toBe(NOW + 3_667);
    expect(await h.messaging.getTyping()).toEqual([]);
  });

  it("opens one new group to type in, and sends every bubble there", async () => {
    const h = setup(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      new AbortController().signal,
    );
    const pending = h.messaging.speak("alice", "ALICE", {
      requestId: "plan",
      members: ["bob", "carol"],
      title: "Plans",
      messages: ["Lunch?", "Noon?"],
    });
    // While the first bubble is typed, attention knows where it goes.
    await vi.waitFor(() =>
      expect(h.messaging.currentSpeech("alice")?.sessionKey).toMatch(
        /^agent:alice:chat:group:/u,
      ),
    );
    await h.finishBubble();
    await vi.waitFor(() => expect(h.retained.size).toBe(1));
    await h.finishBubble();
    const result = await pending;
    const groups = [...h.chats.values()].filter(
      (chat) => chat.kind === "group",
    );
    expect(groups).toHaveLength(1);
    expect([...h.retained.values()].map((d) => d.chatId)).toEqual([
      groups[0].id,
      groups[0].id,
    ]);
    expect(result.sessionKey).toBe(`agent:alice:chat:${groups[0].id}`);
  });

  it("does an action at once, and shows a line said aloud as speaking", async () => {
    const h = setup(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      new AbortController().signal,
    );
    h.places.set("alice", "club").set("bob", "club");
    const result = h.messaging.speak("alice", "ALICE", {
      requestId: "wave",
      members: ["bob"],
      aloud: true,
      messages: [{ text: "waves", type: "action" }, "Hi!"],
    });
    await vi.waitFor(async () =>
      expect(await h.messaging.getTyping("bob")).toMatchObject([
        { senderId: "alice", mode: "speaking" },
      ]),
    );
    expect(texts(h.retained)).toEqual(["waves"]);
    await h.finishBubble();
    expect(await result).toMatchObject({ status: "delivered" });
    expect(texts(h.retained)).toEqual(["waves", "Hi!"]);
  });

  it("says sends started together one after another, and stops them all on an interrupt", async () => {
    // Live: Kazusa spoke aloud and texted in one turn; the text cut off her
    // speech before a word of it was said.
    const h = setup();
    h.setSpeed(0.000_001);
    const older = h.messaging.speak(
      "alice",
      "ALICE",
      speech(["A", "B"], "old"),
    );
    const newer = h.messaging.speak("alice", "ALICE", speech(["C"], "new"));
    await h.finishBubble();
    await vi.waitFor(() => expect(h.retained.size).toBe(1));
    h.setSpeed(1_000_000);
    expect((await older).status).toBe("delivered");
    expect((await newer).status).toBe("delivered");
    expect(texts(h.retained)).toEqual(["A", "B", "C"]);

    h.setSpeed(0.000_001);
    const speaking = h.messaging.speak(
      "alice",
      "ALICE",
      speech(["D", "E"], "again"),
    );
    const next = h.messaging.speak("alice", "ALICE", speech(["F"], "later"));
    await h.finishBubble();
    await vi.waitFor(() => expect(h.retained.size).toBe(4));
    expect(h.messaging.interrupt("alice")).toBe(true);
    expect(await speaking).toMatchObject({
      status: "interrupted",
      said: ["D"],
    });
    expect(await next).toMatchObject({ status: "interrupted", said: [] });
    expect(texts(h.retained)).toEqual(["A", "B", "C", "D"]);
  });
});

describe("chats awaiting a reply", () => {
  const bobsChat = "agent:bob:chat:direct:alice";
  const alicesChat = "agent:alice:chat:direct:bob";
  const read = (
    h: ReturnType<typeof setup>,
    reader: string,
    sessionKey: string,
    id: string,
  ) =>
    h.messaging.markRead(
      reader,
      [stimulusKey({ id, sessionKey })],
      [sessionKey],
    );

  it("lists chats where someone spoke after the reader and they read it", async () => {
    const h = setup();
    const first = await h.send();
    expect(await h.messaging.awaitingReplies("bob", NOW)).toEqual([]);
    await read(h, "bob", bobsChat, first.messageId);
    expect(await h.messaging.awaitingReplies("bob", NOW)).toEqual([
      {
        sessionKey: bobsChat,
        sender: "alice",
        senderName: "ALICE",
        timestamp: NOW,
      },
    ]);
    expect(await h.messaging.awaitingReplies("alice", NOW)).toEqual([]);
    expect(await h.messaging.awaitingReplies("bob", NOW + 1)).toEqual([]);
    const reply = await h.send(
      { requestId: "reply", sessionKey: "chat:direct:alice", text: "Hi!" },
      "bob",
    );
    expect(await h.messaging.awaitingReplies("bob", NOW)).toEqual([]);
    expect(await h.messaging.awaitingReplies("alice", NOW)).toEqual([]);
    await read(h, "alice", alicesChat, reply.messageId);
    expect(await h.messaging.awaitingReplies("alice", NOW)).toHaveLength(1);
  });

  it("names the newest message they read, not one they have yet to read", async () => {
    const h = setup();
    const first = await h.send();
    h.setNow(NOW + 60_000);
    await h.send({
      requestId: "second",
      sessionKey: "chat:direct:bob",
      text: "Still there?",
    });
    await read(h, "bob", bobsChat, first.messageId);
    expect(await h.messaging.awaitingReplies("bob", NOW)).toMatchObject([
      { sessionKey: bobsChat, timestamp: NOW },
    ]);
  });

  it("describes where each conversation stands for the reader", async () => {
    const h = setup();
    await h.send();
    h.setNow(NOW + 10 * 60_000);
    await h.send(
      { requestId: "reply", sessionKey: "chat:direct:alice", text: "Hi!" },
      "bob",
    );
    h.setNow(NOW + 20 * 60_000);
    await h.send(
      { requestId: "again", sessionKey: "chat:direct:alice", text: "You?" },
      "bob",
    );
    expect(
      await h.messaging.chatFacts("alice", [
        "agent:alice:chat:direct:bob",
        "agent:alice:chat:direct:carol",
      ]),
    ).toEqual([
      {
        sessionKey: "agent:alice:chat:direct:bob",
        kind: "direct",
        title: null,
        memberCount: 2,
        lastSpokeAt: NOW,
        joinedAt: null,
        unanswered: 2,
        waitingSince: NOW + 10 * 60_000,
      },
    ]);
    expect(
      await h.messaging.chatFacts("bob", ["agent:bob:chat:direct:alice"]),
    ).toMatchObject([
      { lastSpokeAt: NOW + 20 * 60_000, unanswered: 0, waitingSince: null },
    ]);
  });

  it("answers from what has committed, without waiting behind a send", async () => {
    const h = setup();
    await h.send();
    const before = h.register.mock.calls.length;
    let finish = () => {};
    h.register.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const slow = h.send(
      { requestId: "slow", sessionKey: "chat:direct:alice", text: "Hm?" },
      "bob",
    );
    // Accepting it holds the queue until the write finishes.
    await vi.waitFor(() =>
      expect(h.register).toHaveBeenCalledTimes(before + 1),
    );
    expect(
      await h.messaging.chatFacts("alice", ["agent:alice:chat:direct:bob"]),
    ).toMatchObject([{ lastSpokeAt: NOW, unanswered: 0 }]);
    expect(await h.messaging.awaitingReplies("alice", NOW)).toEqual([]);
    finish();
    await slow;
  });

  it("tells a huddle from a text chat without reading messages", async () => {
    const h = setup();
    h.places.set("alice", "club").set("bob", "club");
    const huddle = await h.messaging.send("alice", "ALICE", {
      text: "Hi!",
      requestId: "aloud",
      members: ["bob"],
      aloud: true,
    });
    await h.send();
    const as = (id: string) =>
      huddle.sessionKey.replace("agent:alice:", `agent:${id}:`);
    const lookups = vi.spyOn(h.retained, "values");
    expect(await h.messaging.isHuddle("bob", as("bob"))).toBe(true);
    expect(
      await h.messaging.isHuddle("bob", "agent:bob:chat:direct:alice"),
    ).toBe(false);
    expect(await h.messaging.isHuddle("carol", as("carol"))).toBe(false);
    expect(lookups).not.toHaveBeenCalled();
  });
});

describe("read receipts", () => {
  const bobsChat = "agent:bob:chat:direct:alice";
  const receiptsOf = (h: ReturnType<typeof setup>) =>
    [...h.retained.values()]
      .sort((a, b) => a.sequence - b.sequence)
      .map((delivery) => clientMessage(delivery).receipts);

  it("marks a chat read up to the latest message the brain was shown", async () => {
    const h = setup();
    const events: unknown[] = [];
    h.messaging.onEvent((event) => {
      if (event.type === "read") events.push(event);
    });
    await h.send();
    const second = await h.send({
      requestId: "second",
      sessionKey: "chat:direct:bob",
      text: "Still there?",
    });
    await h.send({
      requestId: "third",
      sessionKey: "chat:direct:bob",
      text: "Hello?",
    });
    expect(receiptsOf(h)).toEqual([
      [{ id: "bob" }],
      [{ id: "bob" }],
      [{ id: "bob" }],
    ]);

    const readAt = NOW + 5 * 60_000;
    h.setNow(readAt);
    const shown = [stimulusKey({ id: second.messageId, sessionKey: bobsChat })];
    await h.messaging.markRead("bob", shown, [bobsChat]);
    // Opening the chat shows everything above the newest message shown.
    expect(receiptsOf(h)).toEqual([
      [{ id: "bob", readAt }],
      [{ id: "bob", readAt }],
      [{ id: "bob" }],
    ]);
    expect(events).toMatchObject([
      {
        read: { type: "read", readerId: "bob", readAt },
        audience: ["alice", "bob"],
      },
    ]);
    expect(events[0]).toHaveProperty("read.messageIds.length", 2);

    // Read once: a later showing keeps the first time and says nothing new.
    h.setNow(readAt + 60_000);
    await h.messaging.markRead("bob", shown, [bobsChat]);
    expect(receiptsOf(h)[0]).toEqual([{ id: "bob", readAt }]);
    expect(events).toHaveLength(1);
  });

  it("face to face, counts only the lines taken in as observed", async () => {
    const h = setup();
    h.places.set("alice", "park");
    h.places.set("bob", "park");
    const first = await h.send({ aloud: true, text: "nice day" });
    const second = await h.send({
      requestId: "second",
      sessionKey: first.sessionKey.replace(/^agent:alice:/, ""),
      text: "isn't it?",
    });
    const bobsHuddle = [...h.retained.values()]
      .flatMap((delivery) => delivery.copies)
      .find((copy) => copy.agentId === "bob")?.sessionKey;
    expect(bobsHuddle).toMatch(/^agent:bob:chat:huddle:/);
    expect(receiptsOf(h)).toEqual([[{ id: "bob" }], [{ id: "bob" }]]);

    // The first line went by unheard; hearing the next doesn't bring it back.
    await h.messaging.markRead(
      "bob",
      [stimulusKey({ id: second.messageId, sessionKey: bobsHuddle ?? "" })],
      [bobsHuddle ?? ""],
    );
    expect(receiptsOf(h)).toEqual([
      [{ id: "bob" }],
      [{ id: "bob", readAt: NOW }],
    ]);
  });
});

describe("huddles", () => {
  const aloud = (
    h: ReturnType<typeof setup>,
    sender: string,
    params: Partial<SendMessageParams>,
    requestId: string,
  ) =>
    h.messaging.send(sender, sender.toUpperCase(), {
      text: "Hi!",
      requestId,
      ...params,
    });

  it("does actions face to face, read as done, and drops them in a text chat", async () => {
    const h = setup();
    h.places.set("alice", "club").set("bob", "club");
    const face = await h.messaging.speak("alice", "ALICE", {
      requestId: "act",
      members: ["bob"],
      aloud: true,
      messages: [
        { text: "sets the textbook on the desk", type: "action" },
        "Here you go.",
      ],
    });
    expect(face.said).toEqual([
      "[type=action] sets the textbook on the desk",
      "Here you go.",
    ]);
    const stored = [...h.retained.values()].sort(
      (a, b) => a.sequence - b.sequence,
    );
    expect(stored.map(({ params }) => [params.type, params.text])).toEqual([
      ["action", "sets the textbook on the desk"],
      [undefined, "Here you go."],
    ]);
    // Bob reads it as something done; the client gets it typed.
    await vi.waitFor(() =>
      expect(h.receive).toHaveBeenCalledWith(
        "bob",
        expect.objectContaining({
          text: "[type=action] sets the textbook on the desk",
        }),
      ),
    );
    expect(clientMessage(stored[0])).toMatchObject({
      text: "sets the textbook on the desk",
      type: "action",
    });

    // By text, an action is not seen: it is dropped, and nothing says so.
    const text = await h.messaging.speak("alice", "ALICE", {
      requestId: "text",
      members: ["bob"],
      messages: [{ text: "waves", type: "action" }, "See you!"],
    });
    expect(text).toMatchObject({ said: ["See you!"], unsaid: [] });
    expect(h.retained.size).toBe(3);
  });

  it("sends stickers by text, read as described, and drops them face to face", async () => {
    const h = setup();
    const sticker = {
      text: "ALICE, laughing with eyes shut",
      type: "sticker" as const,
      sticker: { name: "laughing", v: "abc" },
    };
    const text = await h.messaging.speak("alice", "ALICE", {
      requestId: "sticker",
      members: ["bob"],
      messages: ["That's hilarious", sticker],
    });
    expect(text.said).toEqual([
      "That's hilarious",
      "[type=sticker] ALICE, laughing with eyes shut",
    ]);
    const stored = [...h.retained.values()].sort(
      (a, b) => a.sequence - b.sequence,
    );
    expect(stored[1].params).toMatchObject({
      type: "sticker",
      sticker: { name: "laughing", v: "abc" },
    });
    await vi.waitFor(() =>
      expect(h.receive).toHaveBeenCalledWith(
        "bob",
        expect.objectContaining({
          text: "[type=sticker] ALICE, laughing with eyes shut",
        }),
      ),
    );
    expect(clientMessage(stored[1])).toMatchObject({
      text: "ALICE, laughing with eyes shut",
      type: "sticker",
      sticker: {
        name: "laughing",
        url: "/kazusa/sticker?id=alice&name=laughing&v=abc",
      },
    });

    // Face to face there is no phone to send one from.
    h.places.set("alice", "club").set("bob", "club");
    const face = await h.messaging.speak("alice", "ALICE", {
      requestId: "face",
      members: ["bob"],
      aloud: true,
      messages: [sticker, "Ha!"],
    });
    expect(face).toMatchObject({ said: ["Ha!"], unsaid: [] });

    // A sticker message always carries its sticker.
    await expect(
      h.messaging.send("bob", "BOB", {
        members: ["alice"],
        text: "a sticker",
        type: "sticker",
        requestId: "forged",
      }),
    ).rejects.toThrow();
  });

  it("preserves emphasis as speech and trusts explicit action types face to face", async () => {
    const h = setup();
    h.places.set("alice", "club").set("bob", "club");
    const face = await h.messaging.speak("alice", "ALICE", {
      requestId: "typed",
      members: ["bob"],
      aloud: true,
      messages: [
        "I *really* mean it",
        "That is **important**!",
        { text: "sets down the book", type: "action" },
      ],
    });
    expect(face.said).toEqual([
      "I *really* mean it",
      "That is **important**!",
      "[type=action] sets down the book",
    ]);
    const delivered = [...h.retained.values()].filter(
      (message) => message.sender === "alice",
    );
    expect(delivered.map(clientMessage)).toMatchObject([
      { text: "I *really* mean it" },
      { text: "That is **important**!" },
      { text: "sets down the book", type: "action" },
    ]);
    expect(
      delivered
        .slice(0, 2)
        .map(clientMessage)
        .every((message) => message.type !== "action"),
    ).toBe(true);
  });

  it("starts a huddle only with people where the speaker is", async () => {
    const h = setup();
    h.places.set("alice", "club").set("bob", "club").set("carol", "gate");
    const started = await aloud(
      h,
      "alice",
      { members: ["bob"], aloud: true },
      "hi",
    );
    expect(started.recipients).toEqual(["bob"]);
    expect(h.chats.get(started.chatId)).toMatchObject({
      kind: "huddle",
      placeId: "club",
      title: "Talking at CLUB",
      members: ["alice", "bob"],
    });
    expect(started.sessionKey).toMatch(/^agent:alice:chat:huddle:/);
    // Speaking aloud again to the same people, from either side, goes on in
    // the same conversation instead of starting another.
    for (const [sender, to, request] of [
      ["alice", "bob", "again"],
      ["bob", "alice", "reply"],
    ] as const) {
      const said = await aloud(
        h,
        sender,
        { members: [to], aloud: true },
        request,
      );
      expect(said.chatId).toBe(started.chatId);
    }
    expect(h.chats.get(started.chatId)?.members).toEqual(["alice", "bob"]);
    await expect(
      aloud(h, "alice", { members: ["carol"], aloud: true }, "far"),
    ).rejects.toThrow("carol isn't here, so they can't hear you.");
    h.places.delete("alice");
    await expect(
      aloud(h, "alice", { members: ["bob"], aloud: true }, "walking"),
    ).rejects.toThrow("You're on your way, so nobody is close enough to hear.");
  });

  it("turns to people one move at a time: joins, splits off, never merges", async () => {
    // Live, turning to one person merged both groups, and a huddle grew to 17.
    const h = setup();
    for (const who of ["alice", "bob", "carol", "dave", "erin"])
      h.places.set(who, "club");
    const heard = (who: string, text: string) =>
      vi.waitFor(() =>
        expect(h.receive).toHaveBeenCalledWith(
          who,
          expect.objectContaining({ text: `[type=action] ${text}` }),
        ),
      );
    const ab = await aloud(h, "alice", { members: ["bob"], aloud: true }, "ab");
    const cd = await aloud(
      h,
      "carol",
      { members: ["dave"], aloud: true },
      "cd",
    );
    // Carol turns to Bob: she walks over to his conversation, and Dave, left
    // alone, is talking with nobody. Nothing merges.
    const over = await aloud(
      h,
      "carol",
      { members: ["bob"], aloud: true },
      "over",
    );
    expect(over.chatId).toBe(ab.chatId);
    expect([...over.recipients].sort()).toEqual(["alice", "bob"]);
    expect(h.chats.get(cd.chatId)?.members).toEqual([]);
    await heard("dave", "moves to another conversation");
    // Dave, now on his own, calls Erin over: a new conversation.
    const de = await aloud(h, "dave", { members: ["erin"], aloud: true }, "de");
    expect(de.chatId).not.toBe(ab.chatId);

    // Alice turns to Bob alone; Carol sees them turn. One left behind is
    // talking with nobody, so the pair keeps the conversation and its address.
    const side = await aloud(
      h,
      "alice",
      { members: ["bob"], aloud: true },
      "side",
    );
    expect(side.chatId).toBe(ab.chatId);
    expect(h.chats.get(side.chatId)?.members).toEqual(["alice", "bob"]);
    await heard("carol", "turns to talk with bob");
    // Speaking aloud again to people already in it goes on in it.
    const again = await aloud(
      h,
      "bob",
      { members: ["alice"], aloud: true },
      "again",
    );
    expect(again.chatId).toBe(side.chatId);

    // Nobody stands in two conversations at once.
    await expect(
      aloud(h, "carol", { members: ["alice", "dave"], aloud: true }, "both"),
    ).rejects.toThrow("different conversations");
    expect(await h.messaging.huddlesAt("club")).toHaveLength(2);

    await h.messaging.leavePlace("bob", "BOB", "club", {
      toward: "Main Gate",
      at: NOW,
    });
    await heard("alice", "leaves, heading toward Main Gate");
    expect(h.chats.get(side.chatId)?.members).toEqual([]);

    // Stepping back leaves the conversation without leaving the place.
    const deAddress = `chat:huddle:${de.chatId.slice("huddle:".length)}`;
    await aloud(h, "carol", { sessionKey: deAddress }, "join");
    await h.messaging.manageChat("carol", {
      action: "leave",
      sessionKey: deAddress,
    });
    expect(h.chats.get(de.chatId)?.members).toEqual(["dave", "erin"]);
    await heard("erin", "steps back from the conversation");
    await expect(
      h.messaging.manageChat("dave", {
        action: "rename",
        sessionKey: deAddress,
        title: "Ours",
      }),
    ).rejects.toThrow("can only be left");
  });

  it("moves to another conversation by its address, leaving the old one", async () => {
    const h = setup();
    for (const who of ["alice", "bob", "carol", "dave"])
      h.places.set(who, "club");
    const ab = await aloud(h, "alice", { members: ["bob"], aloud: true }, "ab");
    const cd = await aloud(
      h,
      "carol",
      { members: ["dave"], aloud: true },
      "cd",
    );
    const cdAddress = `chat:huddle:${cd.chatId.slice("huddle:".length)}`;
    // Bob walks over to Carol and Dave: Alice is left alone, so hers ends.
    await aloud(h, "bob", { sessionKey: cdAddress }, "over");
    expect(h.chats.get(cd.chatId)?.members).toEqual(["bob", "carol", "dave"]);
    expect(h.chats.get(ab.chatId)?.members).toEqual([]);
    await vi.waitFor(() =>
      expect(h.receive).toHaveBeenCalledWith(
        "alice",
        expect.objectContaining({
          text: "[type=action] moves to another conversation",
        }),
      ),
    );
    await expect(
      aloud(
        h,
        "alice",
        { sessionKey: `chat:huddle:${ab.chatId.slice("huddle:".length)}` },
        "late",
      ),
    ).rejects.toThrow("That conversation is over");
  });

  it("turns to people here with talk, joining their conversation", async () => {
    const h = setup();
    h.places.set("alice", "club").set("bob", "club").set("carol", "club");
    const theirs = await h.messaging.talk("bob", ["carol"]);
    expect(theirs).toMatchObject({
      kind: "huddle",
      members: ["bob", "carol"],
      sessionKey: expect.stringMatching(/^agent:bob:chat:huddle:[0-9a-z]{10}$/),
    });
    // Nothing is said until a send: talking to them only brings you over.
    expect(h.retained.size).toBe(0);
    const joined = await h.messaging.talk("alice", ["bob"]);
    expect(joined.members).toEqual(["alice", "bob", "carol"]);
    expect(joined.sessionKey).toBe(
      theirs.sessionKey.replace("agent:bob:", "agent:alice:"),
    );
    h.places.set("dave", "street");
    await expect(h.messaging.talk("alice", ["dave"])).rejects.toThrow();
    await expect(h.messaging.talk("alice", ["alice"])).rejects.toThrow();
  });

  it("splits a side conversation off a bigger one, never taking a speaker", async () => {
    const h = setup();
    for (const who of ["alice", "bob", "carol", "dave", "erin"])
      h.places.set(who, "club");
    const table = await h.messaging.talk("alice", [
      "bob",
      "carol",
      "dave",
      "erin",
    ]);
    const address = table.sessionKey.replace("agent:alice:", "");
    // Erin is in the middle of saying something to the whole table.
    h.setSpeed(0.000_001);
    const erin = h.messaging.speak("erin", "ERIN", {
      requestId: "erin",
      sessionKey: address,
      messages: ["So anyway,", "the funniest part was the end."],
    });
    // Face to face her first line takes its speaking time before it is heard.
    await vi.waitFor(() =>
      expect(h.messaging.currentSpeech("erin")).toMatchObject({
        sessionKey: `agent:erin:${address}`,
        said: [],
      }),
    );
    const side = await h.messaging.talk("alice", ["bob", "erin"]);
    // Erin can't be turned away mid-sentence; Bob turns with Alice.
    expect(side.members).toEqual(["alice", "bob"]);
    expect(side.sessionKey).not.toBe(table.sessionKey);
    const rest = [...h.chats.values()].find((chat) =>
      table.sessionKey.endsWith(chat.id.slice("huddle:".length)),
    );
    expect(rest?.members).toEqual(["carol", "dave", "erin"]);
    expect(h.messaging.interrupt("erin")).toBe(true);
    await erin;
  });

  it("lets someone tune out of a conversation without a word", async () => {
    const h = setup();
    for (const who of ["alice", "bob", "carol"]) h.places.set(who, "club");
    const lunch = await h.messaging.talk("alice", ["bob", "carol"]);
    const lines = h.retained.size;
    const address = lunch.sessionKey.replace("agent:alice:", "");
    const left = await h.messaging.tuneOut("carol", address);
    expect(left?.members).toEqual(["alice", "bob", "carol"]);
    const chat = [...h.chats.values()].find((c) => c.kind === "huddle");
    expect(chat?.members).toEqual(["alice", "bob"]);
    // Drifting off isn't announced: nobody else is woken by it.
    expect(h.retained.size).toBe(lines);
    // Not in it any more, so nothing to leave.
    expect(await h.messaging.tuneOut("carol", address)).toBeUndefined();
    // One of a pair can't drift off unnoticed: the other is talking to them.
    expect(await h.messaging.tuneOut("bob", address)).toBeUndefined();
    expect(chat && h.chats.get(chat.id)?.members).toEqual(["alice", "bob"]);
  });

  it("starts a group with createGroup and nobody hears of it until a send", async () => {
    const h = setup();
    const group = await h.messaging.createGroup(
      "alice",
      ["bob", "carol"],
      "Tea",
    );
    expect(group).toMatchObject({
      kind: "group",
      title: "Tea",
      members: ["alice", "bob", "carol"],
    });
    expect(h.retained.size).toBe(0);
    expect((await h.messaging.listChats("bob"))[0].title).toBe("Tea");
    const direct = await h.messaging.createGroup("alice", ["bob"], "Ignored");
    expect(direct.sessionKey).toBe("agent:alice:chat:direct:bob");
  });

  it("streams every instance's events to a client, past a reload", async () => {
    // A client's stream listened on the instance that served it: a reply
    // accepted on another, or after a reload disposed it, never reached it.
    const state = createMessagingState();
    const served = setup(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      state,
    );
    const turn = setup(
      served.retained,
      undefined,
      served.chats,
      undefined,
      undefined,
      state,
    );
    const stream: string[] = [];
    const own: string[] = [];
    const unsubscribe = served.messaging.onAnyEvent((event) => {
      stream.push(event.type);
    });
    served.messaging.onEvent((event) => {
      own.push(event.type);
    });
    await turn.send();
    expect(stream).toContain("message");
    expect(own).toEqual([]);
    served.messaging.dispose();
    stream.length = 0;
    await turn.send({ requestId: "after-reload", text: "Still there?" });
    expect(stream).toContain("message");
    unsubscribe();
    stream.length = 0;
    await turn.send({ requestId: "gone", text: "Bye" });
    expect(stream).toEqual([]);
  });

  it("is one conversation for every instance sharing the process state", async () => {
    // Live: Location left a huddle on the turn's instance while another
    // instance, with its own copy, kept the leaver talking in it.
    const state = createMessagingState();
    const turn = setup(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      state,
    );
    const http = setup(
      turn.retained,
      undefined,
      turn.chats,
      undefined,
      turn.places,
      state,
    );
    turn.places.set("alice", "club").set("bob", "club");
    const started = await http.messaging.send("alice", "ALICE", {
      members: ["bob"],
      aloud: true,
      text: "Hi!",
      requestId: "hi",
    });
    expect(started.chatId).toMatch(/^huddle:[0-9a-z]{10}$/);
    await turn.messaging.leavePlace("bob", "BOB", "club", { at: NOW });
    expect(await http.messaging.huddlesAt("club")).toEqual([]);
    await expect(
      http.messaging.send("bob", "BOB", {
        sessionKey: `chat:huddle:${started.chatId.slice("huddle:".length)}`,
        text: "Still here?",
        requestId: "late",
      }),
    ).rejects.toThrow("That conversation is over");
  });
});

describe("the floor", () => {
  /** Alice, Bob and Carol talking in the club, on a clock that runs. */
  async function table(judgeSpeech?: MessagingDeps["judgeSpeech"]) {
    const h = setup(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      new AbortController().signal,
      judgeSpeech ? { judgeSpeech } : {},
    );
    h.places.set("alice", "club").set("bob", "club").set("carol", "club");
    const started = await h.send({
      aloud: true,
      members: ["bob", "carol"],
      requestId: "start",
      text: "Hi",
    });
    // So slow that only setNow moves time along.
    h.setSpeed(0.000_001);
    const sessionKey = `chat:huddle:${started.chatId.slice("huddle:".length)}`;
    const say = (who: string, messages: string[], requestId = who) =>
      h.messaging.speak(who, who.toUpperCase(), {
        requestId,
        sessionKey,
        messages,
      });
    const lines = () =>
      [...h.retained.values()]
        .sort((a, b) => a.sequence - b.sequence)
        .map((delivery) => `${delivery.sender}: ${delivery.params.text}`);
    const speaking = async (who: string) =>
      await vi.waitFor(async () =>
        expect(
          (await h.messaging.getTyping()).map((event) => event.senderId),
        ).toContain(who),
      );
    return { h, say, lines, speaking, started };
  }

  it("says even the first line in its speaking time, heard when it ends", async () => {
    const { h, say, lines, speaking, started } = await table();
    const said = say("alice", ["one two three four five"]);
    await speaking("alice");
    expect(lines()).toEqual(["alice: Hi"]);
    // 19 letters at twelve a second: not yet heard a moment before.
    h.setNow(NOW + 1_500);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(lines()).toEqual(["alice: Hi"]);
    h.setNow(NOW + 1_583);
    expect(await said).toMatchObject({ status: "delivered" });
    const line = [...h.retained.values()].find(
      (delivery) => delivery.params.text === "one two three four five",
    );
    expect(line!.timestamp - started.message.timestamp).toBe(1_583);
  });

  it("makes a second speaker wait for the floor, judging how badly they want in", async () => {
    const judgeSpeech = vi.fn<NonNullable<MessagingDeps["judgeSpeech"]>>(
      async () => ({ floor: "NEXT", pace: 1 }),
    );
    const { h, say, lines, speaking } = await table(judgeSpeech);
    const alice = say("alice", ["one two three four five"]);
    await speaking("alice");
    // Alone with the floor, only her pace was asked.
    expect(judgeSpeech).toHaveBeenCalledExactlyOnceWith("alice", {
      sessionKey: expect.stringMatching(/^agent:alice:chat:huddle:/u),
      medium: "speaking",
    });
    const bob = say("bob", ["Me too"]);
    await vi.waitFor(() => expect(judgeSpeech).toHaveBeenCalledTimes(2));
    expect(judgeSpeech).toHaveBeenLastCalledWith("bob", {
      sessionKey: expect.stringMatching(/^agent:bob:chat:huddle:/u),
      medium: "speaking",
      floor: { speaking: ["alice"], turn: "alice", waiting: 0 },
    });
    h.setNow(NOW + 2_000);
    await alice;
    await speaking("bob");
    expect(lines()).toEqual(["alice: Hi", "alice: one two three four five"]);
    h.setNow(NOW + 2_800);
    await bob;
    expect(lines()).toEqual([
      "alice: Hi",
      "alice: one two three four five",
      "bob: Me too",
    ]);
  });

  it("goes to the eager between a speaker's lines, and to the patient once they finish", async () => {
    const judgeSpeech = vi.fn<NonNullable<MessagingDeps["judgeSpeech"]>>(
      async (who) => ({ floor: who === "bob" ? "NEXT" : "WAIT", pace: 1 }),
    );
    const { h, say, lines, speaking } = await table(judgeSpeech);
    const alice = say("alice", ["a a a a a", "A A A A A"]);
    await speaking("alice");
    const others = [say("carol", ["c c c c c"]), say("bob", ["b b b b b"])];
    await vi.waitFor(() => expect(judgeSpeech).toHaveBeenCalledTimes(3));
    for (const [at, who] of [
      [2_000, "bob"],
      [4_000, "alice"],
      [6_000, "carol"],
    ] as const) {
      h.setNow(NOW + at);
      await speaking(who);
    }
    h.setNow(NOW + 8_000);
    await Promise.all([alice, ...others]);
    expect(lines()).toEqual([
      "alice: Hi",
      "alice: a a a a a",
      "bob: b b b b b",
      "alice: A A A A A",
      "carol: c c c c c",
    ]);
  });

  it("lets a cut-in speak over the speaker, who is heard up to where a steer stops them", async () => {
    const { h, say, lines, speaking } = await table(async () => ({
      floor: "CUT_IN",
      pace: 1,
    }));
    const alice = say("alice", [
      "one two three four five six seven eight nine ten",
      "And another thing",
    ]);
    await speaking("alice");
    const bob = say("bob", ["No!"]);
    await speaking("bob");
    h.setNow(NOW + 400);
    await bob;
    expect(lines()).toEqual(["alice: Hi", "bob: No!"]);
    h.setNow(NOW + 2_000);
    expect(h.messaging.interrupt("alice")).toBe(true);
    expect(await alice).toMatchObject({
      status: "interrupted",
      said: ["one two three four five six—"],
      unsaid: [
        "one two three four five six seven eight nine ten",
        "And another thing",
      ],
    });
    expect(lines()).toEqual([
      "alice: Hi",
      "bob: No!",
      "alice: one two three four five six—",
    ]);
    expect(await h.messaging.getTyping()).toEqual([]);
  });

  it("says a line at the speaker's judged pace", async () => {
    const { h, say, speaking, started } = await table(async () => ({
      floor: "NEXT",
      pace: 2,
    }));
    const said = say("alice", ["one two three four five"]);
    await speaking("alice");
    // Twice as fast: heard in half of 1,583 ms.
    h.setNow(NOW + 792);
    await said;
    const line = [...h.retained.values()].find(
      (delivery) => delivery.params.text === "one two three four five",
    );
    expect(line!.timestamp - started.message.timestamp).toBe(792);
  });

  it("finishes the line being said, then stops to take in what was said over it", async () => {
    const { h, say, lines, speaking } = await table();
    const alice = say("alice", ["one two three four five", "And another"]);
    await speaking("alice");
    h.setNow(NOW + 500);
    expect(
      h.messaging.interrupt("alice", { message: "hang on", atPause: true }),
    ).toBe(true);
    h.setNow(NOW + 2_000);
    expect(await alice).toMatchObject({
      status: "interrupted",
      said: ["one two three four five"],
      unsaid: ["And another"],
      meanwhile: "hang on",
    });
    expect(lines()).toEqual(["alice: Hi", "alice: one two three four five"]);
  });

  it("drops a line stopped before its first word", async () => {
    const { h, say, lines, speaking } = await table();
    const alice = say("alice", ["one two three four five"]);
    await speaking("alice");
    h.setNow(NOW + 100);
    h.messaging.interrupt("alice");
    expect(await alice).toMatchObject({
      status: "interrupted",
      said: [],
      unsaid: ["one two three four five"],
    });
    expect(lines()).toEqual(["alice: Hi"]);
  });
});
