import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { errorClass, format, readStates, summarize } from "./sleep-report.mjs";

const HOUR = 3_600_000;
const run = (id, files) => ({
  id,
  at: 0,
  preimages: Object.fromEntries(files.map((file) => [file, null])),
  postimages: Object.fromEntries(files.map((file) => [file, "x"])),
});
const outcome = (over) => ({
  at: 0,
  wallAt: 2 * HOUR,
  attempts: 1,
  errors: [],
  ...over,
});

const STATES = {
  ann: {
    watermark: 5,
    runs: [run("r1", ["wiki/days/2026-11-02.md", "MEMORY.md"])],
    outcomes: [
      outcome({
        result: "applied",
        attempts: 2,
        errors: ["SyntaxError: Expected ',' or ']' after array element"],
        runId: "r1",
        pages: 3,
        newPages: 1,
        notes: 4,
        views: 2,
        self: true,
        dream: true,
        repaired: true,
        dropped: ["sensei: sensei said nothing in the records"],
      }),
      // Before the window.
      outcome({ result: "failed", wallAt: 0, errors: ["x"] }),
    ],
  },
  bo: {
    runs: [],
    outcomes: [
      outcome({
        result: "failed",
        attempts: 3,
        errors: [
          "TimeoutError: The operation was aborted due to timeout",
          "Error: No usable day in the sleep output (day).",
          "FailoverError: Isolated completion failed with stop reason error.",
        ],
      }),
      outcome({ result: "interrupted", wallAt: 3 * HOUR }),
      outcome({ result: "empty", attempts: 0 }),
    ],
  },
  // A character who slept before outcomes were kept.
  cy: { watermark: 1, runs: [run("old", ["MEMORY.md"])] },
};
const WINDOW = { since: HOUR, until: 4 * HOUR };

describe("sleep report", () => {
  it("counts passes, retries and why calls failed", () => {
    const { totals } = summarize(STATES, WINDOW);
    expect(totals).toEqual({
      passes: 3,
      applied: 1,
      failed: 1,
      interrupted: 1,
      empty: 1,
      retried: 2,
      appliedAfterRetry: 1,
      readLeniently: 1,
      withDrops: 1,
      failedCalls: {
        "unreadable JSON": 1,
        timeout: 1,
        "no day in the reply": 1,
        "provider error": 1,
      },
    });
  });

  it("checks what each applied night left on disk", () => {
    const { applied } = summarize(STATES, WINDOW);
    expect(applied).toMatchObject({
      dayPage: 1,
      withNotes: 1,
      withViews: 1,
      withDream: 1,
      memoryChanged: 1,
      notes: 4,
      pages: 3,
    });
  });

  it("prints a table", () => {
    const text = format(summarize(STATES, WINDOW), WINDOW);
    expect(text).toContain("Passes: 3 (applied 1, failed 1, interrupted");
    expect(text).toContain("day page written   1/1 (100%)");
    expect(text).toMatch(/bo +failed +3 .*timeout, no day in the reply/);
  });

  it("classifies the errors seen live", () => {
    expect(
      errorClass("SyntaxError: Bad control character in string literal"),
    ).toBe("unreadable JSON");
    expect(errorClass("Error: No JSON in the reply.")).toBe("unreadable JSON");
    expect(
      errorClass(
        "Error: prepared model runtime owner was not committed after replacement for /tmp/claude-501/x",
      ),
    ).toBe("runtime not ready");
    expect(errorClass("AbortError: whatever")).toBe("other");
  });

  it("reads the states from a world's database", () => {
    const world = mkdtempSync(path.join(tmpdir(), "kazusa-sleep-report-"));
    mkdirSync(path.join(world, ".state", "state"), { recursive: true });
    const db = new DatabaseSync(
      path.join(world, ".state", "state", "openclaw.sqlite"),
    );
    db.exec(
      "CREATE TABLE plugin_state_entries (plugin_id TEXT, namespace TEXT, entry_key TEXT, value_json TEXT, created_at INTEGER)",
    );
    db.prepare("INSERT INTO plugin_state_entries VALUES (?, ?, ?, ?, 0)").run(
      "kazusa",
      "@retained.memory",
      "ann",
      JSON.stringify(STATES.ann),
    );
    db.prepare("INSERT INTO plugin_state_entries VALUES (?, ?, ?, ?, 0)").run(
      "kazusa",
      "@retained.tasks",
      "ann",
      "{}",
    );
    db.close();
    expect(readStates(world)).toEqual({ ann: STATES.ann });
  });
});
