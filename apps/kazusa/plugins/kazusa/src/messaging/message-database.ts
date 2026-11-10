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

/** The canonical message store, with the queries Messaging asks most. */
export interface MessageStore extends StateStore<MessageDelivery> {
  /** Runs before the first read, once per process. */
  readonly ready?: () => Promise<void>;
  /** Synchronous, from what has committed. */
  conversation(
    participant: string,
    chatId: string,
    from?: number,
  ): Conversation;
}

const SCHEMA = `
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
}

/**
 * Kazusa's own message database: every message once, keyed by its stable id,
 * and who received each, so a participant's side of a chat is an indexed read
 * rather than a pass over every message ever sent. OpenClaw's keyed stores
 * can't be indexed by anything but their key.
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

function createStore({
  path: file,
  legacy,
}: MessageDatabaseOptions): MessageStore {
  const db = new DatabaseSync(file);
  db.exec(
    "PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;",
  );
  db.exec(SCHEMA);

  const find = db.prepare("SELECT delivery FROM messages WHERE id = ?");
  const all = db.prepare(
    "SELECT id, created_at, delivery FROM messages ORDER BY sequence, id",
  );
  const insert = db.prepare(
    "INSERT INTO messages (id, sequence, sender_name, created_at, delivery) VALUES (?, ?, ?, ?, ?)",
  );
  const update = db.prepare("UPDATE messages SET delivery = ? WHERE id = ?");
  const receive = db.prepare(
    "INSERT OR IGNORE INTO received (participant, chat_id, sequence, id, sender, timestamp) VALUES (?, ?, ?, ?, ?, ?)",
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
  const readMeta = db.prepare("SELECT value FROM meta WHERE key = ?");
  const writeMeta = db.prepare(
    "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
  );
  const count = db.prepare("SELECT count(*) AS n FROM messages");

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

  /** Inside a transaction: a new message and who received it, or progress. */
  function save(
    id: string,
    delivery: MessageDelivery,
    createdAt: number,
  ): void {
    const json = JSON.stringify(delivery);
    if (find.get(id)) {
      update.run(json, id);
      return;
    }
    insert.run(id, delivery.sequence, delivery.senderName, createdAt, json);
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

  let migrating: Promise<void> | undefined;
  async function migrate(): Promise<void> {
    if (!legacy) return;
    if (readMeta.get(MIGRATED) === undefined) {
      const entries = await legacy.entries();
      transaction(() => {
        for (const { key, value, createdAt } of entries)
          if (!find.get(key)) save(key, value, createdAt);
        writeMeta.run(MIGRATED, String(entries.length));
      });
      const { n } = count.get() as { n: number };
      if (n < entries.length)
        throw new Error(
          `Kazusa messages: copied ${n} of ${entries.length}; the old store is kept`,
        );
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
        return row ? (JSON.parse(row.delivery) as MessageDelivery) : undefined;
      }),
    register: (key, value, opts) =>
      settle(() => {
        opts?.assertCurrent?.();
        transaction(() => {
          save(key, value, Date.now());
        });
      }),
    entries: () =>
      settle(() =>
        (all.all() as unknown as MessageRow[]).map((row) => ({
          key: row.id,
          value: JSON.parse(row.delivery) as MessageDelivery,
          createdAt: row.created_at,
        })),
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
  };
}
