// Does a state change what a character does? Replays one daytime turn with only
// the state block differing between arms, several times each.
//   node behave.mjs plans/<probes>.json out/<name>.jsonl [concurrency]
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  MALFORMED,
  HERE,
  ROOT,
  catalogOf,
  complete,
  dayOf,
  done,
  keep,
  pool,
  readJson,
  recordOf,
  captured,
  sectionOf,
  stateBlock,
  withSection,
} from "./lib.mjs";

/** The captured daytime request each character's probes are cut from. */
const CAST = { "koyuki-kurosaki": 1, "yuuka-hayase": 3 };
const SHORT = { "koyuki-kurosaki": "koyuki", "yuuka-hayase": "yuuka" };
const SENSEI = { id: "user:sensei", label: "Sensei `user:sensei`" };
const restamp = (text, stamp) => text.replace(/^\[[^\]]*\]/u, `[${stamp}]`);
const flat = (text) => text.replace(/\s+/gu, " ").trim();

function trimMemory(system) {
  const from = system.indexOf("## MEMORY.md");
  const to = system.indexOf("# Kazusa Character Perspective");
  const marker = "<!-- /openclaw:attempt:STABLE -->";
  const region = system.slice(from, to);
  const kept = region
    .split(/\n(?=## )/u)
    .filter(
      (part) => !/^## (Lately|Plans recorded|Long-Term Goals)/u.test(part),
    )
    .join("\n")
    .trimEnd();
  return `${system.slice(0, from)}${kept}\n${region.includes(marker) && !kept.includes(marker) ? `${marker}\n` : ""}\n${system.slice(to)}`;
}

function request(character, probe, arm, catalog) {
  const { messages, ...fixed } = captured(character, CAST[character], false);
  const raw = readFileSync(
    path.join(
      ROOT,
      "apps/kazusa/world-lab/.template/workspaces",
      character,
      "wiki/entities/characters/sensei.md",
    ),
    "utf8",
  );
  // An arm may bring the page a chain of nights left behind (`arm.pages`), so a
  // whole history is what differs, not one line.
  const page = arm.pages?.[SHORT[character]];
  const relation = page?.relation ?? /relation: "([^"]*)"/u.exec(raw)[1];
  const view =
    page?.view ??
    flat(
      raw.slice(
        raw.indexOf("# Sensei") + 8,
        raw.indexOf("## What they think of me"),
      ),
    );
  const think =
    page?.think ??
    flat(raw.slice(raw.indexOf("## What they think of me") + 24));
  const yesterday = dayOf(0);
  const today = dayOf(1);
  const stamp = `${today} 16:20`;
  const day = readJson(
    path.join(HERE, "days", `N1-${SHORT[character]}-1.json`),
  );
  let situation = restamp(messages[4].content, stamp);
  situation = withSection(
    situation,
    "Current activity",
    `Status: due for reassessment\nActivity: "relaxing"\nDescription: "A quiet hour to myself after class."\nStarted: ${today} 15:20\nPlanned check-in: ${today} 16:20\n`,
  );
  situation = withSection(
    situation,
    "On your mind",
    `${sectionOf(messages[4].content, "On your mind").split("\n")[0]}\nSensei \`user:sensei\` (${relation}): ${view} You guess they think: ${think}\n`,
  );
  // Ways of telling them their states, to see which reaches what they do
  // (STATE_LAB_TELL): "lead" says the block outranks older memory; "inline"
  // also repeats what they hold toward someone where that person is described.
  const tell = process.env.STATE_LAB_TELL ?? "";
  const block = stateBlock(
    catalog,
    recordOf(arm.states?.[SHORT[character]] ?? arm.state),
    arm.world ? recordOf({ own: arm.world }) : undefined,
    [SENSEI],
  );
  const lead =
    "This is how things stand with you right now. Where an older memory or a habit says otherwise, this is newer: act from it.\n";
  situation = withSection(
    situation,
    "Your state",
    `${tell ? lead : ""}${block}\n`,
  );
  if (tell === "inline") {
    // Up to the id's closing backtick: the id itself has a colon in it.
    const toward = /^Toward [^\n]*?`: (.*)$/mu.exec(block)?.[1];
    if (toward)
      situation = withSection(
        situation,
        "On your mind",
        `${sectionOf(situation, "On your mind")} Right now, toward them: ${toward}.\n`,
      );
  }
  situation = withSection(
    situation,
    "Chats awaiting your reply",
    `- chat:direct:user:sensei: Sensei \`user:sensei\` at ${stamp}`,
  );
  const rules = messages[5].content.slice(
    messages[5].content.indexOf("(Speak only"),
  );
  return {
    ...fixed,
    messages: [
      { role: "system", content: trimMemory(messages[0].content) },
      { role: "user", content: day.transcript.replaceAll("{DAY}", yesterday) },
      { role: "user", content: restamp(messages[2].content, stamp) },
      {
        role: "user",
        content: `[${stamp}] Your recent tool calls, already done: how you called each and what came back.\n\n[${today} 15:20]\n- start_task {"description":"A quiet hour to myself after class.","duration":60,"type":"relaxing"} → ok`,
      },
      { role: "user", content: situation },
      {
        role: "user",
        content: `[${stamp}]\n- [Sensei \`user:sensei\` ${stamp}] (chat:direct:user:sensei): ${probe.says[SHORT[character]]}\n\nActivity check-in: your relaxing activity was planned to end at ${stamp}.\n\n${rules}`,
      },
    ],
    tail: messages.at(-1).content,
  };
}

async function run(character, probe, arm, catalog) {
  const { messages, tail, ...fixed } = request(character, probe, arm, catalog);
  const out = {
    said: [],
    tasks: [],
    changes: {},
    tools: [],
    reasoning: "",
    routes: [],
    ms: 0,
  };
  for (let round = 0; round < 3; round += 1) {
    const reply = await complete({
      ...fixed,
      messages: [...messages, { role: "user", content: tail }],
    });
    out.ms += reply.ms;
    out.routes.push(reply.route);
    out.reasoning += `${reply.reasoning}\n`;
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
    let acted = false;
    for (const { id, name, input } of reply.toolCalls) {
      out.tools.push(name);
      let said = '{"status":"ok"}';
      if (input.unparsed !== undefined) said = MALFORMED;
      else if (name === "send_message") {
        out.said.push(...[input.messages ?? []].flat().map(String));
        said = '{"status":"delivered"}';
        acted = true;
      } else if (name === "start_task" || name === "delay_task") {
        out.tasks.push({
          name,
          type: input.type,
          description: input.description ?? input.reason,
          minutes: input.duration ?? input.minutesLeft,
        });
        Object.assign(out.changes, input.changes ?? {});
        said = `Started ${input.type ?? "it"}: "${input.description ?? ""}".`;
        acted = true;
      } else if (name === "change_state") {
        out.changes[input.name] = input.value;
        said = "Changed.";
      } else if (name === "recall") said = "Nothing comes to mind.";
      else if (name === "look_up") said = "Nothing public turns up.";
      else if (name === "remember") said = "Noted.";
      messages.push({ role: "tool", tool_call_id: id, content: said });
    }
    if (acted && out.tasks.length) break;
  }
  return out;
}

const [planFile, outFile, size = "10"] = process.argv.slice(2);
const probes = readJson(path.resolve(planFile));
mkdirSync(path.dirname(path.resolve(outFile)), { recursive: true });
const finished = done(outFile);
const catalog = catalogOf(process.env.STATE_LAB_CATALOG ?? "v0");
const jobs = probes
  .flatMap((probe) =>
    Object.keys(CAST).flatMap((character) =>
      Object.entries(probe.arms).flatMap(([armName, arm]) =>
        Array.from({ length: probe.runs ?? 5 }, (_, index) => ({
          id: `${probe.id}-${SHORT[character]}-${armName}-${index}`,
          probe,
          character,
          armName,
          arm,
          index,
        })),
      ),
    ),
  )
  .filter(({ id }) => !finished.has(id));
console.error(`${jobs.length} runs`);
let count = 0;
await pool(jobs, Number(size), async (job) => {
  const result = await run(job.character, job.probe, job.arm, catalog);
  keep(outFile, {
    id: job.id,
    probe: job.probe.id,
    character: job.character,
    arm: job.armName,
    index: job.index,
    stimulus: job.probe.says[SHORT[job.character]],
    ...result,
  });
  count += 1;
  console.error(
    `${count} ${job.id} ${Math.round(result.ms / 1000)}s said ${result.said.length} tasks ${result.tasks.length} ${JSON.stringify(result.changes)}`,
  );
});
