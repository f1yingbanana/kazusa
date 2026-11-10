import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { PerceptionDecisionRecord } from "./types.ts";

/** One kept attention decision and whose it was. */
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
 * The attention decisions Perception keeps: written once each, read only by the
 * timeline, a window at a time.
 */
export interface DecisionStore {
  /** Saves one decision. */
  record(agentId: string, record: PerceptionDecisionRecord): void;
  /** The newest `limit` decisions in the window, newest first. */
  window(window: DecisionWindow): RecordedDecision[];
}

/** A kept decision as the timeline's journal event, before its seq. */
export function decisionEvent(
  agentId: string,
  record: PerceptionDecisionRecord,
) {
  const { simTime, wallTime: _wallTime, ...payload } = record;
  const chats = new Set(record.lines.map((line) => line.chatId));
  const chatId =
    record.tunedOut ?? (chats.size === 1 ? [...chats][0] : undefined);
  return {
    simTime,
    actors: [agentId],
    ...(chatId ? { chatId } : {}),
    kind: "attention.decided" as const,
    payload: { ...payload, lines: [...payload.lines] },
  };
}

/**
 * One row per decision. The record's JSON keeps everything; the columns are
 * what the timeline filters and orders by.
 */
const SCHEMA = `
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

const DATABASES = Symbol.for("kazusa.decisionDatabases");

export interface DecisionDatabaseOptions {
  /** The database file, or `:memory:`. */
  readonly path: string;
}

/**
 * Kazusa's own decisions database. A decision is one synchronous insert, not a
 * write queued behind every other plugin's in OpenClaw's shared database, and
 * the timeline reads only the window it shows, by index.
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
 * Opens the file, creates its schema, prepares the insert once, and returns the
 * store over it. Use `openDecisionDatabase`, which keeps one per file.
 */
function createStore({ path: file }: DecisionDatabaseOptions): DecisionStore {
  const db = new DatabaseSync(file);
  db.exec(
    "PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;",
  );
  db.exec(SCHEMA);
  db.exec(`PRAGMA user_version = ${VERSION}`);

  const insert = db.prepare(
    "INSERT INTO decisions (agent_id, sim_time, wall_time, record) VALUES (?, ?, ?, ?)",
  );

  const record = (
    agentId: string,
    decision: PerceptionDecisionRecord,
  ): void => {
    insert.run(
      agentId,
      Math.floor(decision.simTime),
      Math.floor(decision.wallTime),
      JSON.stringify(decision),
    );
  };

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

  return { record, window };
}
