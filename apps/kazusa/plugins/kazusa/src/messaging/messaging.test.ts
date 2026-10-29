import { z } from "zod";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StateStore } from "../state.ts";
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
) {
  let now = NOW;
  // Paused unless a test runs the world: then sim time follows the wall clock.
  let speed = 0;
  let anchor = Date.now();
  const simNow = () => now + Math.round((Date.now() - anchor) * speed);
  const register = vi.fn<StateStore<MessageDelivery>["register"]>(
    async (key, value, options) => {
      options?.assertCurrent?.();
      z.json().parse(value);
      retained.set(key, structuredClone(value));
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
    ...(state ? { state } : {}),
    store: {
      lookup: async (key) => structuredClone(retained.get(key)),
      register,
      entries: async () =>
        [...retained].map(([key, value]) => ({
          key,
          value: structuredClone(value),
          createdAt: NOW,
        })),
    },
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
      const params = { title: "club", members: ["bob"] };
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
        members: ["carol"],
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

  it("creates a distinct two-person group when a title is supplied", async () => {
    const h = setup();
    await h.send();
    const group = await h.send({ requestId: "group", title: "Weekend Plans" });
    expect(group.sessionKey).toContain(":chat:group:");
    expect(group.recipients).toEqual(["bob"]);
    expect(await h.messaging.listChats("alice")).toHaveLength(2);
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

  it("recovers a group creation whose initial delivery acceptance failed without making another group", async () => {
    const h = setup();
    h.register.mockRejectedValueOnce(new Error("store unavailable"));
    await expect(
      h.send({ title: "Tea", members: ["bob", "carol"] }),
    ).rejects.toThrow("store unavailable");
    expect(h.chats.size).toBe(1);
    h.messaging.dispose();
    const recovered = setup(h.retained, h.committed, h.chats);
    await expect(
      recovered.send({ title: "Different", members: ["bob", "carol"] }),
    ).rejects.toThrow("different chat creation");
    const sent = await recovered.send({
      title: "Tea",
      members: ["bob", "carol"],
    });
    expect(sent.status).toBe("delivered");
    expect(h.chats.size).toBe(1);
    expect((await recovered.messaging.listChats("bob"))[0].title).toBe("Tea");
  });

  it("retains failed native title projections and retries without writing dialogue", async () => {
    const h = setup();
    const group = await h.send({ title: "Tea" });
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
    ).toEqual(["Lunch", "Lunch"]);
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
    const twoAgentsGroup = await h.send({
      requestId: "grp-2",
      title: "Club Talk",
      members: ["bob"],
      text: "Starting club chat",
    });
    const updated = await h.messaging.manageChat("alice", {
      action: "add_members",
      sessionKey: twoAgentsGroup.sessionKey,
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
      members: ["bob"],
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
    expect(senseiSend.recipients).toEqual(["alice", "bob"]);

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

describe("composition presence", () => {
  it("is explicit, scoped to current members and cleared on acceptance", async () => {
    const h = setup();
    const result = await h.send({
      members: ["bob", "user:sensei"],
      title: "Club",
    });
    expect(await h.messaging.getTyping("user:sensei")).toEqual([]);
    await h.messaging.setTyping(
      "alice",
      "Alice",
      result.sessionKey,
      true,
      "run-1",
    );
    expect(await h.messaging.getTyping("user:sensei")).toMatchObject([
      { chatId: result.chatId, senderId: "alice", isTyping: true },
    ]);
    expect(await h.messaging.getTyping("carol")).toEqual([]);
    await expect(
      h.messaging.setTyping(
        "carol",
        "Carol",
        result.sessionKey.replace("agent:alice:", "agent:carol:"),
        true,
        "run-c",
      ),
    ).rejects.toThrow("unavailable");
    h.messaging.clearTyping("alice", "older-run");
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
    await h.messaging.setTyping("user:sensei", "Sensei", humanKey, true);
    const time = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 8001);
    expect(await h.messaging.getTyping("alice")).toEqual([]);
    time.mockRestore();
    await h.messaging.setTyping(
      "bob",
      "Bob",
      result.sessionKey.replace("agent:alice:", "agent:bob:"),
      true,
      "run-b",
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
        true,
        "old",
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

  it("types later bubbles on the simulation clock and sends each as its own message", async () => {
    const h = setup();
    h.setSpeed(1_000_000);
    const typing: boolean[] = [];
    h.messaging.onEvent((event) => {
      if (event.type === "typing") typing.push(event.typing.isTyping);
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
    // Typing starts before each later bubble and each send clears it.
    expect(typing).toEqual([true, false, true, false]);
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
    await vi.waitFor(() => expect(texts(h.retained)).toEqual(["One"]));
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(texts(h.retained)).toEqual(["One"]);
    h.setSpeed(1_000_000);
    expect((await result).status).toBe("delivered");
    expect(texts(h.retained)).toEqual(["One", "Two", "Three"]);
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
    await vi.waitFor(() => expect(retained.size).toBe(1));
    first.messaging.dispose();
    expect(await crashed).toBeInstanceOf(Error);
    expect(outbox.size).toBe(1);

    const next = setup(retained, committed, chats, outbox);
    await next.messaging.resume();
    expect(texts(retained)).toEqual(["Hi", "Are you free?", "Lunch?"]);
    expect(outbox.size).toBe(0);
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
  const all = () => true;

  it("lists chats where someone spoke after the reader, from canonical history", async () => {
    const h = setup();
    await h.send();
    expect(await h.messaging.awaitingReplies("bob", NOW, all)).toEqual([
      {
        sessionKey: "agent:bob:chat:direct:alice",
        sender: "alice",
        senderName: "ALICE",
        timestamp: NOW,
      },
    ]);
    expect(await h.messaging.awaitingReplies("alice", NOW, all)).toEqual([]);
    expect(await h.messaging.awaitingReplies("bob", NOW + 1, all)).toEqual([]);
    await h.send(
      { requestId: "reply", sessionKey: "chat:direct:alice", text: "Hi!" },
      "bob",
    );
    expect(await h.messaging.awaitingReplies("bob", NOW, all)).toEqual([]);
    expect(await h.messaging.awaitingReplies("alice", NOW, all)).toHaveLength(
      1,
    );
  });

  it("leaves out messages the reader never noticed", async () => {
    const h = setup();
    const first = await h.send();
    await h.send({
      requestId: "second",
      sessionKey: "chat:direct:bob",
      text: "Still there?",
    });
    const seen = new Set([first.messageId]);
    expect(
      await h.messaging.awaitingReplies("bob", NOW, (ref) => {
        expect(ref.sessionKey).toBe("agent:bob:chat:direct:alice");
        return seen.has(ref.id);
      }),
    ).toHaveLength(1);
    seen.clear();
    expect(
      await h.messaging.awaitingReplies("bob", NOW, (ref) => seen.has(ref.id)),
    ).toEqual([]);
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
      "*sets the textbook on the desk*",
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
        expect.objectContaining({ text: "*sets the textbook on the desk*" }),
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

  it("splits starred gestures from words face to face, and leaves texts as typed", async () => {
    // Live: "*pushes the cafe door open* Ahh~ warm sugar air…" sent as one
    // action, read back as "**pushes … *".
    const h = setup();
    h.places.set("alice", "club").set("bob", "club");
    const face = await h.messaging.speak("alice", "ALICE", {
      requestId: "mixed",
      members: ["bob"],
      aloud: true,
      messages: [
        { text: "*pushes the door open* Warm in here!", type: "action" },
        "*sits down* Okay. *sighs*",
      ],
    });
    expect(face.said).toEqual([
      "*pushes the door open*",
      "Warm in here!",
      "*sits down*",
      "Okay.",
      "*sighs*",
    ]);
    const text = await h.messaging.speak("alice", "ALICE", {
      requestId: "texted",
      members: ["bob"],
      messages: ["*hugs* see you"],
    });
    expect(text.said).toEqual(["*hugs* see you"]);
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

  it("merges groups spoken across, moves on by address, and dissolves when all leave", async () => {
    const h = setup();
    for (const who of ["alice", "bob", "carol", "dave", "erin"])
      h.places.set(who, "club");
    const first = await aloud(
      h,
      "alice",
      { members: ["bob"], aloud: true },
      "one",
    );
    const address = `chat:huddle:${first.chatId.slice("huddle:".length)}`;
    const other = await aloud(
      h,
      "carol",
      { members: ["dave"], aloud: true },
      "two",
    );
    const otherAddress = `chat:huddle:${other.chatId.slice("huddle:".length)}`;
    // Carol turns to Bob: her group and his become one conversation, and
    // Alice, who was talking with Bob, hears it too.
    const merged = await aloud(
      h,
      "carol",
      { members: ["bob"], aloud: true },
      "merge",
    );
    expect(merged.chatId).toBe(other.chatId);
    expect([...merged.recipients].sort()).toEqual(["alice", "bob", "dave"]);
    expect(h.chats.get(first.chatId)).toMatchObject({
      members: [],
      mergedInto: other.chatId,
    });
    // A reply into the old address lands in the merged conversation.
    const reply = await aloud(h, "alice", { sessionKey: address }, "reply");
    expect(reply.chatId).toBe(other.chatId);
    // Speaking aloud again to people already in it goes on in it.
    const again = await aloud(
      h,
      "bob",
      { members: ["alice"], aloud: true },
      "again",
    );
    expect(again.chatId).toBe(other.chatId);
    expect(await h.messaging.huddlesAt("club")).toEqual([
      { address: otherAddress, members: ["alice", "bob", "carol", "dave"] },
    ]);

    // Erin, on her own, joins by speaking aloud to Dave.
    await aloud(h, "erin", { members: ["dave"], aloud: true }, "erin");
    expect(h.chats.get(other.chatId)?.members).toContain("erin");

    await h.messaging.leavePlace("bob", "BOB", "club", {
      toward: "Main Gate",
      at: NOW,
    });
    expect(h.chats.get(other.chatId)?.members).toEqual([
      "alice",
      "carol",
      "dave",
      "erin",
    ]);
    await vi.waitFor(() =>
      expect(h.receive).toHaveBeenCalledWith(
        "alice",
        expect.objectContaining({
          text: "*leaves, heading toward Main Gate*",
        }),
      ),
    );
    await expect(
      h.messaging.manageChat("alice", {
        action: "leave",
        sessionKey: otherAddress,
      }),
    ).rejects.toThrow("A conversation in person forms and ends on its own");
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
        expect.objectContaining({ text: "*moves to another conversation*" }),
      ),
    );
    await expect(
      aloud(
        h,
        "alice",
        { sessionKey: `chat:huddle:${ab.chatId.slice("huddle:".length)}` },
        "late",
      ),
    ).rejects.toThrow("That conversation is over.");
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
    await turn.messaging.leavePlace("bob", "BOB", "club", { at: NOW });
    expect(await http.messaging.huddlesAt("club")).toEqual([]);
    await expect(
      http.messaging.send("bob", "BOB", {
        sessionKey: `chat:huddle:${started.chatId.slice("huddle:".length)}`,
        text: "Still here?",
        requestId: "late",
      }),
    ).rejects.toThrow("That conversation is over.");
  });
});
