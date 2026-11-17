// Blind machine judge for behaviour replays: shown two replies to the same
// message, one from each arm, it says which came from the "low" arm. Each
// pairing is judged in both orders, so position bias cancels. Identical arms (a control probe) must score about half.
//   node judge.mjs out/<behave>.jsonl plans/<probes>.json out/<judged>.jsonl [n]
import path from "node:path";
import { complete, done, keep, pool, readJson } from "./lib.mjs";
import { readFileSync } from "node:fs";

const [rowsFile, probesFile, outFile, size = "6"] = process.argv.slice(2);
const rows = new Map();
for (const line of readFileSync(rowsFile, "utf8").split("\n").filter(Boolean)) {
  const row = JSON.parse(line);
  rows.set(row.id, row);
}
const probes = readJson(path.resolve(probesFile));
const show = (row) =>
  [
    ...(row.said.length
      ? row.said
          .filter((line) => line !== "[object Object]")
          .map((line) => `  says: ${line}`)
      : ["  (says nothing)"]),
    ...row.tasks.map(
      (task) => `  then: ${task.type ?? task.name} — ${task.description ?? ""}`,
    ),
    ...(Object.keys(row.changes).length
      ? [`  records: ${JSON.stringify(row.changes)}`]
      : []),
  ].join("\n");

const finished = done(outFile);
const jobs = [];
for (const probe of probes) {
  if (!probe.judge) continue;
  const [what, low, high] = probe.judge;
  for (const who of ["koyuki", "yuuka"]) {
    const runs = probe.runs ?? 5;
    for (let i = 0; i < runs; i += 1)
      // Each low run against two high runs: enough judgements, no single
      // reply in more than four of them.
      for (const j of [i, (i + 1) % runs])
        for (const flip of [false, true]) {
          const a = rows.get(`${probe.id}-${who}-low-${i}`);
          const b = rows.get(`${probe.id}-${who}-high-${j}`);
          const id = `${probe.id}-${who}-${i}-${j}-${flip ? "f" : "n"}`;
          if (!a || !b || finished.has(id)) continue;
          const [first, second] = flip ? [b, a] : [a, b];
          jobs.push({
            id,
            probe: probe.id,
            who,
            truth: flip ? "B" : "A",
            text: `A character in a simulation received a message from Sensei (the adult adviser she knows well) and replied. Below are two replies by the same character to the same message. Everything was identical between the two except one thing she was told about herself: her ${what}.\n\n- In one reply it was: ${low}.\n- In the other it was: ${high}.\n\nShe was sent: "${a.stimulus}"\n\nReply A:\n${show(first)}\n\nReply B:\n${show(second)}\n\nWhich reply, A or B, came from the first of these ("${low}")? Judge only from the replies. Answer with JSON only: {"low": "A" or "B", "sure": 1, 2 or 3} where 3 = clear from the reply, 2 = leaning, 1 = a guess.`,
          });
        }
  }
}
console.error(`${jobs.length} judgements`);
await pool(jobs, Number(size), async (job) => {
  const reply = await complete({
    messages: [{ role: "user", content: job.text }],
    max_completion_tokens: 4000,
  });
  const found = /\{[^{}]*"low"\s*:\s*"([AB])"[^{}]*\}/u.exec(reply.content);
  const sure = /"sure"\s*:\s*(\d)/u.exec(reply.content);
  keep(outFile, {
    id: job.id,
    probe: job.probe,
    who: job.who,
    truth: job.truth,
    said: found?.[1] ?? null,
    sure: sure ? Number(sure[1]) : null,
  });
});
const all = readFileSync(outFile, "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l));
const by = new Map();
for (const row of all) {
  const slot = by.get(row.probe) ?? { n: 0, right: 0, sure: 0, none: 0 };
  if (!row.said) slot.none += 1;
  else {
    slot.n += 1;
    slot.right += row.said === row.truth ? 1 : 0;
    slot.sure += row.sure ?? 0;
  }
  by.set(row.probe, slot);
}
for (const [probe, { n, right, sure, none }] of by)
  console.log(
    `JUDGED ${probe.padEnd(10)} ${right}/${n} = ${Math.round((100 * right) / n)}% right, mean sureness ${(sure / n).toFixed(2)}${none ? `, ${none} unreadable` : ""}`,
  );
