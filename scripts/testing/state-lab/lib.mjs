// Shared pieces of the state lab: the model call, the captured prompts, and the
// plugin's own state functions, so a replay moves states exactly as a night does.
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { StatCatalogSchema, statStanding } from "@kazusa/client";
import {
  entry,
  reviewText,
  reviewedChanges,
  statsText,
  withEntry,
} from "../../../apps/kazusa/plugins/kazusa/src/stats/stats.ts";

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, "../../..");
const LAB = path.join(ROOT, "apps/kazusa/world-lab");
process.env.OPENCLAW_STATE_DIR ??= path.join(LAB, ".state");
process.env.OPENCLAW_CONFIG_PATH ??= path.join(LAB, "openclaw.json");

/**
 * Routes to the lab's model. All three end at the same upstream (Z.AI); more
 * than one is used only because each serves a few streams at a time.
 */
const ROUTES = [
  {
    id: "openrp",
    url: "https://openrp.ai/api/v1/chat/completions",
    model: "zai/glm-5.3-flash",
    limit: Number(process.env.STATE_LAB_OPENRP ?? 8),
  },
  {
    id: "openrouter",
    url: "https://openrouter.ai/api/v1/chat/completions",
    model: "z-ai/glm-5.3-flash",
    limit: Number(process.env.STATE_LAB_OPENROUTER ?? 40),
  },
].map((route) => ({ ...route, busy: 0, key: undefined }));
async function keyOf(route) {
  if (route.key) return route.key;
  const { resolveApiKeyForProvider } =
    await import("openclaw/plugin-sdk/agent-runtime");
  const found = await resolveApiKeyForProvider({ provider: route.id });
  if (!found?.apiKey)
    throw new Error(`No ${route.id} key in the lab's auth store.`);
  route.key = found.apiKey;
  return route.key;
}
const only = process.env.STATE_LAB_ROUTE;
/** The least loaded route, relative to what it can serve. */
const pick = () =>
  ROUTES.filter(({ id }) => !only || id === only).reduce((best, route) =>
    route.busy / route.limit < best.busy / best.limit ? route : best,
  );

/**
 * The request as each route needs it. OpenRP passes `reasoning_effort` on and
 * the model thinks at full depth whatever it says; OpenRouter honours an
 * effort, so there it is the test's condition: "high" thinks about as long as
 * the lab's own route does, "low" a few hundred tokens.
 */
function shaped(route, body) {
  if (route.id !== "openrouter")
    return { ...body, model: route.model, stream: true };
  const { reasoning_effort: _dropped, ...rest } = body;
  return {
    ...rest,
    model: route.model,
    stream: true,
    reasoning: { effort: process.env.STATE_LAB_EFFORT ?? "high" },
  };
}

/** One streamed chat completion: text, reasoning, tool calls and usage. */
export async function complete(body, { tries = 10, timeoutMs = 900_000 } = {}) {
  const started = Date.now();
  for (let attempt = 1; ; attempt += 1) {
    const route = pick();
    route.busy += 1;
    try {
      const response = await fetch(route.url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${await keyOf(route)}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(shaped(route, body)),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok)
        throw new Error(
          `HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`,
        );
      const out = {
        content: "",
        reasoning: "",
        toolCalls: [],
        usage: undefined,
        route: route.id,
      };
      const decoder = new TextDecoder();
      let buffer = "";
      // A stream can close with a 200 and nothing, or half a reply: only one
      // that said it was finished is a completion.
      let finished = false;
      for await (const chunk of response.body) {
        buffer += decoder.decode(chunk, { stream: true });
        let at;
        while ((at = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, at).trim();
          buffer = buffer.slice(at + 1);
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (data === "[DONE]") finished = true;
          if (!data || data === "[DONE]") continue;
          let event;
          try {
            event = JSON.parse(data);
          } catch {
            continue;
          }
          if (event.error) throw new Error(JSON.stringify(event.error));
          if (event.usage) out.usage = event.usage;
          if (event.choices?.[0]?.finish_reason) finished = true;
          const delta = event.choices?.[0]?.delta;
          if (!delta) continue;
          if (delta.content) out.content += delta.content;
          const thought = delta.reasoning_content ?? delta.reasoning;
          if (typeof thought === "string") out.reasoning += thought;
          for (const call of delta.tool_calls ?? []) {
            const slot = (out.toolCalls[call.index ?? 0] ??= {
              id: "",
              name: "",
              arguments: "",
            });
            if (call.id) slot.id = call.id;
            if (call.function?.name) slot.name += call.function.name;
            if (call.function?.arguments)
              slot.arguments += call.function.arguments;
          }
        }
      }
      if (!finished)
        throw new Error("the stream ended before the completion finished");
      out.toolCalls = out.toolCalls.filter(Boolean).map((call, index) => {
        let input = {};
        try {
          input = JSON.parse(call.arguments || "{}");
        } catch {
          input = { unparsed: call.arguments };
        }
        return { ...call, id: call.id || `call_${index}`, input };
      });
      out.ms = Date.now() - started;
      return out;
    } catch (error) {
      if (attempt >= tries)
        throw new Error(
          `${String(error)} ${error?.cause?.code ?? error?.cause?.message ?? ""}`,
        );
      // A dropped network takes a while to come back: wait longer each time.
      await new Promise((r) =>
        setTimeout(r, 10_000 * attempt + Math.random() * 5000),
      );
    } finally {
      route.busy -= 1;
    }
  }
}

/**
 * Runs jobs a few at a time; one failing never stops the rest. Returns how many
 * failed, and makes the process exit non-zero when any did, after whatever the
 * runner still prints: rows already kept stay for the next run.
 */
export async function pool(jobs, size, each) {
  let next = 0;
  let failed = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, jobs.length) }, async () => {
      while (next < jobs.length) {
        const job = jobs[next++];
        try {
          await each(job);
        } catch (error) {
          failed += 1;
          console.error(`! ${job.id ?? ""}: ${String(error).slice(0, 300)}`);
        }
      }
    }),
  );
  if (failed) {
    console.error(`! ${failed} of ${jobs.length} jobs failed`);
    process.exitCode = 1;
  }
  return failed;
}

export const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
export const done = (file) =>
  new Set(
    existsSync(file)
      ? readFileSync(file, "utf8")
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line).id)
      : [],
  );
export const keep = (file, row) =>
  appendFileSync(file, `${JSON.stringify(row)}\n`);

const CAPTURE = path.join(HERE, "corpus/lab-2026-11-17.jsonl");
let corpus;
/** Every chat request the lab Gateway sent, exactly as sent. */
export function requests() {
  if (!existsSync(CAPTURE))
    throw new Error(
      `No capture at ${CAPTURE}: it is not in the repository. See "The capture" in README.md.`,
    );
  corpus ??= readFileSync(CAPTURE, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter(({ url }) => url.includes("chat/completions"))
    .map(({ body }) => body);
  return corpus;
}

/**
 * The captured request a character's replays are cut from, checked to be that
 * turn: a capture of your own has it at another place.
 */
export function captured(character, index, bedtime) {
  const body = requests()[index];
  const system = JSON.stringify(body?.messages?.[0] ?? "");
  const inBed = JSON.stringify(body ?? "").includes("Before sleep takes you");
  if (!system.includes(character) || inBed !== bedtime)
    throw new Error(
      `Request ${index} of the capture is not ${character}'s ${bedtime ? "bedtime" : "daytime"} turn. Set CAST to where it is in yours ("The capture" in README.md).`,
    );
  return body;
}

export const catalogOf = (name = "v0") =>
  StatCatalogSchema.parse(
    readJson(path.join(HERE, "catalogs", `${name}.json`)),
  );

/**
 * A record from plain values: `{ own: {spirits: "steady"}, toward: {id: {trust:
 * 4}} }`.
 */
export function recordOf(plain = {}, at = 0) {
  let record = { own: {}, toward: {} };
  for (const [name, value] of Object.entries(plain.own ?? {}))
    record = withEntry(record, { name }, entry(value, at, "system"));
  for (const [toward, values] of Object.entries(plain.toward ?? {}))
    for (const [name, value] of Object.entries(values))
      record = withEntry(record, { name, toward }, entry(value, at, "system"));
  return record;
}

export const plainOf = (record) => ({
  own: Object.fromEntries(
    Object.entries(record.own).map(([name, { value }]) => [name, value]),
  ),
  toward: Object.fromEntries(
    Object.entries(record.toward).map(([id, values]) => [
      id,
      Object.fromEntries(
        Object.entries(values).map(([name, { value }]) => [name, value]),
      ),
    ]),
  ),
});

/** The `### Your state` block, as the context engine writes it. */
export const stateBlock = (catalog, record, world, toward) =>
  statsText({ catalog, record, world, toward, present: [] }) ?? "";

/** What a night shows of the states it reviews. */
export const reviewBlock = (catalog, record, people) =>
  reviewText(catalog, record, people) ?? "";

/**
 * What `reflect`'s `states` come to, as the plugin applies them
 * (`stats.review.apply`): the record after, what moved, and what it says back.
 */
export function applyReview(catalog, record, answer, people, at) {
  const changes = reviewedChanges(
    catalog,
    record,
    answer,
    [...new Set(people)].map((id) => ({ id })),
  );
  let next = record;
  for (const { stat, value, toward } of changes)
    next = withEntry(
      next,
      { name: stat.name, ...(toward ? { toward } : {}) },
      entry(value, at, "reviewed"),
    );
  const given = (values) =>
    values && typeof values === "object" ? Object.keys(values) : [];
  const names = new Set([
    ...given(answer?.own),
    ...Object.values(answer?.toward ?? {}).flatMap(given),
  ]);
  const movedNames = new Set(changes.map(({ stat }) => stat.name));
  const moved = changes.map(
    ({ stat, value }) => `${stat.name}: ${statStanding(stat, value)}`,
  );
  const left = [...names].filter((name) => !movedNames.has(name));
  const said = [
    ...(moved.length ? [` Now ${moved.join(", ")}.`] : []),
    ...(left.length ? [` Left as they were: ${left.join(", ")}.`] : []),
  ].join("");
  return {
    record: next,
    said,
    changes: changes.map(({ stat, value, toward }) => ({
      name: stat.name,
      ...(toward ? { toward } : {}),
      value,
    })),
  };
}

/** Replaces one `### Heading` section of a context message, up to the next. */
export function withSection(text, heading, body) {
  const start = text.indexOf(`### ${heading}`);
  if (start < 0) return `${text.trimEnd()}\n\n### ${heading}\n${body}\n`;
  const next = text.indexOf("\n### ", start + 4);
  return `${text.slice(0, start)}### ${heading}\n${body}\n${next < 0 ? "" : text.slice(next)}`;
}
export function sectionOf(text, heading) {
  const start = text.indexOf(`### ${heading}`);
  if (start < 0) return "";
  const next = text.indexOf("\n### ", start + 4);
  return text
    .slice(start + heading.length + 4, next < 0 ? undefined : next)
    .trim();
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** `Thu 2026-11-05` for a day counted from the lab's first test day. */
export function dayOf(offset, base = "2026-11-09") {
  const date = new Date(`${base}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return `${DAYS[date.getUTCDay()]} ${date.toISOString().slice(0, 10)}`;
}
