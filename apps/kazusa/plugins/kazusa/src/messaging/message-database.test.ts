import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { replayConversation } from "./conversation.fake.ts";
import { openMessageDatabase } from "./message-database.ts";
import type { MessageDelivery } from "./messaging.ts";

const PEOPLE = ["alice", "bob", "carol", "user:sensei"];
const CHATS = ["direct:a", "group:b", "huddle:c"];

/** A small deterministic generator, so a failure replays. */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
}

function message(
  sequence: number,
  sender: string,
  chatId: string,
  audience: readonly string[],
  timestamp = 1_000 * sequence,
): MessageDelivery {
  return {
    id: `m${sequence}`,
    sequence,
    sender,
    senderName: sender.toUpperCase(),
    chatId,
    audience,
    params: { text: `line ${sequence}`, requestId: `r${sequence}` },
    timestamp,
    copies: audience
      .filter((id) => !id.startsWith("user:"))
      .map((agentId) => ({
        agentId,
        sessionKey: `agent:${agentId}:chat:${chatId}`,
        role: agentId === sender ? "assistant" : "user",
      })),
  };
}

/** Messages in random chats from random members, some heard by only a few. */
function history(seed: number, count: number): MessageDelivery[] {
  const next = random(seed);
  const pick = <T>(items: readonly T[]): T =>
    items[Math.floor(next() * items.length)];
  return Array.from({ length: count }, (_, index) => {
    const audience = PEOPLE.filter(() => next() < 0.75);
    const sender = next() < 0.9 && audience.length ? pick(audience) : "dave";
    // Out-of-order times happen (a clock set back); order is the sequence's.
    const timestamp = 1_000 * index + Math.floor(next() * 5_000);
    return message(index + 1, sender, pick(CHATS), audience, timestamp);
  });
}

describe("message database", () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.map((dir) => rm(dir, { recursive: true })));
    dirs.length = 0;
  });

  it.each([1, 2, 3, 4, 5])(
    "answers each side of a chat as replaying every message does (seed %i)",
    async (seed) => {
      const store = openMessageDatabase({ path: ":memory:" });
      const messages = history(seed, 300);
      for (const delivery of messages)
        await store.register(delivery.id, delivery);
      for (const participant of [...PEOPLE, "dave"])
        for (const chatId of [...CHATS, "group:none"])
          for (const from of [undefined, 0, 150_000, 290_000])
            expect(
              store.conversation(participant, chatId, from),
              `${participant} in ${chatId} from ${from}`,
            ).toEqual(replayConversation(messages, participant, chatId, from));
    },
  );

  it("keeps a message once as its delivery progresses", async () => {
    const store = openMessageDatabase({ path: ":memory:" });
    const first = message(1, "alice", "group:b", ["alice", "bob"]);
    await store.register(first.id, first);
    const [created] = await store.entries();
    const progressed = {
      ...first,
      copies: first.copies.map((copy) => ({ ...copy, notified: true })),
    };
    await store.register(first.id, progressed);
    expect(await store.lookup(first.id)).toEqual(progressed);
    expect(await store.entries()).toEqual([
      { key: first.id, value: progressed, createdAt: created.createdAt },
    ]);
    expect(store.conversation("bob", "group:b").unanswered).toBe(1);
  });

  it("refuses a write once its owner is no longer current", async () => {
    const store = openMessageDatabase({ path: ":memory:" });
    const first = message(1, "alice", "group:b", ["alice", "bob"]);
    await expect(
      store.register(first.id, first, {
        assertCurrent: () => {
          throw new Error("retired");
        },
      }),
    ).rejects.toThrow("retired");
    expect(await store.lookup(first.id)).toBeUndefined();
  });

  it("brings the old store's messages across once, then clears it", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "kazusa-messages-"));
    dirs.push(dir);
    const file = path.join(dir, "kazusa", "messages.sqlite");
    const old = history(7, 50);
    const clear = vi.fn(async () => {});
    const entries = vi.fn(async () =>
      old.map((value) => ({ key: value.id, value, createdAt: 42 })),
    );
    const legacy = {
      lookup: async () => undefined,
      register: async () => {},
      entries,
      clear,
    };
    const store = openMessageDatabase({ path: file, legacy });
    await store.ready?.();
    await store.ready?.();
    expect(entries).toHaveBeenCalledTimes(1);
    expect(clear).toHaveBeenCalledTimes(1);
    expect((await store.entries()).map(({ value }) => value)).toEqual(old);
    expect((await store.entries())[0].createdAt).toBe(42);
    // One database per file in the process, whoever opens it.
    expect(openMessageDatabase({ path: file })).toBe(store);
  });

  it("clears the old store without copying again after a stop between the two", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "kazusa-messages-"));
    dirs.push(dir);
    const file = path.join(dir, "messages.sqlite");
    const old = history(8, 20);
    const legacy = (clear: () => Promise<void>) => {
      const entries = vi.fn(async () =>
        old.map((value) => ({ key: value.id, value, createdAt: 1 })),
      );
      return {
        lookup: async () => undefined,
        register: async () => {},
        entries,
        clear,
      };
    };
    // The copy commits, then the clear fails (as if the Gateway stopped).
    const first = legacy(() => Promise.reject(new Error("stopped")));
    await openMessageDatabase({ path: file, legacy: first }).ready?.();
    // The next process opens the same file afresh.
    (globalThis as unknown as Record<symbol, Map<string, unknown>>)[
      Symbol.for("kazusa.messageDatabases")
    ].delete(file);
    const clear = vi.fn(async () => {});
    const second = legacy(clear);
    const again = openMessageDatabase({ path: file, legacy: second });
    await again.ready?.();
    expect(second.entries).not.toHaveBeenCalled();
    expect(clear).toHaveBeenCalledTimes(1);
    expect(await again.entries()).toHaveLength(20);
  });
});
