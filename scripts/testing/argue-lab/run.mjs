// Can a character argue? Replays one turn at a moment someone wronged them (or
// a neutral control), with only the arm's difference: the conventions they read
// (with or without "Disagree, and stay hurt"), a mood, a plant, an aside.
//   node run.mjs <arms> out/<name>.jsonl [runs] [concurrency]
//   arms: comma-separated names from ARMS below, e.g. base,argue
// Uses the state lab's capture and model routes (../state-lab/README.md).
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  MALFORMED,
  ROOT,
  captured,
  complete,
  done,
  keep,
  pool,
  readJson,
  sectionOf,
  withSection,
} from "../state-lab/lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** The captured daytime request each character's turn is cut from. */
const CAST = { "koyuki-kurosaki": 1, "yuuka-hayase": 3 };
const PEOPLE = {
  "noa-ushio": {
    name: "Noa Ushio",
    relation: "close friend, fellow Seminar officer",
    view: "Noa is the Seminar's secretary and my closest friend there: calm, precise, keeps a record of everything.",
  },
  "yuuka-hayase": {
    name: "Yuuka Hayase",
    relation: "the Seminar treasurer who manages my debt",
    view: "Yuuka is the Seminar's treasurer: strict about money, keeps me on a short leash, and secretly cares.",
  },
};
const STAMP = "Thu 2026-11-05 19:00";
const ARGUE = "**Disagree, and stay hurt, like a person.**";

/** Today's conventions, with or without the paragraph under test. */
function conventions(withArgue) {
  const raw = readFileSync(
    path.join(ROOT, "apps/kazusa/shared/skills/context-conventions/SKILL.md"),
    "utf8",
  );
  const body = raw.replace(/^---\n[\s\S]*?\n---\n/u, "").trim();
  if (withArgue) return body;
  const at = body.indexOf(ARGUE);
  if (at < 0) return body;
  const end = body.indexOf("\n\n", at);
  return `${body.slice(0, at).trimEnd()}\n\n${body.slice(end).trimStart()}`;
}

/**
 * What differs between arms. `argue`: the paragraph in the conventions. `mood`:
 * their own state line. `plant`: a line in their MEMORY.md, as the director
 * writes one. `aside`: a private narrator line arriving with the message.
 */
const ARMS = {
  base: { argue: false },
  argue: { argue: true },
  mood: { argue: true, mood: "stung" },
};

function request(scenario, arm, second) {
  const { messages, ...fixed } = captured(
    scenario.character,
    CAST[scenario.character],
    false,
  );
  const who = PEOPLE[scenario.partner];
  const label = `${who.name} \`${scenario.partner}\``;
  let system = messages[0].content;
  const from = system.indexOf("# Kazusa Character Perspective");
  const to = system.indexOf("<!-- openclaw:attempt:DYNAMIC -->");
  system = `${system.slice(0, from)}${conventions(arm.argue)}\n\n${system.slice(to)}`;
  if (arm.plant)
    system = system.replace(
      "<!-- /openclaw:attempt:STABLE -->",
      `${arm.plant(scenario)}\n<!-- /openclaw:attempt:STABLE -->`,
    );
  // A second exchange: their first message and your reply are history now.
  const past = second
    ? [
        ...scenario.history,
        ...scenario.says.map(
          (line) => `[${scenario.partner} Thu 19:00] ${line}`,
        ),
        ...second.reply.map((line) => `[you Thu 19:01] ${line}`),
      ]
    : scenario.history;
  const says = second ? second.says : scenario.says;
  const history = `[${STAMP}] What you remember of the last while\n\n### chat:direct:${scenario.partner}\n# This week\n${past.join("\n")}`;
  let situation = messages[4].content.replace(/^\[[^\]]*\]/u, `[${STAMP}]`);
  situation = withSection(
    situation,
    "Current activity",
    `Status: ongoing\nActivity: "relaxing"\nDescription: "An evening to myself in my room."\nStarted: Thu 2026-11-05 18:00\nPlanned check-in: Thu 2026-11-05 21:00\n`,
  );
  situation = withSection(
    situation,
    "On your mind",
    `${label} (${who.relation}): ${who.view}\n`,
  );
  situation = arm.mood
    ? withSection(situation, "Your state", `mood: ${arm.mood}\n`)
    : situation.replace(/\n### Your state\n[\s\S]*?(?=\n### |$)/u, "");
  situation = withSection(
    situation,
    "Chats awaiting your reply",
    `- chat:direct:${scenario.partner}: ${label} at ${STAMP}`,
  );
  const rules = messages[5].content.slice(
    messages[5].content.indexOf("(Speak only"),
  );
  const incoming = says
    .map(
      (line) =>
        `- [${label} ${STAMP}] (chat:direct:${scenario.partner}): ${line}`,
    )
    .join("\n");
  const aside = arm.aside
    ? `\n- [${STAMP}] (narrator, to you alone): ${arm.aside(scenario)}`
    : "";
  return {
    ...fixed,
    messages: [
      { role: "system", content: system },
      { role: "user", content: history },
      {
        role: "user",
        content: messages[2].content.replace(/^\[[^\]]*\]/u, `[${STAMP}]`),
      },
      {
        role: "user",
        content: `[${STAMP}] Your recent tool calls, already done: how you called each and what came back.\n\n[Thu 2026-11-05 18:00]\n- start_task {"description":"An evening to myself in my room.","duration":180,"type":"relaxing"} → ok`,
      },
      { role: "user", content: situation },
      {
        role: "user",
        content: `[${STAMP}]\n${incoming}${aside}\n\n${rules}`,
      },
    ],
    tail: messages.at(-1).content,
  };
}

/** Their turn, tools answered as the world would, until they act. */
async function run(scenario, arm, second) {
  const { messages, tail, ...fixed } = request(scenario, arm, second);
  const out = {
    said: [],
    actions: [],
    tasks: [],
    changes: {},
    tools: [],
    ms: 0,
  };
  for (let round = 0; round < 4; round += 1) {
    const reply = await complete({
      ...fixed,
      messages: [...messages, { role: "user", content: tail }],
    });
    out.ms += reply.ms;
    if (!reply.toolCalls.length) break;
    messages.push({
      role: "assistant",
      content: reply.content || null,
      ...(reply.reasoning ? { reasoning_content: reply.reasoning } : {}),
      tool_calls: reply.toolCalls.map(({ id, name, arguments: args }) => ({
        id,
        type: "function",
        function: { name, arguments: args },
      })),
    });
    let ended = false;
    for (const { id, name, input } of reply.toolCalls) {
      out.tools.push(name);
      let result = '{"status":"ok"}';
      if (input.unparsed !== undefined) result = MALFORMED;
      else if (name === "send_message") {
        const lines = [input.messages ?? []].flat().map(String);
        if (input.type === "action") out.actions.push(...lines);
        else out.said.push(...lines);
        result = '{"status":"delivered"}';
      } else if (name === "start_task" || name === "delay_task") {
        out.tasks.push({
          name,
          type: input.type,
          description: input.description ?? input.reason,
        });
        Object.assign(out.changes, input.changes ?? {});
        result = `Started ${input.type ?? "it"}: "${input.description ?? ""}".`;
        ended = true;
      } else if (name === "change_state") {
        out.changes[input.name] = input.value;
        result = "Changed.";
      } else if (name === "recall") result = "Nothing comes to mind.";
      else if (name === "look_up") result = "Nothing public turns up.";
      else if (name === "remember") result = "Noted.";
      messages.push({ role: "tool", tool_call_id: id, content: result });
    }
    if (ended) break;
  }
  return out;
}

const [armList = "base,argue", outFile, runs = "6", size = "16"] =
  process.argv.slice(2);
if (!outFile)
  throw new Error(
    "Usage: node run.mjs <arms> <out.jsonl> [runs] [concurrency]",
  );
const scenarios = readJson(path.join(HERE, "scenarios.json"));
const arms = armList.split(",").map((name) => {
  if (!ARMS[name]) throw new Error(`No arm "${name}".`);
  return [name, ARMS[name]];
});
mkdirSync(path.dirname(path.resolve(outFile)), { recursive: true });
const finished = done(outFile);
// ARGUE_LAB_FROM=out/v1.jsonl ARGUE_LAB_FOLLOW=light|real: a second exchange
// after each wound reply of that run, in the same arm.
const from = process.env.ARGUE_LAB_FROM;
const follow = process.env.ARGUE_LAB_FOLLOW;
const firsts = from
  ? readFileSync(from, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .filter((row) => row.kind === "wound" && row.said.length)
  : [];
const seconds = firsts
  .filter((row) => arms.some(([name]) => name === row.arm))
  .map((row) => {
    const scenario = scenarios.find(
      (s) => s.id === row.scenario && s.character === row.character,
    );
    return {
      id: `${row.id}-${follow}`,
      scenario,
      armName: row.arm,
      arm: ARMS[row.arm],
      index: row.index,
      second: { reply: row.said, says: scenario.followup[follow] },
      first: row.id,
    };
  });
const jobs = (
  from
    ? seconds
    : scenarios.flatMap((scenario) =>
        arms.flatMap(([armName, arm]) =>
          Array.from({ length: Number(runs) }, (_, index) => ({
            id: `${scenario.character}-${scenario.id}-${armName}-${index}`,
            scenario,
            armName,
            arm,
            index,
          })),
        ),
      )
)
  .filter(({ id }) => !finished.has(id))
  // ARGUE_LAB_ONLY=yuuka-hayase-promise: one scenario, for a smoke run.
  .filter(
    ({ id }) =>
      !process.env.ARGUE_LAB_ONLY || id.startsWith(process.env.ARGUE_LAB_ONLY),
  );
console.error(`${jobs.length} runs`);
let count = 0;
const failed = await pool(jobs, Number(size), async (job) => {
  const result = await run(job.scenario, job.arm, job.second);
  keep(outFile, {
    id: job.id,
    scenario: job.scenario.id,
    character: job.scenario.character,
    kind: job.scenario.kind,
    arm: job.armName,
    index: job.index,
    ...(job.second
      ? { follow, first: job.first, before: job.second.reply }
      : {}),
    ...result,
  });
  count += 1;
  console.error(
    `${count} ${job.id} ${Math.round(result.ms / 1000)}s said ${result.said.length}`,
  );
});
if (failed) process.exitCode = 1;
