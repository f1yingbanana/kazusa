import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { StateStore } from "../state.ts";
import type { MessageDelivery } from "./messaging.ts";

/** A message someone received, as "awaiting your reply" names it. */
export type ReceivedMessage = Pick<
  MessageDelivery,
  "id" | "sender" | "senderName" | "timestamp"
>;

/** One participant's side of one chat, from the messages they received. */
export interface Conversation {
  /** Their latest message there (sim time), if they have spoken. */
  readonly lastSpokeAt: number | null;
  /** How many messages they received after it. */
  readonly unanswered: number;
  /** When the first of those arrived. */
  readonly waitingSince: number | null;
  /** Those sent at or after `from`, oldest first; none without `from`. */
  readonly recent: readonly ReceivedMessage[];
}

/** A message as stored, with the real time it was first saved. */
export interface StoredMessage {
  readonly value: MessageDelivery;
  readonly createdAt: number;
}

/** One page of a chat's history, oldest first. */
export interface HistoryPage {
  readonly messages: readonly StoredMessage[];
  /** Older messages remain before the first. */
  readonly hasMore: boolean;
}

/** Which messages the timeline wants, newest first. */
export interface LogWindow {
  /** Sim time, exclusive. */
  readonly before?: number;
  /** Sim time, exclusive. */
  readonly after?: number;
  /** At least this many, when there are; more when several share a time. */
  readonly limit: number;
  /** Only messages one of these sent or received. */
  readonly actors?: readonly string[];
}

/**
 * The canonical message store. Every read is indexed: none lists every message,
 * so none grows with all of history.
 */
export interface MessageStore {
  /** Runs before the first read, once per process. */
  readonly ready?: () => Promise<void>;
  lookup(id: string): Promise<MessageDelivery | undefined>;
  register(
    id: string,
    delivery: MessageDelivery,
    opts?: { readonly assertCurrent?: () => void },
  ): Promise<void>;
  /** The highest acceptance sequence so far; 0 before the first message. */
  lastSequence(): number;
  /** Messages some copy of which is unfinished, in acceptance order. */
  unsettled(): MessageDelivery[];
  conversation(
    participant: string,
    chatId: string,
    from?: number,
  ): Conversation;
  /**
   * The newest `limit` messages of a chat before sequence `before`: only those
   * `participant` received, when given.
   */
  page(
    chatId: string,
    options: {
      readonly participant?: string;
      readonly before?: number;
      readonly limit: number;
    },
  ): HistoryPage;
  /** The chat's latest message, if it has any. */
  latest(chatId: string, participant?: string): StoredMessage | undefined;
  /** Everyone who received any message in the chat. */
  audienceOf(chatId: string): string[];
  /** Messages for the timeline, newest first. */
  log(window: LogWindow): MessageDelivery[];
  /**
   * The agent's messages in the chat from the oldest one of theirs still unread
   * on, oldest first; none when everything there is read.
   */
  unreadFrom(agentId: string, chatId: string): MessageDelivery[];
}

/** Every agent copy is written, published and, for a recipient, notified. */
export function isDeliverySettled(delivery: MessageDelivery): boolean {
  return delivery.copies.every(
    (copy) =>
      Boolean(copy.messageId) &&
      Boolean(copy.published) &&
      (copy.role === "assistant" || Boolean(copy.notified)),
  );
}

/** Recipient copies whose reader has not been shown the message yet. */
function unreadBy(delivery: MessageDelivery): string[] {
  return delivery.copies
    .filter((copy) => copy.role === "user" && copy.readAt === undefined)
    .map((copy) => copy.agentId);
}

/** The first version, as #41 created it. */
const BASE_SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  sequence INTEGER NOT NULL,
  sender_name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  delivery TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS messages_by_sequence ON messages (sequence);
CREATE TABLE IF NOT EXISTS received (
  participant TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  id TEXT NOT NULL,
  sender TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  PRIMARY KEY (participant, chat_id, sequence, id)
) STRICT, WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS received_own
  ON received (participant, chat_id, sequence) WHERE participant = sender;
`;

/**
 * Version 1: a message's chat, sender and time as columns, for chat history and
 * the timeline; who received each chat; and which copies are unread or
 * unfinished, for read receipts and startup.
 */
const VERSION_1 = `
ALTER TABLE messages ADD COLUMN chat_id TEXT;
ALTER TABLE messages ADD COLUMN sender TEXT;
ALTER TABLE messages ADD COLUMN timestamp INTEGER;
UPDATE messages SET
  chat_id = json_extract(delivery, '$.chatId'),
  sender = json_extract(delivery, '$.sender'),
  timestamp = json_extract(delivery, '$.timestamp');
CREATE INDEX messages_by_chat ON messages (chat_id, sequence);
CREATE INDEX messages_by_time ON messages (timestamp);
CREATE INDEX messages_by_sender ON messages (sender, timestamp);
CREATE INDEX received_by_chat ON received (chat_id, participant);
CREATE TABLE unread (
  agent_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  id TEXT NOT NULL,
  PRIMARY KEY (agent_id, chat_id, sequence, id)
) STRICT, WITHOUT ROWID;
CREATE INDEX unread_by_message ON unread (id);
CREATE TABLE unsettled (
  id TEXT PRIMARY KEY,
  sequence INTEGER NOT NULL
) STRICT;
`;

/** Set once older messages have been brought across. */
const MIGRATED = "migrated";

const DATABASES = Symbol.for("kazusa.messageDatabases");

export interface MessageDatabaseOptions {
  /** The database file, or `:memory:`. */
  readonly path: string;
  /**
   * Where messages were kept before (OpenClaw's `messaging` keyed store). Its
   * messages are copied in on first use, then it is cleared.
   */
  readonly legacy?: StateStore<MessageDelivery> &
    Partial<{ clear: () => Promise<void> }>;
  /** Real time, for when a message was first saved. */
  readonly now?: () => number;
}

/**
 * Kazusa's own message database: every message once, keyed by its stable id,
 * with indexes for each question Messaging asks, so no read passes over every
 * message ever sent. OpenClaw's keyed stores can't be indexed by anything but
 * their key.
 *
 * `node:sqlite` is synchronous: each call holds the main thread for the
 * microseconds an indexed read or one message's write takes. One connection per
 * file for the whole process, however many times the plugin registers.
 */
export function openMessageDatabase(
  options: MessageDatabaseOptions,
): MessageStore {
  if (options.path === ":memory:") return createStore(options);
  const holder = globalThis as { [DATABASES]?: Map<string, MessageStore> };
  const open = (holder[DATABASES] ??= new Map<string, MessageStore>());
  let store = open.get(options.path);
  if (!store) {
    mkdirSync(path.dirname(options.path), { recursive: true });
    store = createStore(options);
    open.set(options.path, store);
  }
  return store;
}

interface MessageRow {
  readonly id: string;
  readonly created_at: number;
  readonly delivery: string;
}

const parse = (row: Pick<MessageRow, "delivery">): MessageDelivery =>
  JSON.parse(row.delivery) as MessageDelivery;

const stored = (row: MessageRow): StoredMessage => ({
  value: parse(row),
  createdAt: row.created_at,
});

function createStore({
  path: file,
  legacy,
  now = Date.now,
}: MessageDatabaseOptions): MessageStore {
  const db = new DatabaseSync(file);
  db.exec(
    "PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;",
  );

  function transaction<T>(run: () => T): T {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = run();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  transaction(() => {
    db.exec(BASE_SCHEMA);
    const { user_version: version } = db
      .prepare("PRAGMA user_version")
      .get() as { user_version: number };
    if (version < 1) {
      db.exec(VERSION_1);
      // Unread and unfinished copies are the store's rules, not SQL's.
      const unread = db.prepare(
        "INSERT INTO unread (agent_id, chat_id, sequence, id) VALUES (?, ?, ?, ?)",
      );
      const unsettled = db.prepare(
        "INSERT INTO unsettled (id, sequence) VALUES (?, ?)",
      );
      for (const row of db
        .prepare("SELECT delivery FROM messages")
        .iterate() as Iterable<Pick<MessageRow, "delivery">>) {
        const delivery = parse(row);
        for (const agentId of unreadBy(delivery))
          unread.run(agentId, delivery.chatId, delivery.sequence, delivery.id);
        if (!isDeliverySettled(delivery))
          unsettled.run(delivery.id, delivery.sequence);
      }
      db.exec("PRAGMA user_version = 1");
    }
  });

  const MESSAGE = "m.id, m.created_at, m.delivery";
  const find = db.prepare("SELECT delivery FROM messages WHERE id = ?");
  const insert = db.prepare(
    `INSERT INTO messages
       (id, sequence, sender_name, created_at, delivery, chat_id, sender, timestamp)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const update = db.prepare("UPDATE messages SET delivery = ? WHERE id = ?");
  const receive = db.prepare(
    "INSERT OR IGNORE INTO received (participant, chat_id, sequence, id, sender, timestamp) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const forgetUnread = db.prepare("DELETE FROM unread WHERE id = ?");
  const markUnread = db.prepare(
    "INSERT OR IGNORE INTO unread (agent_id, chat_id, sequence, id) VALUES (?, ?, ?, ?)",
  );
  const forgetUnsettled = db.prepare("DELETE FROM unsettled WHERE id = ?");
  const markUnsettled = db.prepare(
    "INSERT OR IGNORE INTO unsettled (id, sequence) VALUES (?, ?)",
  );
  const maxSequence = db.prepare(
    "SELECT coalesce(max(sequence), 0) AS n FROM messages",
  );
  const unfinished = db.prepare(
    `SELECT m.delivery FROM unsettled u JOIN messages m ON m.id = u.id
     ORDER BY u.sequence, u.id`,
  );
  const lastOwn = db.prepare(
    `SELECT sequence, timestamp FROM received
     WHERE participant = ? AND chat_id = ? AND participant = sender
     ORDER BY sequence DESC LIMIT 1`,
  );
  const after = db.prepare(
    `SELECT count(*) AS unanswered,
       (SELECT timestamp FROM received
        WHERE participant = ?1 AND chat_id = ?2 AND sequence > ?3
        ORDER BY sequence LIMIT 1) AS waitingSince
     FROM received WHERE participant = ?1 AND chat_id = ?2 AND sequence > ?3`,
  );
  const recent = db.prepare(
    `SELECT r.id, r.sender, m.sender_name AS senderName, r.timestamp
     FROM received r JOIN messages m ON m.id = r.id
     WHERE r.participant = ? AND r.chat_id = ? AND r.sequence > ?
       AND r.timestamp >= ?
     ORDER BY r.sequence`,
  );
  const chatPage = db.prepare(
    `SELECT ${MESSAGE} FROM messages m
     WHERE m.chat_id = ? AND m.sequence < ?
     ORDER BY m.sequence DESC, m.id DESC LIMIT ?`,
  );
  const receivedPage = db.prepare(
    `SELECT ${MESSAGE} FROM received r JOIN messages m ON m.id = r.id
     WHERE r.participant = ? AND r.chat_id = ? AND r.sequence < ?
     ORDER BY r.sequence DESC, r.id DESC LIMIT ?`,
  );
  const audience = db.prepare(
    "SELECT DISTINCT participant FROM received WHERE chat_id = ? ORDER BY participant",
  );
  const oldestUnread = db.prepare(
    "SELECT min(sequence) AS n FROM unread WHERE agent_id = ? AND chat_id = ?",
  );
  const receivedFrom = db.prepare(
    `SELECT m.delivery FROM received r JOIN messages m ON m.id = r.id
     WHERE r.participant = ? AND r.chat_id = ? AND r.sequence >= ?
     ORDER BY r.sequence, r.id`,
  );
  const readMeta = db.prepare("SELECT value FROM meta WHERE key = ?");
  const writeMeta = db.prepare(
    "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
  );
  const count = db.prepare("SELECT count(*) AS n FROM messages");

  /** Inside a transaction: a new message and who received it, or progress. */
  function save(
    id: string,
    delivery: MessageDelivery,
    createdAt: number,
  ): void {
    const json = JSON.stringify(delivery);
    if (find.get(id)) update.run(json, id);
    else {
      insert.run(
        id,
        delivery.sequence,
        delivery.senderName,
        createdAt,
        json,
        delivery.chatId,
        delivery.sender,
        delivery.timestamp,
      );
      for (const participant of new Set(delivery.audience))
        receive.run(
          participant,
          delivery.chatId,
          delivery.sequence,
          id,
          delivery.sender,
          delivery.timestamp,
        );
    }
    forgetUnread.run(id);
    for (const agentId of unreadBy(delivery))
      markUnread.run(agentId, delivery.chatId, delivery.sequence, id);
    if (isDeliverySettled(delivery)) forgetUnsettled.run(id);
    else markUnsettled.run(id, delivery.sequence);
  }

  let migrating: Promise<void> | undefined;
  async function migrate(): Promise<void> {
    if (!legacy) return;
    if (readMeta.get(MIGRATED) === undefined) {
      const entries = await legacy.entries();
      // A short copy rolls back, flag included, so the next read tries again
      // and the old store is never cleared.
      transaction(() => {
        for (const { key, value, createdAt } of entries)
          if (!find.get(key)) save(key, value, createdAt);
        const { n } = count.get() as { n: number };
        if (n < entries.length)
          throw new Error(
            `Kazusa messages: copied ${n} of ${entries.length}; the old store is kept`,
          );
        writeMeta.run(MIGRATED, String(entries.length));
      });
    }
    // Also after a stop between the copy and this. A failure leaves the rows
    // for the next start: they are never read again.
    await legacy.clear?.().catch(() => undefined);
  }

  /** As OpenClaw's stores do: a failure rejects rather than throws. */
  function settle<T>(run: () => T): Promise<T> {
    try {
      return Promise.resolve(run());
    } catch (error) {
      return Promise.reject(
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  function page(
    chatId: string,
    {
      participant,
      before,
      limit,
    }: {
      readonly participant?: string;
      readonly before?: number;
      readonly limit: number;
    },
  ): HistoryPage {
    const below = before ?? Number.MAX_SAFE_INTEGER;
    const rows = (participant === undefined
      ? chatPage.all(chatId, below, limit + 1)
      : receivedPage.all(
          participant,
          chatId,
          below,
          limit + 1,
        )) as unknown as MessageRow[];
    return {
      messages: rows.slice(0, limit).reverse().map(stored),
      hasMore: rows.length > limit,
    };
  }

  /** The timeline's window: newest first, ties at the edge kept. */
  function log({ before, after, limit, actors }: LogWindow): MessageDelivery[] {
    const range = [
      before === undefined ? "" : "AND m.timestamp < :before",
      after === undefined ? "" : "AND m.timestamp > :after",
    ].join(" ");
    const who = actors
      ? `AND (m.sender IN (SELECT value FROM json_each(:actors))
          OR m.id IN (SELECT r.id FROM received r
                      WHERE r.participant IN (SELECT value FROM json_each(:actors))))`
      : "";
    const params = {
      ...(before === undefined ? {} : { before }),
      ...(after === undefined ? {} : { after }),
      ...(actors ? { actors: JSON.stringify(actors) } : {}),
    };
    const newest = db
      .prepare(
        `SELECT m.timestamp FROM messages m WHERE 1 ${range} ${who}
         ORDER BY m.timestamp DESC LIMIT 1 OFFSET :skip`,
      )
      .get({ ...params, skip: Math.max(0, limit - 1) }) as
      { timestamp: number } | undefined;
    // Fewer than `limit` in the window: all of them.
    const floor = newest
      ? `AND m.timestamp >= ${Math.floor(newest.timestamp)}`
      : "";
    return (
      db
        .prepare(
          `SELECT m.delivery FROM messages m WHERE 1 ${range} ${who} ${floor}
           ORDER BY m.timestamp DESC, m.sequence DESC`,
        )
        .all(params) as unknown as Pick<MessageRow, "delivery">[]
    ).map(parse);
  }

  return {
    // A failed copy is tried again by the next read, not remembered.
    ready: () =>
      (migrating ??= migrate().catch((error: unknown) => {
        migrating = undefined;
        throw error;
      })),
    lookup: (key) =>
      settle(() => {
        const row = find.get(key) as Pick<MessageRow, "delivery"> | undefined;
        return row ? parse(row) : undefined;
      }),
    register: (key, value, opts) =>
      settle(() => {
        opts?.assertCurrent?.();
        transaction(() => {
          save(key, value, now());
        });
      }),
    lastSequence: () => (maxSequence.get() as { n: number }).n,
    unsettled: () =>
      (unfinished.all() as unknown as Pick<MessageRow, "delivery">[]).map(
        parse,
      ),
    conversation(participant, chatId, from) {
      const own = lastOwn.get(participant, chatId) as
        { sequence: number; timestamp: number } | undefined;
      const since = own?.sequence ?? Number.MIN_SAFE_INTEGER;
      const tail = after.get(participant, chatId, since) as {
        unanswered: number;
        waitingSince: number | null;
      };
      return {
        lastSpokeAt: own?.timestamp ?? null,
        unanswered: tail.unanswered,
        waitingSince: tail.waitingSince,
        recent:
          from === undefined
            ? []
            : (recent.all(
                participant,
                chatId,
                since,
                from,
              ) as unknown as ReceivedMessage[]),
      };
    },
    page,
    latest: (chatId, participant) =>
      page(chatId, {
        ...(participant === undefined ? {} : { participant }),
        limit: 1,
      }).messages[0],
    audienceOf: (chatId) =>
      (audience.all(chatId) as unknown as { participant: string }[]).map(
        (row) => row.participant,
      ),
    log,
    unreadFrom(agentId, chatId) {
      const { n } = oldestUnread.get(agentId, chatId) as { n: number | null };
      if (n === null) return [];
      return (
        receivedFrom.all(agentId, chatId, n) as unknown as Pick<
          MessageRow,
          "delivery"
        >[]
      ).map(parse);
    },
  };
}
