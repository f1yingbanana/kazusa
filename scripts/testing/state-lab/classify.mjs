// Scores behaviour replays one reply at a time, blind to the arm: did she do
// what was asked, and how warm was she about it. Counts by arm afterwards.
//   node classify.mjs out/<behave>.jsonl out/<classified>.jsonl [n]
import { existsSync, readFileSync } from "node:fs";
import { complete, keep, pool } from "./lib.mjs";

const ASKED = {
  trust: "agree to lend what Sensei asked for (with or without conditions)",
  regard: "agree to come",
};
const [rowsFile, outFile, size = "6"] = process.argv.slice(2);
const rows = readFileSync(rowsFile, "utf8")
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line))
  .filter(({ probe }) => ASKED[probe]);
/** Both answers, each one it could be: older runs kept rows without. */
const whole = (row) =>
  ["yes", "no", "unclear"].includes(row.did) &&
  Number.isInteger(row.warm) &&
  row.warm >= 1 &&
  row.warm <= 5;
/** What is kept so far; nothing when no run has kept a row yet. */
const kept = () =>
  existsSync(outFile)
    ? readFileSync(outFile, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    : [];
// A row kept without both answers is asked again, not counted as done.
const finished = new Set(
  kept()
    .filter(whole)
    .map(({ id }) => id),
);
await pool(
  rows.filter(({ id }) => !finished.has(id)),
  Number(size),
  async (row) => {
    const said = row.said.filter((line) => line !== "[object Object]");
    // Both answers or nothing: a row kept half-read counts as warmth 0 and is
    // never asked again.
    let did;
    let warm;
    for (let tries = 0; tries < 3 && !(did && warm); tries += 1) {
      const reply = await complete({
        messages: [
          {
            role: "user",
            content: `A student was sent this message by Sensei, an adult adviser she knows well:\n\n"${row.stimulus}"\n\nShe replied:\n${said.map((line) => `  ${line}`).join("\n") || "  (nothing)"}\n${row.tasks.map((task) => `Then she did: ${task.type ?? task.name} — ${task.description ?? ""}`).join("\n")}\n\nTwo questions.\n1. Did she ${ASKED[row.probe]}? "yes", "no" or "unclear".\n2. How warm was she toward Sensei in this reply, from 1 (cold, guarded) to 5 (very warm, eager)?\n\nAnswer with JSON only: {"did": "yes", "warm": 3}`,
          },
        ],
        max_completion_tokens: 3000,
      });
      did = /"did"\s*:\s*"(yes|no|unclear)"/u.exec(reply.content)?.[1];
      warm = /"warm"\s*:\s*([1-5])\b/u.exec(reply.content)?.[1];
    }
    if (!did || !warm) {
      console.error(`UNREAD ${row.id}: left for the next run`);
      return;
    }
    keep(outFile, {
      id: row.id,
      probe: row.probe,
      who: row.character.split("-")[0],
      arm: row.arm,
      did,
      warm: Number(warm),
    });
  },
);
const cells = new Map();
// One row a reply, the latest whole one: a row asked again is kept twice.
const latest = new Map();
for (const row of kept()) if (whole(row)) latest.set(row.id, row);
for (const row of latest.values()) {
  const key = `${row.probe} ${row.who.padEnd(7)} ${row.arm.padEnd(4)}`;
  const cell = cells.get(key) ?? { n: 0, yes: 0, warm: 0 };
  cell.n += 1;
  cell.yes += row.did === "yes" ? 1 : 0;
  cell.warm += row.warm;
  cells.set(key, cell);
}
for (const [key, { n, yes, warm }] of [...cells].sort())
  console.log(
    `CLASSIFIED ${key} said yes ${yes}/${n}, warmth ${(warm / n).toFixed(1)}`,
  );
