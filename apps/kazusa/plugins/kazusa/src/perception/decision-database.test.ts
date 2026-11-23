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

  it("leaves out decisions about someone's lines before cutting the window", () => {
    const store = openDecisionDatabase({ path: ":memory:" });
    const from = (sender: string) => ({ ...line("x"), sender });
    store.record("alice", decision(100, "a"));
    store.record("alice", { ...decision(200), lines: [from("bob")] });
    store.record("alice", {
      ...decision(300),
      lines: [from("bob"), { ...from("user:sensei"), messageId: "c" }],
    });
    store.record("alice", decision(400, "d"));
    // The fixture's lines are the operator's; Bob's are kept.
    const ids2 = (rows: { record: PerceptionDecisionRecord }[]) =>
      rows.map(({ record }) => record.lines[0]?.sender);
    expect(ids2(store.window({ limit: 1, without: ["user:sensei"] }))).toEqual([
      "bob",
    ]);
    expect(store.window({ limit: 10, without: ["user:sensei"] })).toHaveLength(
      1,
    );
    expect(store.window({ limit: 10, without: [] })).toHaveLength(4);
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
