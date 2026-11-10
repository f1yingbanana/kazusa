import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { StateStore } from "../state.ts";
import type { PerceptionDecisionRecord } from "./types.ts";

/** One attention decision and whose it was. */
export interface RecordedDecision {
  readonly agentId: string;
  readonly record: PerceptionDecisionRecord;
}

/** Which decisions the timeline wants, newest first. */
export interface DecisionWindow {
  /** Sim time, exclusive. */
  readonly before?: number;
  /** Sim time, exclusive. */
  readonly after?: number;
  /** At least this many, when there are; more when several share a time. */
  readonly limit: number;
  /** Only these characters' decisions. */
  readonly actors?: readonly string[];
}

/**
 * Perception's attention decisions: written once each, read only by the
 * timeline, a window at a time.
 */
export interface DecisionStore {
  /** Runs before the first read or write, once per process. */
  readonly ready?: () => Promise<void>;
  /** Saves one decision. */
  record(agentId: string, record: PerceptionDecisionRecord): void;
  /** The newest `limit` decisions in the window, newest first. */
  window(window: DecisionWindow): RecordedDecision[];
}

/*
 * Before this database, decisions shared Perception's keyed namespace with its
 * inbox records, keyed `<agentId>:decision:<uuid>`. Agent ids never contain
 * ":".
 */
const LEGACY_DECISION_KEY = ":decision:";

/** A key of the old namespace that holds a decision, not an inbox record. */
export function isLegacyDecisionKey(key: string): boolean {
  return key.includes(LEGACY_DECISION_KEY);
}

/** The character a legacy decision key belongs to. */
function legacyAgentOf(key: string): string {
  return key.slice(0, key.indexOf(LEGACY_DECISION_KEY));
}

/**
 * One row per decision. The record's JSON keeps everything; the columns are
 * what the timeline filters and orders by.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS decisions (
  n INTEGER PRIMARY KEY,
  agent_id TEXT NOT NULL,
  sim_time INTEGER NOT NULL,
  wall_time INTEGER NOT NULL,
  record TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS decisions_by_time ON decisions (sim_time);
CREATE INDEX IF NOT EXISTS decisions_by_agent ON decisions (agent_id, sim_time);
`;

const VERSION = 1;

/** Set once the old namespace's decisions have been brought across. */
const MIGRATED = "migrated";

const DATABASES = Symbol.for("kazusa.decisionDatabases");

export interface DecisionDatabaseOptions {
  /** The database file, or `:memory:`. */
  readonly path: string;
  /**
   * The old "perception" keyed namespace. Its decision entries are copied in on
   * first use; the namespace itself is Perception's to empty, once its inbox
   * records have moved too.
   */
  readonly legacy?: Pick<StateStore<unknown>, "entries">;
}

/**
 * Kazusa's own decisions database. A decision is one synchronous insert, not a
 * write queued behind every other plugin's in OpenClaw's shared database, and
 * the timeline reads only the window it shows, by index, instead of every
 * decision ever made.
 *
 * `node:sqlite` is synchronous: each call holds the main thread for the
 * microseconds one insert or an indexed read takes. One connection per file for
 * the whole process, however many times the plugin registers.
 */
export function openDecisionDatabase(
  options: DecisionDatabaseOptions,
): DecisionStore {
  if (options.path === ":memory:") return createStore(options);
  const holder = globalThis as { [DATABASES]?: Map<string, DecisionStore> };
  const open = (holder[DATABASES] ??= new Map<string, DecisionStore>());
  let store = open.get(options.path);
  if (!store) {
    mkdirSync(path.dirname(options.path), { recursive: true });
    store = createStore(options);
    open.set(options.path, store);
  }
  return store;
}

/** A stored decision row. */
interface DecisionRow {
  readonly agent_id: string;
  readonly record: string;
}

const decode = (row: DecisionRow): RecordedDecision => ({
  agentId: row.agent_id,
  record: JSON.parse(row.record) as PerceptionDecisionRecord,
});

/**
 * Opens the file, creates its schema, prepares every statement once, and
 * returns the store over them. Use `openDecisionDatabase`, which keeps one per
 * file.
 */
function createStore({
  path: file,
  legacy,
}: DecisionDatabaseOptions): DecisionStore {
  const db = new DatabaseSync(file);
  db.exec(
    "PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;",
  );
  db.exec(SCHEMA);
  db.exec(`PRAGMA user_version = ${VERSION}`);

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

  const insert = db.prepare(
    "INSERT INTO decisions (agent_id, sim_time, wall_time, record) VALUES (?, ?, ?, ?)",
  );
  const readMeta = db.prepare("SELECT value FROM meta WHERE key = ?");
  const writeMeta = db.prepare(
    "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
  );
  const count = db.prepare("SELECT count(*) AS n FROM decisions");

  const save = (agentId: string, record: PerceptionDecisionRecord): void => {
    insert.run(
      agentId,
      Math.floor(record.simTime),
      Math.floor(record.wallTime),
      JSON.stringify(record),
    );
  };

  /**
   * Copies the old namespace's decisions, once (the `migrated` flag records
   * it), oldest first so row order follows time as new ones will. A short copy
   * rolls back, flag included, so the next start tries again and Perception
   * never empties the old namespace.
   */
  async function migrate(): Promise<void> {
    if (!legacy || readMeta.get(MIGRATED) !== undefined) return;
    const decisions = (await legacy.entries())
      .filter(({ key }) => isLegacyDecisionKey(key))
      .map(({ key, value }) => ({
        agentId: legacyAgentOf(key),
        record: value as PerceptionDecisionRecord,
      }))
      .sort(
        (a, b) =>
          a.record.simTime - b.record.simTime ||
          a.record.wallTime - b.record.wallTime,
      );
    transaction(() => {
      const before = (count.get() as { n: number }).n;
      for (const { agentId, record } of decisions) save(agentId, record);
      const copied = (count.get() as { n: number }).n - before;
      if (copied < decisions.length)
        throw new Error(
          `Kazusa decisions: copied ${copied} of ${decisions.length}; the old store is kept`,
        );
      writeMeta.run(MIGRATED, String(decisions.length));
    });
  }

  /** The timeline's window: newest first, ties at the edge kept. */
  function window({
    before,
    after,
    limit,
    actors,
  }: DecisionWindow): RecordedDecision[] {
    const where = [
      before === undefined ? "" : "AND sim_time < :before",
      after === undefined ? "" : "AND sim_time > :after",
      actors ? "AND agent_id IN (SELECT value FROM json_each(:actors))" : "",
    ].join(" ");
    const params = {
      ...(before === undefined ? {} : { before }),
      ...(after === undefined ? {} : { after }),
      ...(actors ? { actors: JSON.stringify(actors) } : {}),
    };
    const edge = db
      .prepare(
        `SELECT sim_time FROM decisions WHERE 1 ${where}
         ORDER BY sim_time DESC LIMIT 1 OFFSET :skip`,
      )
      .get({ ...params, skip: Math.max(0, limit - 1) }) as
      { sim_time: number } | undefined;
    // Fewer than `limit` in the window: all of them.
    const floor = edge ? `AND sim_time >= ${edge.sim_time}` : "";
    return (
      db
        .prepare(
          `SELECT agent_id, record FROM decisions WHERE 1 ${where} ${floor}
           ORDER BY sim_time DESC, n DESC`,
        )
        .all(params) as unknown as DecisionRow[]
    ).map(decode);
  }

  let migrating: Promise<void> | undefined;
  return {
    // A failed copy is tried again by the next caller, not remembered.
    ready: () =>
      (migrating ??= migrate().catch((error: unknown) => {
        migrating = undefined;
        throw error;
      })),
    record: save,
    window,
  };
}
