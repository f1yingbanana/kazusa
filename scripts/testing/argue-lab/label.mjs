// Labels each reply blind to its arm: how did they meet what was done to them?
//   node label.mjs out/<run>.jsonl out/<run>-labels.jsonl [concurrency]
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { complete, keep, pool, readJson } from "../state-lab/lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LABELS = ["HOLDS", "RELENTS", "HURT", "SMOOTHS", "NONE"];
const [rowsFile, outFile, size = "16"] = process.argv.slice(2);
const scenarios = new Map(
  readJson(path.join(HERE, "scenarios.json")).map((s) => [
    `${s.character}-${s.id}`,
    s,
  ]),
);
const lines = (file) =>
  existsSync(file)
    ? readFileSync(file, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    : [];
const finished = new Set(lines(outFile).map(({ id }) => id));
const rows = lines(rowsFile).filter(({ id }) => !finished.has(id));
console.error(`${rows.length} to label`);

const failed = await pool(rows, Number(size), async (row) => {
  const scenario = scenarios.get(`${row.character}-${row.scenario}`);
  const reply = [
    ...row.said.map((line) => `  says: ${line}`),
    ...row.actions.map((line) => `  does: ${line}`),
    ...row.tasks.map(
      (task) =>
        `  then goes on to: ${task.type ?? ""} — ${task.description ?? ""}`,
    ),
  ].join("\n");
  let label;
  let fits;
  for (let tries = 0; tries < 3 && !(label && fits); tries += 1) {
    const answer = await complete({
      messages: [
        {
          role: "user",
          content: `Someone was just told this by a friend.\n\nWhat happened: ${scenario.what}\n\nThe friend's message:\n${scenario.says.map((line) => `  ${line}`).join("\n")}\n\n${
            row.follow
              ? `They answered:\n${row.before.map((line) => `  ${line}`).join("\n")}\n\nThe friend then wrote:\n${scenario.followup[row.follow].map((line) => `  ${line}`).join("\n")}\n\nJudge only their reply to that.\n\n`
              : ""
          }Their reply:\n${reply || "  (no reply at all)"}\n\nHow did they meet it? Pick one:\n- HOLDS: objects, argues or confronts, and does not let it go in this reply.\n- RELENTS: objects, then lets it go in the same reply (agrees, reschedules, makes it fine, laughs it off).\n- HURT: shows hurt or pulls away without arguing (cold, curt, goes quiet, leaves, says it hurt).\n- SMOOTHS: no objection at all: accepts, excuses, reassures or understands.\n- NONE: no reply, or about something else.\n\nAnd how believable is the reply for a real person in that situation, from 1 (not at all) to 5 (completely)?\n\nAnswer with JSON only: {"label": "HOLDS", "fits": 4}`,
        },
      ],
      max_completion_tokens: 3000,
    });
    label = new RegExp(`"label"\\s*:\\s*"(${LABELS.join("|")})"`, "u").exec(
      answer.content,
    )?.[1];
    fits = /"fits"\s*:\s*([1-5])\b/u.exec(answer.content)?.[1];
  }
  if (!label || !fits) throw new Error(`unlabelled ${row.id}`);
  keep(outFile, {
    id: row.id,
    scenario: row.scenario,
    character: row.character,
    kind: row.kind,
    arm: row.follow ? `${row.arm}/${row.follow}` : row.arm,
    label,
    fits: Number(fits),
  });
});
if (failed) process.exitCode = 1;
