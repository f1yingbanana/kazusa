#!/usr/bin/env node
/**
 * How sleep consolidation did over a stretch of real time: passes attempted,
 * applied, failed, interrupted and retried, why calls failed, and for each
 * applied night whether the important things happened (day page, notes, views,
 * a dream, MEMORY.md). Reads the outcomes each pass keeps in the world's state
 * database (`memory/sleep.ts`), read-only, so it is safe on a running world.
 *
 * Node scripts/sleep-report.mjs [--world apps/kazusa/world] [--since
 * 2026-11-12T01:00+11:00 | --hours 12] [--until <time>] [--json]
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Why a model call failed, in a few words. */
export function errorClass(error) {
  if (/No usable day/.test(error)) return "no day in the reply";
  if (/SyntaxError|No JSON|not a JSON object/.test(error))
    return "unreadable JSON";
  if (/TimeoutError|timed out/i.test(error)) return "timeout";
  if (
    /FailoverError|stop reason|rate.?limit|(HTTP|status) [45]\d\d/i.test(error)
  )
    return "provider error";
  // The Gateway was not ready to run the character's model yet.
  if (/prepared model runtime|plugin generation has retired/i.test(error))
    return "runtime not ready";
  return "other";
}

const count = (items, test) => items.filter(test).length;

/**
 * `states` maps a character to their sleep state as stored; returns every
 * outcome that ended in [since, until] with its run, and the totals.
 */
export function summarize(states, { since, until }) {
  const rows = [];
  for (const [agent, state] of Object.entries(states)) {
    const runs = new Map((state.runs ?? []).map((run) => [run.id, run]));
    for (const outcome of state.outcomes ?? []) {
      if (outcome.wallAt < since || outcome.wallAt > until) continue;
      const run = outcome.runId ? runs.get(outcome.runId) : undefined;
      const files = run ? Object.keys(run.postimages) : [];
      rows.push({
        agent,
        ...outcome,
        // From what this night left on disk, while its run is still kept.
        dayPage: run
          ? files.some((file) => file.startsWith("wiki/days/"))
          : undefined,
        memoryChanged: run
          ? run.preimages["MEMORY.md"] !== run.postimages["MEMORY.md"]
          : undefined,
      });
    }
  }
  rows.sort((a, b) => a.wallAt - b.wallAt);

  const passes = rows.filter(({ result }) => result !== "empty");
  const applied = rows.filter(({ result }) => result === "applied");
  const errors = {};
  for (const row of rows)
    for (const error of row.errors) {
      const kind = errorClass(error);
      errors[kind] = (errors[kind] ?? 0) + 1;
    }
  const total = (key) => applied.reduce((sum, row) => sum + (row[key] ?? 0), 0);
  return {
    rows,
    totals: {
      passes: passes.length,
      applied: applied.length,
      failed: count(rows, ({ result }) => result === "failed"),
      interrupted: count(rows, ({ result }) => result === "interrupted"),
      empty: count(rows, ({ result }) => result === "empty"),
      retried: count(passes, ({ attempts }) => attempts > 1),
      appliedAfterRetry: count(applied, ({ attempts }) => attempts > 1),
      readLeniently: count(applied, ({ repaired }) => repaired),
      withDrops: count(applied, ({ dropped }) => dropped?.length),
      failedCalls: errors,
    },
    applied: {
      dayPage: count(applied, ({ dayPage }) => dayPage),
      dayPageUnknown: count(applied, ({ dayPage }) => dayPage === undefined),
      withNotes: count(applied, ({ notes }) => notes > 0),
      withViews: count(applied, ({ views }) => views > 0),
      withNewPages: count(applied, ({ newPages }) => newPages > 0),
      withDream: count(applied, ({ dream }) => dream),
      withSelf: count(applied, ({ self }) => self),
      memoryChanged: count(applied, ({ memoryChanged }) => memoryChanged),
      notes: total("notes"),
      pages: total("pages"),
      views: total("views"),
      newPages: total("newPages"),
    },
  };
}

const share = (part, whole) =>
  whole ? `${part}/${whole} (${Math.round((100 * part) / whole)}%)` : "0";

export function format({ rows, totals, applied }, { since, until }) {
  const time = (ms) =>
    new Date(ms).toISOString().replace("T", " ").slice(0, 19);
  const n = totals.applied;
  const lines = [
    `Sleep from ${time(since)} to ${time(until)} UTC`,
    "",
    `Passes: ${totals.passes} (applied ${totals.applied}, failed ${totals.failed}, interrupted by a wake ${totals.interrupted}); ${totals.empty} more had nothing new`,
    `Retried: ${totals.retried} passes; ${totals.appliedAfterRetry} applied after a retry`,
    `Failed model calls: ${
      Object.entries(totals.failedCalls)
        .map(([kind, calls]) => `${kind} ${calls}`)
        .join(", ") || "none"
    }`,
    `Applied from a reply that was not strict JSON: ${totals.readLeniently}; with parts dropped: ${totals.withDrops}`,
    "",
    `Of ${n} applied nights:`,
    `  day page written   ${share(applied.dayPage, n)}${applied.dayPageUnknown ? ` (${applied.dayPageUnknown} runs no longer kept)` : ""}`,
    `  notes added        ${share(applied.withNotes, n)}, ${applied.notes} notes on ${applied.pages} pages`,
    `  views revised      ${share(applied.withViews, n)}, ${applied.views} views`,
    `  new pages          ${share(applied.withNewPages, n)}, ${applied.newPages} pages`,
    `  a dream            ${share(applied.withDream, n)}`,
    `  MEMORY.md changed  ${share(applied.memoryChanged, n)}`,
    "",
    "When (UTC)           Character                 Result       Tries Pages Notes Views Dream  Why",
  ];
  for (const row of rows) {
    if (row.result === "empty") continue;
    lines.push(
      [
        time(row.wallAt).padEnd(20),
        row.agent.padEnd(25),
        row.result.padEnd(12),
        String(row.attempts).padStart(5),
        String(row.pages ?? "").padStart(5),
        String(row.notes ?? "").padStart(5),
        String(row.views ?? "").padStart(5),
        (row.dream ? "yes" : row.result === "applied" ? "no" : "").padStart(5),
        " " +
          [
            ...new Set(row.errors.map(errorClass)),
            ...(row.repaired ? ["read leniently"] : []),
          ].join(", "),
      ].join(" "),
    );
  }
  return lines.join("\n");
}

/** Every character's sleep state, read-only. */
export function readStates(world) {
  const file = path.join(world, ".state", "state", "openclaw.sqlite");
  if (!existsSync(file)) throw new Error(`No state database at ${file}.`);
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const states = {};
    for (const { entry_key, value_json } of db
      .prepare(
        "SELECT entry_key, value_json FROM plugin_state_entries WHERE plugin_id = 'kazusa' AND namespace = '@retained.memory'",
      )
      .all())
      states[entry_key] = JSON.parse(value_json);
    return states;
  } finally {
    db.close();
  }
}

function main(argv) {
  const option = (name) => {
    const at = argv.indexOf(`--${name}`);
    return at >= 0 ? argv[at + 1] : undefined;
  };
  const world = path.resolve(
    option("world") ?? path.join(ROOT, "apps/kazusa/world"),
  );
  const until = option("until") ? Date.parse(option("until")) : Date.now();
  const since = option("since")
    ? Date.parse(option("since"))
    : until - Number(option("hours") ?? 24) * 3_600_000;
  if (Number.isNaN(since) || Number.isNaN(until))
    throw new Error("--since and --until take a date and time.");
  const summary = summarize(readStates(world), { since, until });
  console.log(
    argv.includes("--json")
      ? JSON.stringify(summary, null, 2)
      : format(summary, { since, until }),
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href)
  main(process.argv.slice(2));
