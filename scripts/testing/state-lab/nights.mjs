// Replays bedtime: one model run per night, on a written day, with the states
// applied by the plugin's own code. A chain carries states and the page on the
// other person from night to night, so weeks pass in minutes.
//   node nights.mjs plans/<plan>.json out/<name>.jsonl [concurrency]
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import {
  MALFORMED,
  HERE,
  ROOT,
  applyReview,
  catalogOf,
  complete,
  dayOf,
  done,
  keep,
  plainOf,
  pool,
  readJson,
  recordOf,
  captured,
  reviewBlock,
  sectionOf,
  stateBlock,
  withSection,
} from "./lib.mjs";

/** The captured bedtime request each character's replays are cut from. */
const CAST = { "koyuki-kurosaki": 192, "yuuka-hayase": 199 };
const SENSEI = { id: "user:sensei", label: "Sensei `user:sensei`" };
const TODAY = new Set(["today", "the day", "day", "my day", "tonight"]);
const PAGES = "What you remember of the people, places and things of the day:";

const restamp = (text, stamp) => text.replace(/^\[[^\]]*\]/u, `[${stamp}]`);

/** MEMORY.md without what the captured week left in it. */
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

const templates = new Map();
function template(character) {
  if (templates.has(character)) return templates.get(character);
  const body = captured(character, CAST[character], true);
  const { messages, ...fixed } = body;
  const aside = messages.find(
    ({ role, content }) =>
      role === "tool" && content.includes("Before sleep takes you"),
  ).content;
  const home = aside
    .slice(aside.indexOf(PAGES))
    .split(/\n(?=### )/u)[1]
    .trim();
  const v0 = path.join(HERE, "prompts/v0.md");
  if (!existsSync(v0)) {
    // Whole or not at all: other runners started beside this one read it.
    const fresh = `${v0}.${process.pid}.tmp`;
    writeFileSync(
      fresh,
      `${aside.slice(aside.indexOf("Before sleep takes you"), aside.indexOf("\n\nspirits: How you have"))}\n\n{states}\n`,
    );
    renameSync(fresh, v0);
  }
  const raw = readFileSync(
    path.join(
      ROOT,
      "apps/kazusa/world-lab/.template/workspaces",
      character,
      "wiki/entities/characters/sensei.md",
    ),
    "utf8",
  );
  const flat = (text) => text.replace(/\s+/gu, " ").trim();
  const made = {
    fixed,
    system: trimMemory(messages[0].content),
    frame: messages[2].content,
    situation: messages[4].content,
    tail: messages.at(-1).role === "user" ? messages.at(-1).content : " ",
    home,
    homeName: /name: "?([^"\n]+)"?/u.exec(home)?.[1] ?? "home",
    page: {
      summary: flat(/summary:\s*"([\s\S]*?)"\nrelation/u.exec(raw)[1]),
      relation: /relation: "([^"]*)"/u.exec(raw)[1],
      view: flat(
        raw.slice(
          raw.indexOf("# Sensei") + 8,
          raw.indexOf("## What they think of me"),
        ),
      ),
      think: flat(raw.slice(raw.indexOf("## What they think of me") + 24)),
      notes: [],
    },
  };
  templates.set(character, made);
  return made;
}

/**
 * The bedtime instructions of a variant. `skill` is what the plugin says today:
 * the captured instructions with the `states` section of the skill as it now
 * stands, so an edit to the skill is under test as soon as it is saved.
 */
function bedtime(name) {
  if (name !== "skill")
    return readFileSync(
      path.join(HERE, "prompts", `${name}.md`),
      "utf8",
    ).trimEnd();
  const first = readFileSync(path.join(HERE, "prompts/v0.md"), "utf8");
  const skill = readFileSync(
    path.join(ROOT, "apps/kazusa/shared/skills/sleep-consolidation/SKILL.md"),
    "utf8",
  );
  const from = skill.indexOf("## states\n") + 10;
  const next = skill.indexOf("\n## ", from);
  return `${first.slice(0, first.indexOf("This world keeps these about you."))}${skill.slice(from, next < 0 ? undefined : next).trim()}`;
}

const pageText = ({ summary, relation, view, think, notes }) =>
  [
    "### sensei",
    "---",
    'name: "Sensei"',
    'aliases: ["Sensei"]',
    "peer_id: user:sensei",
    `summary: ${JSON.stringify(summary)}`,
    `relation: ${JSON.stringify(relation)}`,
    "learned: always known",
    "---",
    "",
    "# Sensei",
    "",
    view,
    "",
    "## What they think of me",
    "",
    think,
    ...(notes.length ? ["", "## Notes", "", ...notes] : []),
  ].join("\n");

/** One night: the request as the Gateway would send it, then the model's run. */
async function night({ character, day, offset, record, page, variant }) {
  const base = template(character);
  const catalog = catalogOf(variant.catalog);
  const prompt = bedtime(variant.prompt ?? "v0");
  const date = dayOf(offset);
  const iso = date.slice(4);
  const stamp = `${date} 23:40`;
  const wake = `${dayOf(offset + 1)} 06:40`;
  const at = Date.parse(`${iso}T23:40:00Z`);
  const people = [SENSEI];

  let situation = restamp(base.situation, stamp);
  situation = withSection(
    situation,
    "Current activity",
    `Status: ongoing\nActivity: "sleeping"\nDescription: "Lights out. Sleep until morning."\nStarted: ${stamp}\nPlanned check-in: ${wake}\n`,
  );
  situation = withSection(
    situation,
    "On your mind",
    `${sectionOf(base.situation, "On your mind").split("\n")[0]}\nSensei \`user:sensei\` (${page.relation}): ${page.view} You guess they think: ${page.think}\n`,
  );
  situation = withSection(
    situation,
    "Your state",
    `${stateBlock(catalog, record, undefined, people)}\n`,
  );
  const chats = situation.indexOf("### Chats awaiting your reply");
  if (chats >= 0) situation = situation.slice(0, chats).trimEnd();

  const aside = [
    `Finished working: "Wound down for the night.". Started sleeping: "Lights out. Sleep until morning.". At ${base.homeName}. Until ${wake} (420 min).`,
    prompt.replace("{states}", reviewBlock(catalog, record, people)),
    PAGES,
    base.home,
    pageText(page),
  ].join("\n\n");

  const tools = variant.statesHint
    ? structuredClone(base.fixed.tools).map((tool) => {
        if (tool.function.name === "reflect")
          tool.function.parameters.properties.states.description =
            variant.statesHint;
        return tool;
      })
    : base.fixed.tools;
  const messages = [
    { role: "system", content: base.system },
    { role: "user", content: day.transcript.replaceAll("{DAY}", date) },
    { role: "user", content: restamp(base.frame, stamp) },
    {
      role: "user",
      content: `[${stamp}] Your recent tool calls, already done: how you called each and what came back.\n\n[${date} 21:10]\n- send_message {"messages":"1 (text)","sessionKey":"chat:direct:user:sensei"} → ok`,
    },
    { role: "user", content: situation },
    {
      role: "user",
      content: `[${stamp}]\nActivity check-in: no scheduled activity.`,
    },
    {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "call_sleep",
          type: "function",
          function: {
            name: "start_task",
            arguments: JSON.stringify({
              afterwards: { energy: "low→full" },
              changes: {},
              description: "Lights out. Sleep until morning.",
              duration: 420,
              monologue: "Long day. Bed.",
              summary: "Wound down for the night.",
              type: "sleeping",
            }),
          },
        },
      ],
    },
    { role: "tool", tool_call_id: "call_sleep", content: aside },
  ];

  const out = {
    asked: [],
    changes: [],
    calls: [],
    stray: [],
    reasoning: "",
    routes: [],
    ms: 0,
    rounds: 0,
    dayKept: false,
  };
  let next = record;
  let nextPage = { ...page, notes: [...page.notes] };
  // Until the model stops calling, as live: writing the day down ends nothing,
  // and what is gone over after it still counts.
  for (; out.rounds < 6; out.rounds += 1) {
    const reply = await complete({
      ...base.fixed,
      tools,
      messages: [...messages, { role: "user", content: base.tail }],
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
    for (const { id, name, input } of reply.toolCalls) {
      const about = String(input.about ?? "").trim();
      const key = about.toLowerCase();
      const sensei = /sensei/u.test(key);
      let said;
      if (input.unparsed !== undefined) said = MALFORMED;
      else if (name === "remember") {
        if (input.on) said = "Noted in your plans.";
        else {
          if (sensei)
            nextPage.notes.unshift(
              `- ${iso} · ${input.source ?? "seen it"} · ${input.certainty ?? "sure"} — ${input.note}`,
            );
          said = `Noted, about ${sensei ? "Sensei" : about}.`;
        }
      } else if (name === "reflect") {
        if (TODAY.has(key) || /^\d{4}-\d{2}-\d{2}$/u.test(key)) {
          out.dayKept = true;
          said = "The day is kept.";
        } else {
          const self = key === "me" || key === "myself";
          const answer = input.states
            ? self
              ? { own: input.states }
              : { toward: { [sensei ? SENSEI.id : key]: input.states } }
            : undefined;
          let fed = "";
          if (answer) {
            out.asked.push({ about, states: input.states });
            const review = applyReview(catalog, next, answer, [SENSEI.id], at);
            next = review.record;
            fed = review.said;
            out.changes.push(...review.changes);
          }
          if (sensei) {
            if (input.view) nextPage.view = input.view;
            if (input.summary) nextPage.summary = input.summary;
            if (input.relation) nextPage.relation = input.relation;
            if (input.theyThinkOfMe) nextPage.think = input.theyThinkOfMe;
          }
          said = `${self ? "Kept." : `Kept, about ${sensei ? "Sensei" : about}.`}${fed}`;
        }
      } else {
        out.stray.push(name);
        said = "You are falling asleep.";
      }
      out.calls.push({
        name,
        about,
        ...(input.states ? { states: input.states } : {}),
        ...(name === "reflect" && sensei
          ? { view: input.view, relation: input.relation }
          : {}),
        ...(name === "remember" ? { note: input.note } : {}),
      });
      messages.push({ role: "tool", tool_call_id: id, content: said });
    }
  }
  return { ...out, record: next, page: nextPage };
}

const [planFile, outFile, size = "10"] = process.argv.slice(2);
const plan = readJson(path.resolve(planFile));
mkdirSync(path.dirname(path.resolve(outFile)), { recursive: true });
const finished = done(outFile);
const days = (id) => readJson(path.join(HERE, "days", `${id}.json`));
const chains = plan.filter(
  ({ id, days: list }) => !finished.has(`${id}#${list.length - 1}`),
);
/** Where each chain got to: a run that was cut short carries on from there. */
const reached = new Map();
if (existsSync(outFile))
  for (const line of readFileSync(outFile, "utf8")
    .split("\n")
    .filter(Boolean)) {
    const row = JSON.parse(line);
    if (row.page) reached.set(row.id, row);
  }
console.error(`${chains.length} of ${plan.length} chains to run`);
let count = 0;
await pool(chains, Number(size), async (chain) => {
  let record = recordOf(chain.start);
  let page = template(chain.character).page;
  let from = 0;
  while (reached.has(`${chain.id}#${from}`)) {
    const row = reached.get(`${chain.id}#${from}`);
    record = recordOf(row.after);
    page = row.page;
    from += 1;
  }
  for (let index = from; index < chain.days.length; index += 1) {
    const day = days(chain.days[index]);
    const before = plainOf(record);
    const result = await night({
      character: chain.character,
      day,
      offset: index,
      record,
      page,
      variant: chain.variant ?? {},
    });
    ({ record, page } = result);
    keep(outFile, {
      id: `${chain.id}#${index}`,
      chain: chain.id,
      night: index,
      character: chain.character,
      day: day.id,
      type: day.type,
      variant: chain.variant ?? {},
      before,
      after: plainOf(record),
      asked: result.asked,
      changes: result.changes,
      calls: result.calls,
      stray: result.stray,
      rounds: result.rounds,
      dayKept: result.dayKept,
      ms: result.ms,
      routes: result.routes,
      view: page.view,
      page,
      reasoning: result.reasoning,
    });
    count += 1;
    console.error(
      `${count} ${chain.id}#${index} ${day.id} ${Math.round(result.ms / 1000)}s → ${JSON.stringify(result.changes)}`,
    );
  }
});
