import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { decisionEvent, openDecisionDatabase } from "./decision-database.ts";
import type { PerceptionDecisionRecord } from "./types.ts";

const line = (messageId: string, chatId = "direct:abc") => ({
  messageId,
  chatId,
  sender: "user:sensei",
  excerpt: "Are you up?",
});

const decision = (
  simTime: number,
  ...messageIds: string[]
): PerceptionDecisionRecord => ({
  simTime,
  wallTime: simTime,
  outcome: "ignored",
  lines: messageIds.map((id) => line(id)),
});

const ids = (rows: { record: PerceptionDecisionRecord }[]) =>
  rows.map(({ record }) => record.lines[0]?.messageId);

describe("openDecisionDatabase", () => {
  it("reads the newest window, keeping every decision tied at its edge", () => {
    const store = openDecisionDatabase({ path: ":memory:" });
    store.record("alice", decision(100, "a"));
    store.record("bob", decision(200, "b"));
    store.record("alice", decision(200, "c"));
    store.record("alice", decision(300, "d"));

    // Two asked for; both at 200 share the edge.
    expect(ids(store.window({ limit: 2 }))).toEqual(["d", "c", "b"]);
    expect(ids(store.window({ limit: 10, before: 300 }))).toEqual([
      "c",
      "b",
      "a",
    ]);
    expect(ids(store.window({ limit: 10, after: 100 }))).toEqual([
      "d",
      "c",
      "b",
    ]);
    expect(ids(store.window({ limit: 10, actors: ["bob"] }))).toEqual(["b"]);
    expect(store.window({ limit: 10, actors: [] })).toEqual([]);
  });

  it("drops the rows of the first version, which say nothing to show", () => {
    const file = path.join(
      mkdtempSync(path.join(tmpdir(), "kazusa-decisions-")),
      "decisions.sqlite",
    );
    const old = new DatabaseSync(file);
    old.exec(`
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
      CREATE TABLE decisions (
        n INTEGER PRIMARY KEY, agent_id TEXT NOT NULL, sim_time INTEGER NOT NULL,
        wall_time INTEGER NOT NULL, record TEXT NOT NULL
      ) STRICT;
      INSERT INTO decisions (agent_id, sim_time, wall_time, record)
        VALUES ('alice', 1, 1, '{"action":"IGNORE","stimulusIds":["x"],"simTime":1}');
      PRAGMA user_version = 1;
    `);
    old.close();

    const store = openDecisionDatabase({ path: file });
    expect(store.window({ limit: 10 })).toEqual([]);
    store.record("alice", decision(5, "a"));
    expect(ids(store.window({ limit: 10 }))).toEqual(["a"]);
  });
});

describe("decisionEvent", () => {
  it("names the chat the row opens: the first line's, else the one left", () => {
    expect(
      decisionEvent("alice", {
        ...decision(1, "a"),
        tunedOut: "huddle:lunch",
      }),
    ).toMatchObject({ chatId: "direct:abc" });
    expect(
      decisionEvent("alice", {
        simTime: 1,
        wallTime: 1,
        lines: [],
        tunedOut: "huddle:lunch",
      }),
    ).toMatchObject({ chatId: "huddle:lunch" });
  });
});
