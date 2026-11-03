import type { BrainTurn } from "@kazusa/client";
import { estimateTokens } from "openclaw/plugin-sdk/agent-core";

/**
 * How a character called its tools in past turns, and what came back: enough to
 * call them right, too little to copy. Replaying whole past turns made the
 * model repeat its own calls (double sends in 18 of 24 runs, measured live on
 * 2026-10-31), so this never carries what was said: a `send_message` shows
 * where it went and how many messages, prose is cut, and only errors keep their
 * text. The turns are the brain trace's (`readBrainTurns`).
 */

const LONG = 60;
const MAX_ARGS = 320;
const MAX_ERROR = 200;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const cut = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

/** The arguments as a shape: routing kept, words dropped or cut. */
export function callShape(name: string, args: unknown): string {
  if (!isRecord(args)) return "";
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (name === "send_message" && key === "messages" && Array.isArray(value)) {
      const kinds = value.map((message) =>
        isRecord(message) && typeof message.type === "string"
          ? message.type
          : "text",
      );
      out[key] = `${value.length} (${kinds.join(", ")})`;
    } else if (name === "send_message" && key === "text") {
      out[key] = "…";
    } else if (typeof value === "string" && /\s/.test(value)) {
      // Prose is cut; ids, keys and paths are what show how it was called.
      out[key] = cut(value, LONG);
    } else {
      out[key] = value;
    }
  }
  return cut(JSON.stringify(out), MAX_ARGS);
}

/** One line of what went wrong, unwrapping the host's and Zod's envelopes. */
export function errorLine(text: string): string {
  let message = text;
  try {
    const parsed: unknown = JSON.parse(message);
    if (isRecord(parsed) && typeof parsed.error === "string")
      message = parsed.error;
  } catch {
    // Plain text already.
  }
  try {
    const issues: unknown = JSON.parse(message);
    if (Array.isArray(issues))
      message = issues
        .map((issue) =>
          isRecord(issue)
            ? [
                Array.isArray(issue.path) ? issue.path.join(".") : "",
                issue.message,
              ]
                .filter((part) => typeof part === "string" && part !== "")
                .join(": ")
            : "",
        )
        .filter(Boolean)
        .join("; ");
  } catch {
    // Not a list of issues.
  }
  return cut(message.replace(/\s+/g, " ").trim(), MAX_ERROR);
}

/** The sim time a turn's prompt starts with, as perception stamps it. */
const STAMP = /^\[[^\]\n]*\d{4}-\d{2}-\d{2} \d{2}:\d{2}[^\]\n]*\]/;

/**
 * The digest: one line per past tool call, oldest first, the newest that fit
 * `maxTokens`, each turn's under the sim time its prompt starts with. Its words
 * are `kazusa-deliveries` sections, read through `text`. Empty when there are
 * no calls.
 */
export function renderToolHistory(
  turns: readonly BrainTurn[],
  maxTokens: number,
  text: (section: string, values?: Record<string, string>) => string,
): string {
  const calls = turns.flatMap((turn) => {
    const stamp = turn.prompts[0]?.match(STAMP)?.[0] ?? "";
    return turn.calls
      .flatMap((call) => call.steps)
      .flatMap((step) => {
        if (step.type !== "tool") return [];
        let args: unknown;
        try {
          args = JSON.parse(step.input);
        } catch {
          // Cut short by the trace: show it as it is.
          args = undefined;
        }
        const shape =
          args === undefined
            ? cut(step.input.replace(/\s+/g, " "), MAX_ARGS)
            : callShape(step.name, args);
        const outcome =
          step.result === undefined
            ? text("tool-no-result")
            : step.isError
              ? text("tool-error", { error: errorLine(step.result) })
              : text("tool-ok");
        const line = text("tool-call", {
          name: step.name,
          args: shape,
          outcome,
        });
        return [{ turn, stamp, line }];
      });
  });
  if (!calls.length) return "";
  const heading = text("tool-history");
  const tokens = (line: string) =>
    line ? estimateTokens({ role: "user", content: line, timestamp: 0 }) : 0;
  let used = tokens(heading);
  let from = calls.length;
  while (from > 0) {
    const { turn, stamp, line } = calls[from - 1];
    // A turn's stamp is paid for with the first of its calls that fits.
    const cost =
      tokens(line) + (calls[from]?.turn === turn ? 0 : tokens(stamp));
    if (used + cost > maxTokens) break;
    used += cost;
    from -= 1;
  }
  if (from === calls.length) return "";
  return [
    heading,
    ...calls
      .slice(from)
      .flatMap(({ turn, stamp, line }, index, kept) =>
        kept[index - 1]?.turn === turn
          ? [line]
          : ["", ...(stamp ? [stamp] : []), line],
      ),
  ].join("\n");
}
