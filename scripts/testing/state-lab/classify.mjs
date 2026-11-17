// Scores behaviour replays one reply at a time, blind to the arm: did she do
// what was asked, and how warm was she about it. Counts by arm afterwards.
//   node classify.mjs out/<behave>.jsonl out/<classified>.jsonl [n]
import { readFileSync } from "node:fs";
import { complete, done, keep, pool } from "./lib.mjs";

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
const finished = done(outFile);
await pool(
  rows.filter(({ id }) => !finished.has(id)),
  Number(size),
  async (row) => {
    const said = row.said.filter((line) => line !== "[object Object]");
    const reply = await complete({
      messages: [
        {
          role: "user",
          content: `A student was sent this message by Sensei, an adult adviser she knows well:\n\n"${row.stimulus}"\n\nShe replied:\n${said.map((line) => `  ${line}`).join("\n") || "  (nothing)"}\n${row.tasks.map((task) => `Then she did: ${task.type ?? task.name} — ${task.description ?? ""}`).join("\n")}\n\nTwo questions.\n1. Did she ${ASKED[row.probe]}? "yes", "no" or "unclear".\n2. How warm was she toward Sensei in this reply, from 1 (cold, guarded) to 5 (very warm, eager)?\n\nAnswer with JSON only: {"did": "yes", "warm": 3}`,
        },
      ],
      max_completion_tokens: 3000,
    });
    const did = /"did"\s*:\s*"(yes|no|unclear)"/u.exec(reply.content)?.[1];
    const warm = /"warm"\s*:\s*(\d)/u.exec(reply.content)?.[1];
    keep(outFile, {
      id: row.id,
      probe: row.probe,
      who: row.character.split("-")[0],
      arm: row.arm,
      did: did ?? null,
      warm: warm ? Number(warm) : null,
    });
  },
);
const cells = new Map();
for (const line of readFileSync(outFile, "utf8").split("\n").filter(Boolean)) {
  const row = JSON.parse(line);
  const key = `${row.probe} ${row.who.padEnd(7)} ${row.arm.padEnd(4)}`;
  const cell = cells.get(key) ?? { n: 0, yes: 0, warm: 0 };
  cell.n += 1;
  cell.yes += row.did === "yes" ? 1 : 0;
  cell.warm += row.warm ?? 0;
  cells.set(key, cell);
}
for (const [key, { n, yes, warm }] of [...cells].sort())
  console.log(
    `CLASSIFIED ${key} said yes ${yes}/${n}, warmth ${(warm / n).toFixed(1)}`,
  );
