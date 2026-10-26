import { afterEach, describe, expect, it, vi } from "vitest";
import type { StateStore } from "../state.ts";
import {
  Messaging,
  type MessageCopy,
  type MessageDelivery,
  type MessagingDeps,
} from "./messaging.ts";
import type { ChatConversation, SendMessageParams } from "./conversations.ts";

const NOW = Date.parse("2026-10-26T12:00:00Z");
const active: Messaging[] = [];

function setup(
  retained = new Map<string, MessageDelivery>(),
  committed = new Map<string, { timestamp: number; text: string }>(),
  chats = new Map<string, ChatConversation>(),
) {
  let now = NOW;
  const register = vi.fn<StateStore<MessageDelivery>["register"]>(
    async (key, value, options) => {
      options?.assertCurrent?.();
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
        chats.set(key, structuredClone(value));
      },
      entries: async () =>
        [...chats].map(([key, value]) => ({
          key,
          value: structuredClone(value),
          createdAt: NOW,
        })),
    },
    clock: { init: async () => {}, time: () => now },
    ensureSession,
    append,
    publish,
    receive,
    warn,
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
    setNow: (value: number) => {
      now = value;
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
      expect(h.retained.size).toBe(202);
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
    expect(h.append).toHaveBeenCalledTimes(3);
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
      ["carol"],
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

    // 5. Query Sensei's history: Sensei sees ONLY messages 3 and 4, NOT 1 or 2!
    const senseiHistory = await h.messaging.getChatHistory({
      chatId: actualChatId,
      userId: "user:sensei",
    });
    expect(senseiHistory.messages).toHaveLength(2);
    expect(senseiHistory.messages[0].text).toBe(
      "Hello Sensei! Welcome to the group.",
    );
    expect(senseiHistory.messages[1].text).toBe(
      "Thanks Alice! Glad to be here.",
    );

    // Alice sees all 4 messages
    const aliceHistory = await h.messaging.getChatHistory({
      chatId: actualChatId,
      userId: "alice",
    });
    expect(aliceHistory.messages).toHaveLength(4);

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
