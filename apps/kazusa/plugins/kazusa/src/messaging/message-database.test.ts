import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { withJournalSeq } from "../realtime.ts";
import { replayConversation } from "./message-store.fake.ts";
import {
  isDeliverySettled,
  openMessageDatabase,
  type MessageStore,
} from "./message-database.ts";
import { messageJournal, type MessageDelivery } from "./messaging.ts";

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

/**
 * Messages in random chats from random members, some heard by only a few, at
 * random points of delivery: some copies unwritten, some unread.
 */
function history(seed: number, count: number): MessageDelivery[] {
  const next = random(seed);
  const pick = <T>(items: readonly T[]): T =>
    items[Math.floor(next() * items.length)];
  return Array.from({ length: count }, (_, index) => {
    const audience = PEOPLE.filter(() => next() < 0.75);
    const sender = next() < 0.9 && audience.length ? pick(audience) : "dave";
    // Out-of-order times happen (a clock set back); order is the sequence's.
    const timestamp = 1_000 * index + Math.floor(next() * 5_000);
    const delivery = message(
      index + 1,
      sender,
      pick(CHATS),
      audience,
      timestamp,
    );
    return {
      ...delivery,
      copies: delivery.copies.map((copy) => {
        const done = next() < 0.9;
        return {
          ...copy,
          ...(done ? { messageId: `${delivery.id}:${copy.agentId}` } : {}),
          ...(done ? { published: true, notified: true } : {}),
          ...(copy.role === "user" && next() < 0.6
            ? { readAt: timestamp + 1 }
            : {}),
        };
      }),
    };
  });
}

/**
 * What readers use of a message. A delivered one reads back slim: its copies
 * keep who, which side, their address and when they read it, and it says it is
 * settled; one still in delivery reads back exactly as saved.
 */
const view = (delivery: MessageDelivery | undefined) => {
  if (!delivery || !isDeliverySettled(delivery)) return delivery;
  const { settled: _settled, copies, ...rest } = delivery;
  return {
    ...rest,
    settled: true,
    copies: copies.map(({ agentId, role, sessionKey, readAt }) => ({
      agentId,
      role,
      sessionKey,
      ...(readAt === undefined ? {} : { readAt }),
    })),
  };
};
const views = (deliveries: readonly MessageDelivery[]) => deliveries.map(view);

/** Every message in the test chats, oldest first. */
const everything = (store: MessageStore) =>
  CHATS.flatMap((chat) => store.page(chat, { limit: 10_000 }).messages)
    .map(({ value }) => value)
    .sort((a, b) => a.sequence - b.sequence);

/** The newest `limit` journal rows, as the timeline orders them. */
const newestRows = (deliveries: readonly MessageDelivery[], limit: number) =>
  deliveries
    .map((delivery) => withJournalSeq(messageJournal(delivery)))
    .sort((a, b) => b.seq - a.seq)
    .slice(0, limit)
    .map((row) => row.payload.messageId);

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

  it.each([1, 2, 3])(
    "pages, lists and finds messages as a pass over all of them does (seed %i)",
    async (seed) => {
      const store = openMessageDatabase({ path: ":memory:" });
      const messages = history(seed, 300);
      for (const delivery of messages)
        await store.register(delivery.id, delivery);
      const bySequence = [...messages].sort((a, b) => a.sequence - b.sequence);
      expect(store.lastSequence()).toBe(300);
      expect(store.unsettled()).toEqual(
        bySequence.filter((delivery) => !isDeliverySettled(delivery)),
      );
      for (const chatId of [...CHATS, "group:none"]) {
        const inChat = bySequence.filter((m) => m.chatId === chatId);
        expect(store.audienceOf(chatId)).toEqual(
          [...new Set(inChat.flatMap((m) => m.audience))].sort(),
        );
        for (const participant of [undefined, ...PEOPLE, "dave"]) {
          const seen = inChat.filter(
            (m) =>
              participant === undefined || m.audience.includes(participant),
          );
          // Paging back through the whole chat, as the client does.
          let before: number | undefined;
          const paged: MessageDelivery[] = [];
          for (;;) {
            const page = store.page(chatId, {
              limit: 7,
              ...(before === undefined ? {} : { before }),
              ...(participant === undefined ? {} : { participant }),
            });
            paged.unshift(...page.messages.map(({ value }) => value));
            if (!page.hasMore) break;
            before = page.messages[0].value.sequence;
          }
          expect(views(paged), `${participant} in ${chatId}`).toEqual(
            views(seen),
          );
          expect(view(store.latest(chatId, participant)?.value)).toEqual(
            view(seen.at(-1)),
          );
        }
        for (const agentId of ["alice", "bob", "carol"]) {
          const theirs = inChat.filter((m) => m.audience.includes(agentId));
          const oldest = theirs.find((m) =>
            m.copies.some(
              (c) =>
                c.agentId === agentId &&
                c.role === "user" &&
                c.readAt === undefined,
            ),
          );
          expect(
            views(store.unreadFrom(agentId, chatId)),
            `${agentId} ${chatId}`,
          ).toEqual(
            views(
              oldest ? theirs.filter((m) => m.sequence >= oldest.sequence) : [],
            ),
          );
        }
      }
    },
  );

  it.each([1, 2, 3])(
    "gives the timeline every message that could make its page (seed %i)",
    async (seed) => {
      const store = openMessageDatabase({ path: ":memory:" });
      const messages = history(seed, 300);
      for (const delivery of messages)
        await store.register(delivery.id, delivery);
      for (const actors of [
        undefined,
        ["bob"],
        ["dave"],
        ["alice", "carol"],
        [],
      ])
        for (const [after, before] of [
          [undefined, undefined],
          [undefined, 150_000],
          [100_000, 250_000],
          [290_000, undefined],
        ] as const)
          for (const limit of [1, 5, 50, 500]) {
            const all = messages.filter(
              (m) =>
                (before === undefined || m.timestamp < before) &&
                (after === undefined || m.timestamp > after) &&
                (!actors ||
                  [m.sender, ...m.audience].some((id) => actors.includes(id))),
            );
            const window = {
              limit,
              ...(before === undefined ? {} : { before }),
              ...(after === undefined ? {} : { after }),
              ...(actors ? { actors } : {}),
            };
            const log = store.log(window);
            expect(new Set(log.map((m) => m.id)).size).toBe(log.length);
            // Nothing outside the window or the actors.
            const ids = new Set(all.map((m) => m.id));
            expect(log.every((m) => ids.has(m.id))).toBe(true);
            // And not everything: about `limit`, plus any sharing its last time.
            expect(all.length <= limit + 10 || log.length < all.length).toBe(
              true,
            );
            expect(newestRows(log, limit), `${JSON.stringify(window)}`).toEqual(
              newestRows(all, limit),
            );
          }
    },
  );

  it("upgrades a database made before chat history had its own index", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "kazusa-messages-"));
    dirs.push(dir);
    const file = path.join(dir, "messages.sqlite");
    const messages = history(11, 40);
    // As PR #41 left it: no chat, sender or time columns, no unread table.
    const old = new DatabaseSync(file);
    old.exec(`
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
      CREATE TABLE messages (id TEXT PRIMARY KEY, sequence INTEGER NOT NULL,
        sender_name TEXT NOT NULL, created_at INTEGER NOT NULL,
        delivery TEXT NOT NULL) STRICT;
      CREATE INDEX messages_by_sequence ON messages (sequence);
      CREATE TABLE received (participant TEXT NOT NULL, chat_id TEXT NOT NULL,
        sequence INTEGER NOT NULL, id TEXT NOT NULL, sender TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        PRIMARY KEY (participant, chat_id, sequence, id)) STRICT, WITHOUT ROWID;
      CREATE INDEX received_own ON received (participant, chat_id, sequence)
        WHERE participant = sender;
    `);
    const insert = old.prepare("INSERT INTO messages VALUES (?, ?, ?, ?, ?)");
    const receive = old.prepare(
      "INSERT INTO received VALUES (?, ?, ?, ?, ?, ?)",
    );
    for (const m of messages) {
      insert.run(m.id, m.sequence, m.senderName, 7, JSON.stringify(m));
      for (const p of new Set(m.audience))
        receive.run(p, m.chatId, m.sequence, m.id, m.sender, m.timestamp);
    }
    old.close();
    const store = openMessageDatabase({ path: file });
    expect(views(everything(store))).toEqual(views(messages));
    expect(store.unsettled()).toEqual(
      messages.filter((delivery) => !isDeliverySettled(delivery)),
    );
    expect(store.log({ limit: 3 }).map((m) => m.id)).toEqual(
      newestRows(messages, 3),
    );
    const bob = messages.filter(
      (m) => m.chatId === "group:b" && m.audience.includes("bob"),
    );
    const oldest = bob.find((m) =>
      m.copies.some(
        (c) =>
          c.agentId === "bob" && c.readAt === undefined && c.role === "user",
      ),
    );
    expect(views(store.unreadFrom("bob", "group:b"))).toEqual(
      views(oldest ? bob.filter((m) => m.sequence >= oldest.sequence) : []),
    );
  });

  it("slims a delivered message, keeping what readers use", async () => {
    const store = openMessageDatabase({ path: ":memory:" });
    const sent = message(1, "alice", "direct:ab", ["alice", "bob"]);
    // At an address other than the usual one, which must survive slimming.
    const odd = message(2, "alice", "group:b", ["alice", "bob", "carol"]);
    const delivered = (m: MessageDelivery): MessageDelivery => ({
      ...m,
      copies: m.copies.map((copy, index) => ({
        ...copy,
        sessionKey:
          m === odd && index === 1
            ? "agent:bob:chat:group:old"
            : copy.sessionKey,
        sessionId: `session-${index}`,
        messageId: `ledger-${index}`,
        published: true,
        notified: true,
        ...(copy.role === "user" ? { readAt: 5 } : {}),
      })),
    });
    const inFlight = message(3, "alice", "group:b", ["alice", "bob"]);
    for (const m of [delivered(sent), delivered(odd), inFlight])
      await store.register(m.id, m);
    const read = await store.lookup(sent.id);
    expect(read).toMatchObject({
      settled: true,
      sequence: 1,
      chatId: "direct:ab",
    });
    expect(read && isDeliverySettled(read)).toBe(true);
    // The ledger ids are gone; the rest is as it was, addresses included.
    expect(read?.copies).toEqual([
      {
        agentId: "alice",
        sessionKey: "agent:alice:chat:direct:ab",
        role: "assistant",
        published: true,
      },
      {
        agentId: "bob",
        sessionKey: "agent:bob:chat:direct:ab",
        role: "user",
        published: true,
        notified: true,
        readAt: 5,
      },
    ]);
    expect(view(await store.lookup(odd.id))).toEqual(view(delivered(odd)));
    expect((await store.lookup(odd.id))?.copies[1].sessionKey).toBe(
      "agent:bob:chat:group:old",
    );
    // Still in delivery: exactly as saved, ledger ids and all.
    expect(await store.lookup(inFlight.id)).toEqual(inFlight);
    expect(store.unsettled()).toEqual([inFlight]);
  });

  it("keeps a message once as its delivery progresses", async () => {
    const store = openMessageDatabase({ path: ":memory:" });
    const first = message(1, "alice", "group:b", ["alice", "bob"]);
    await store.register(first.id, first);
    const created = store.latest("group:b");
    const progressed = {
      ...first,
      copies: first.copies.map((copy) => ({ ...copy, notified: true })),
    };
    await store.register(first.id, progressed);
    expect(await store.lookup(first.id)).toEqual(progressed);
    expect(store.page("group:b", { limit: 10 })).toEqual({
      messages: [{ value: progressed, createdAt: created?.createdAt }],
      hasMore: false,
    });
    expect(store.unsettled()).toEqual([progressed]);
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
    expect(views(everything(store))).toEqual(views(old));
    expect(store.latest(old[0].chatId)?.createdAt).toBe(42);
    // One database per file in the process, whoever opens it.
    expect(openMessageDatabase({ path: file })).toBe(store);
  });

  it("keeps the old store, and tries again, when the copy comes up short", async () => {
    const [first] = history(9, 1);
    // Two entries under one key copy as one message: fewer than were read.
    const entries = vi.fn(async () => [
      { key: first.id, value: first, createdAt: 1 },
      { key: first.id, value: first, createdAt: 2 },
    ]);
    const clear = vi.fn(async () => {});
    const store = openMessageDatabase({
      path: ":memory:",
      legacy: {
        lookup: async () => undefined,
        register: async () => {},
        entries,
        clear,
      },
    });
    await expect(store.ready?.()).rejects.toThrow("copied 1 of 2");
    await expect(store.ready?.()).rejects.toThrow("copied 1 of 2");
    expect(entries).toHaveBeenCalledTimes(2);
    expect(clear).not.toHaveBeenCalled();
    expect(store.lastSequence()).toBe(0);
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
    expect(everything(again)).toHaveLength(20);
  });
});
