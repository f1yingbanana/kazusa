import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { StateStore } from "../state.ts";
import type { MessageCopy, MessageDelivery } from "./messaging.ts";

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
  /** One message by its stable id, as last saved. */
  lookup(id: string): Promise<MessageDelivery | undefined>;
  /**
   * Saves a new message, with who received it, or a known one's delivery
   * progress. The message's chat, audience, sender, time and sequence never
   * change after the first save. `assertCurrent` runs before the write, so a
   * retired owner's write is refused.
   */
  register(
    id: string,
    delivery: MessageDelivery,
    opts?: { readonly assertCurrent?: () => void },
  ): Promise<void>;
  /** The highest acceptance sequence so far; 0 before the first message. */
  lastSequence(): number;
  /** Messages some copy of which is unfinished, in acceptance order. */
  unsettled(): MessageDelivery[];
  /**
   * One participant's side of a chat: when they last spoke there and what they
   * received after. With `from`, those received messages from that sim time on,
   * for "awaiting your reply".
   */
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

/**
 * Every agent copy is written, published and, for a recipient, notified. A
 * message read back from the database after that says so itself (`settled`):
 * its copies no longer carry the ledger ids that showed it.
 */
export function isDeliverySettled(delivery: MessageDelivery): boolean {
  return (
    delivery.settled === true ||
    delivery.copies.every(
      (copy) =>
        Boolean(copy.messageId) &&
        Boolean(copy.published) &&
        (copy.role === "assistant" || Boolean(copy.notified)),
    )
  );
}

/** Recipient copies whose reader has not been shown the message yet. */
function unreadBy(delivery: MessageDelivery): string[] {
  return delivery.copies
    .filter((copy) => copy.role === "user" && copy.readAt === undefined)
    .map((copy) => copy.agentId);
}

/**
 * A character's own address for a chat, as `chatSummary` gives it: the other
 * member of a direct chat, or the chat's id. A copy at any other address keeps
 * it explicitly.
 */
function copyAddress(
  agentId: string,
  chatId: string,
  audience: readonly string[],
): string | undefined {
  if (!chatId.startsWith("direct:")) return `agent:${agentId}:chat:${chatId}`;
  const others = audience.filter((member) => member !== agentId);
  return others.length === 1
    ? `agent:${agentId}:chat:direct:${others[0]}`
    : undefined;
}

/** A delivered copy as stored: who, which side, and when they read it. */
interface SlimCopy {
  readonly agentId: string;
  readonly role: MessageCopy["role"];
  readonly readAt?: number;
  /** Only when it isn't the address `copyAddress` gives. */
  readonly sessionKey?: string;
}

/** What a row keeps in JSON: everything its columns don't already hold. */
interface Body {
  readonly audience: readonly string[];
  readonly params: MessageDelivery["params"];
  readonly copies: readonly (MessageCopy | SlimCopy)[];
}

/**
 * A message's JSON, slimmed once it is delivered: a delivered copy keeps who it
 * was for, which side they were on and when they read it. Its ledger ids and
 * progress flags were only ever needed to finish delivering it.
 */
function encode(delivery: MessageDelivery): { body: string; settled: boolean } {
  const settled = isDeliverySettled(delivery);
  const copies = settled
    ? delivery.copies.map((copy): SlimCopy => {
        const derived = copyAddress(
          copy.agentId,
          delivery.chatId,
          delivery.audience,
        );
        return {
          agentId: copy.agentId,
          role: copy.role,
          ...(copy.readAt === undefined ? {} : { readAt: copy.readAt }),
          ...(copy.sessionKey === derived
            ? {}
            : { sessionKey: copy.sessionKey }),
        };
      })
    : delivery.copies;
  const body: Body = {
    audience: delivery.audience,
    params: delivery.params,
    copies,
  };
  return { body: JSON.stringify(body), settled };
}

/** A stored message row. */
interface MessageRow {
  readonly n: number;
  readonly id: string;
  readonly sequence: number;
  readonly chat_id: string;
  readonly sender: string;
  readonly sender_name: string;
  readonly timestamp: number;
  readonly created_at: number;
  readonly settled: number;
  readonly body: string;
}

/**
 * A stored row back as a message. A delivered copy is rebuilt as delivered:
 * published, notified when it was received, at its address.
 */
function decode(row: MessageRow): MessageDelivery {
  const body = JSON.parse(row.body) as Body;
  const settled = row.settled === 1;
  const copies = settled
    ? (body.copies as SlimCopy[]).map(
        ({ agentId, role, readAt, sessionKey }): MessageCopy => ({
          agentId,
          sessionKey:
            sessionKey ??
            copyAddress(agentId, row.chat_id, body.audience) ??
            "",
          role,
          published: true,
          ...(role === "user" ? { notified: true } : {}),
          ...(readAt === undefined ? {} : { readAt }),
        }),
      )
    : (body.copies as MessageCopy[]);
  return {
    id: row.id,
    sequence: row.sequence,
    sender: row.sender,
    senderName: row.sender_name,
    chatId: row.chat_id,
    audience: body.audience,
    params: body.params,
    timestamp: row.timestamp,
    copies,
    ...(settled ? { settled: true as const } : {}),
  };
}

/** A stored row with when it was first saved. */
const stored = (row: MessageRow): StoredMessage => ({
  value: decode(row),
  createdAt: row.created_at,
});

/**
 * The schema (version 2). Index rows name a message by its row number `n` and a
 * chat by its number in `chats`, not by their long ids: most of the file is
 * index rows, one per recipient.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS chats (
  n INTEGER PRIMARY KEY,
  chat_id TEXT NOT NULL UNIQUE
) STRICT;
CREATE TABLE IF NOT EXISTS messages (
  n INTEGER PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  sequence INTEGER NOT NULL,
  chat INTEGER NOT NULL,
  sender TEXT NOT NULL,
  sender_name TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  settled INTEGER NOT NULL,
  body TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS messages_by_sequence ON messages (sequence);
CREATE INDEX IF NOT EXISTS messages_by_chat ON messages (chat, sequence);
CREATE INDEX IF NOT EXISTS messages_by_time ON messages (timestamp);
CREATE INDEX IF NOT EXISTS messages_by_sender ON messages (sender, timestamp);
CREATE TABLE IF NOT EXISTS received (
  participant TEXT NOT NULL,
  chat INTEGER NOT NULL,
  sequence INTEGER NOT NULL,
  n INTEGER NOT NULL,
  own INTEGER NOT NULL,
  timestamp INTEGER NOT NULL,
  PRIMARY KEY (participant, chat, sequence, n)
) STRICT, WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS received_own
  ON received (participant, chat, sequence) WHERE own = 1;
CREATE INDEX IF NOT EXISTS received_by_chat ON received (chat, participant);
CREATE TABLE IF NOT EXISTS unread (
  agent_id TEXT NOT NULL,
  chat INTEGER NOT NULL,
  sequence INTEGER NOT NULL,
  n INTEGER NOT NULL,
  PRIMARY KEY (agent_id, chat, sequence, n)
) STRICT, WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS unread_by_message ON unread (n);
CREATE TABLE IF NOT EXISTS unsettled (
  n INTEGER PRIMARY KEY
) STRICT;
`;

const VERSION = 2;

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

/**
 * Opens the file, creates or upgrades its schema, prepares every statement
 * once, and returns the store over them. Use `openMessageDatabase`, which keeps
 * one per file.
 */
function createStore({
  path: file,
  legacy,
  now = Date.now,
}: MessageDatabaseOptions): MessageStore {
  const db = new DatabaseSync(file);
  db.exec(
    "PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;",
  );

  /**
   * Runs `run` as one write: all of it commits, or, if it throws, none of it.
   * `IMMEDIATE` takes the write lock up front, so nothing can change in between
   * its reads and its writes.
   */
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

  const columns = (table: string): string[] =>
    (
      db.prepare(`PRAGMA table_info(${table})`).all() as unknown as {
        name: string;
      }[]
    ).map((column) => column.name);

  // An older layout (#41 and #42 kept each message as one JSON `delivery`)
  // steps aside, its derived tables go, and the current schema is created. Its
  // messages are copied across below, once the statements exist.
  transaction(() => {
    if (columns("messages").includes("delivery")) {
      db.exec(`
        ALTER TABLE messages RENAME TO messages_before_v2;
        DROP INDEX IF EXISTS messages_by_sequence;
        DROP INDEX IF EXISTS messages_by_chat;
        DROP INDEX IF EXISTS messages_by_time;
        DROP INDEX IF EXISTS messages_by_sender;
        DROP TABLE IF EXISTS received;
        DROP TABLE IF EXISTS unread;
        DROP TABLE IF EXISTS unsettled;
      `);
    }
    db.exec(SCHEMA);
  });

  const MESSAGE = "m.*, c.chat_id";
  const FROM = "messages m JOIN chats c ON c.n = m.chat";
  const CHAT = "JOIN chats c ON c.n = m.chat";
  const chatNumber = db.prepare("SELECT n FROM chats WHERE chat_id = ?");
  const addChat = db.prepare(
    "INSERT INTO chats (chat_id) VALUES (?) RETURNING n",
  );
  const find = db.prepare(`SELECT ${MESSAGE} FROM ${FROM} WHERE m.id = ?`);
  const insert = db.prepare(
    `INSERT INTO messages
       (id, sequence, chat, sender, sender_name, timestamp, created_at, settled, body)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING n`,
  );
  const update = db.prepare(
    "UPDATE messages SET settled = ?, body = ? WHERE n = ?",
  );
  const receive = db.prepare(
    "INSERT OR IGNORE INTO received (participant, chat, sequence, n, own, timestamp) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const forgetUnread = db.prepare("DELETE FROM unread WHERE n = ?");
  const markUnread = db.prepare(
    "INSERT OR IGNORE INTO unread (agent_id, chat, sequence, n) VALUES (?, ?, ?, ?)",
  );
  const forgetUnsettled = db.prepare("DELETE FROM unsettled WHERE n = ?");
  const markUnsettled = db.prepare(
    "INSERT OR IGNORE INTO unsettled (n) VALUES (?)",
  );
  const maxSequence = db.prepare(
    "SELECT coalesce(max(sequence), 0) AS n FROM messages",
  );
  const unfinished = db.prepare(
    `SELECT ${MESSAGE} FROM unsettled u JOIN messages m ON m.n = u.n ${CHAT}
     ORDER BY m.sequence, m.id`,
  );
  const lastOwn = db.prepare(
    `SELECT sequence, timestamp FROM received
     WHERE participant = ? AND chat = ? AND own = 1
     ORDER BY sequence DESC LIMIT 1`,
  );
  const after = db.prepare(
    `SELECT count(*) AS unanswered,
       (SELECT timestamp FROM received
        WHERE participant = ?1 AND chat = ?2 AND sequence > ?3
        ORDER BY sequence LIMIT 1) AS waitingSince
     FROM received WHERE participant = ?1 AND chat = ?2 AND sequence > ?3`,
  );
  const recent = db.prepare(
    `SELECT m.id, m.sender, m.sender_name AS senderName, r.timestamp
     FROM received r JOIN messages m ON m.n = r.n
     WHERE r.participant = ? AND r.chat = ? AND r.sequence > ?
       AND r.timestamp >= ?
     ORDER BY r.sequence`,
  );
  const chatPage = db.prepare(
    `SELECT ${MESSAGE} FROM ${FROM}
     WHERE m.chat = ? AND m.sequence < ?
     ORDER BY m.sequence DESC, m.id DESC LIMIT ?`,
  );
  const receivedPage = db.prepare(
    `SELECT ${MESSAGE} FROM received r JOIN messages m ON m.n = r.n ${CHAT}
     WHERE r.participant = ? AND r.chat = ? AND r.sequence < ?
     ORDER BY r.sequence DESC, m.id DESC LIMIT ?`,
  );
  const audience = db.prepare(
    "SELECT DISTINCT participant FROM received WHERE chat = ? ORDER BY participant",
  );
  const oldestUnread = db.prepare(
    "SELECT min(sequence) AS n FROM unread WHERE agent_id = ? AND chat = ?",
  );
  const receivedFrom = db.prepare(
    `SELECT ${MESSAGE} FROM received r JOIN messages m ON m.n = r.n ${CHAT}
     WHERE r.participant = ? AND r.chat = ? AND r.sequence >= ?
     ORDER BY r.sequence, m.id`,
  );
  const readMeta = db.prepare("SELECT value FROM meta WHERE key = ?");
  const writeMeta = db.prepare(
    "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
  );
  const count = db.prepare("SELECT count(*) AS n FROM messages");

  /** A chat's number, if any message has been saved in it. */
  const numberOf = (chatId: string): number | undefined =>
    (chatNumber.get(chatId) as { n: number } | undefined)?.n;

  /** Inside a transaction: a new message and who received it, or progress. */
  function save(
    id: string,
    delivery: MessageDelivery,
    createdAt: number,
  ): void {
    const { body, settled } = encode(delivery);
    const existing = find.get(id) as MessageRow | undefined;
    let n = existing?.n;
    const chat =
      numberOf(delivery.chatId) ??
      (addChat.get(delivery.chatId) as { n: number }).n;
    if (n !== undefined) update.run(settled ? 1 : 0, body, n);
    else {
      n = (
        insert.get(
          id,
          delivery.sequence,
          chat,
          delivery.sender,
          delivery.senderName,
          delivery.timestamp,
          createdAt,
          settled ? 1 : 0,
          body,
        ) as { n: number }
      ).n;
      for (const participant of new Set(delivery.audience))
        receive.run(
          participant,
          chat,
          delivery.sequence,
          n,
          participant === delivery.sender ? 1 : 0,
          delivery.timestamp,
        );
    }
    forgetUnread.run(n);
    for (const agentId of unreadBy(delivery))
      markUnread.run(agentId, chat, delivery.sequence, n);
    if (settled) forgetUnsettled.run(n);
    else markUnsettled.run(n);
  }

  // Bring an older layout's messages across, slimmed, in one transaction.
  if (
    (
      db
        .prepare(
          "SELECT count(*) AS n FROM sqlite_master WHERE name = 'messages_before_v2'",
        )
        .get() as { n: number }
    ).n > 0
  )
    transaction(() => {
      for (const row of db
        .prepare(
          "SELECT id, created_at, delivery FROM messages_before_v2 ORDER BY sequence, id",
        )
        .iterate() as Iterable<{
        id: string;
        created_at: number;
        delivery: string;
      }>)
        save(
          row.id,
          JSON.parse(row.delivery) as MessageDelivery,
          row.created_at,
        );
      db.exec("DROP TABLE messages_before_v2");
    });
  db.exec(`PRAGMA user_version = ${VERSION}`);

  let migrating: Promise<void> | undefined;
  /**
   * Copies the messages kept in OpenClaw's keyed store before this database,
   * once (the `migrated` flag records it), then clears that store. Without a
   * legacy store there is nothing to do.
   */
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

  /**
   * The newest `limit` messages of a chat before sequence `before`, oldest
   * first, reading one more to know whether older ones remain. With a
   * participant, only what they received, read from `received`, so messages
   * they never saw cannot hide an older page across a leave and rejoin.
   */
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
    const chat = numberOf(chatId);
    if (chat === undefined) return { messages: [], hasMore: false };
    const below = before ?? Number.MAX_SAFE_INTEGER;
    const rows = (participant === undefined
      ? chatPage.all(chat, below, limit + 1)
      : receivedPage.all(
          participant,
          chat,
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
          OR m.n IN (SELECT r.n FROM received r
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
          `SELECT ${MESSAGE} FROM ${FROM} WHERE 1 ${range} ${who} ${floor}
           ORDER BY m.timestamp DESC, m.sequence DESC`,
        )
        .all(params) as unknown as MessageRow[]
    ).map(decode);
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
        const row = find.get(key) as MessageRow | undefined;
        return row ? decode(row) : undefined;
      }),
    // The owner check, then the message and its indexes in one transaction.
    register: (key, value, opts) =>
      settle(() => {
        opts?.assertCurrent?.();
        transaction(() => {
          save(key, value, now());
        });
      }),
    lastSequence: () => (maxSequence.get() as { n: number }).n,
    unsettled: () => (unfinished.all() as unknown as MessageRow[]).map(decode),
    // Their last line in the chat, then everything they received after it:
    // three index reads, however long the chat.
    conversation(participant, chatId, from) {
      const chat = numberOf(chatId);
      const own =
        chat === undefined
          ? undefined
          : (lastOwn.get(participant, chat) as
              { sequence: number; timestamp: number } | undefined);
      const since = own?.sequence ?? Number.MIN_SAFE_INTEGER;
      const tail =
        chat === undefined
          ? { unanswered: 0, waitingSince: null }
          : (after.get(participant, chat, since) as {
              unanswered: number;
              waitingSince: number | null;
            });
      return {
        lastSpokeAt: own?.timestamp ?? null,
        unanswered: tail.unanswered,
        waitingSince: tail.waitingSince,
        recent:
          from === undefined || chat === undefined
            ? []
            : (recent.all(
                participant,
                chat,
                since,
                from,
              ) as unknown as ReceivedMessage[]),
      };
    },
    page,
    // A page of one, newest.
    latest: (chatId, participant) =>
      page(chatId, {
        ...(participant === undefined ? {} : { participant }),
        limit: 1,
      }).messages[0],
    audienceOf: (chatId) => {
      const chat = numberOf(chatId);
      return chat === undefined
        ? []
        : (audience.all(chat) as unknown as { participant: string }[]).map(
            (row) => row.participant,
          );
    },
    log,
    // Their oldest unread message in the chat, from `unread`, then every
    // message they received from there on: read receipts need the read ones in
    // between to know how far a shown message reaches.
    unreadFrom(agentId, chatId) {
      const chat = numberOf(chatId);
      if (chat === undefined) return [];
      const { n } = oldestUnread.get(agentId, chat) as { n: number | null };
      if (n === null) return [];
      return (
        receivedFrom.all(agentId, chat, n) as unknown as MessageRow[]
      ).map(decode);
    },
  };
}
