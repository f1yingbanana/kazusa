// Logs every request this process sends to a model API, exactly as sent.
//
// Load it into the Gateway with Node's --import, e.g.
//   NODE_OPTIONS="--import ./scripts/llm-capture.mjs" npm run dev
// Each request becomes one JSON line in KAZUSA_LLM_LOG
// (default: apps/kazusa/world/.state/logs/llm-requests.jsonl):
//   { at, method, url, body }   (body parsed when it is JSON)
//
// It listens on Node's built-in fetch (undici) diagnostics channels, so it
// changes nothing about the request. Only paths that look like model calls are
// kept; set KAZUSA_LLM_LOG_ALL=1 to keep every request body.
import { appendFileSync, mkdirSync } from "node:fs";
import diagnostics from "node:diagnostics_channel";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOG =
  process.env.KAZUSA_LLM_LOG ??
  path.join(ROOT, "apps/kazusa/world/.state/logs/llm-requests.jsonl");
/** OpenAI-style and Anthropic-style model endpoints, not Kazusa's own routes. */
const MODEL_CALL =
  /^(?!\/kazusa\/).*\/(chat\/completions|completions|responses|embeddings|v1\/messages)(\?|$)/;
const keepAll = process.env.KAZUSA_LLM_LOG_ALL === "1";

mkdirSync(path.dirname(LOG), { recursive: true });

/** Request object → its body so far. */
const pending = new WeakMap();
const decoder = new TextDecoder();

diagnostics.subscribe("undici:request:create", ({ request }) => {
  const url = `${request.origin}${request.path}`;
  if (keepAll || MODEL_CALL.test(request.path))
    pending.set(request, { url, method: request.method, chunks: [] });
});

diagnostics.subscribe("undici:request:bodyChunkSent", ({ request, chunk }) => {
  const entry = pending.get(request);
  if (!entry) return;
  entry.chunks.push(typeof chunk === "string" ? chunk : decoder.decode(chunk));
});

diagnostics.subscribe("undici:request:bodySent", ({ request }) => {
  const entry = pending.get(request);
  if (!entry) return;
  pending.delete(request);
  const text = entry.chunks.join("");
  let body = text;
  try {
    body = JSON.parse(text);
  } catch {
    // Not JSON: keep the text.
  }
  try {
    appendFileSync(
      LOG,
      `${JSON.stringify({
        at: new Date().toISOString(),
        method: entry.method,
        url: entry.url,
        body,
      })}\n`,
    );
  } catch (error) {
    console.error(`llm-capture: ${String(error)}`);
  }
});
