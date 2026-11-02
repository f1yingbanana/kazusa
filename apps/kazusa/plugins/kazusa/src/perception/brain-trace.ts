import type {
  BrainCall,
  BrainStep,
  BrainTurn,
  BrainUsage,
} from "@kazusa/client";

export interface RunFailure {
  readonly error: string;
  readonly at: number;
  readonly runId: string;
}

/** One tool result or prompt can be a whole wiki page; the view only peeks. */
const MAX_TEXT_CHARS = 8000;

interface TranscriptRow {
  readonly entryId: string;
  readonly message: {
    readonly role: string;
    readonly content: unknown;
    readonly timestamp?: number;
    readonly __openclaw?: { readonly [key: string]: unknown };
    readonly [key: string]: unknown;
  };
}

function clip(text: string): string {
  return text.length > MAX_TEXT_CHARS
    ? `${text.slice(0, MAX_TEXT_CHARS)}\n… (${text.length - MAX_TEXT_CHARS} more characters)`
    : text;
}

const asRecord = (value: unknown): Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;
const asNumber = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

function blocksOf(content: unknown): readonly Record<string, unknown>[] {
  if (!Array.isArray(content)) return [];
  return (content as unknown[]).flatMap((block) =>
    typeof block === "object" && block !== null
      ? [block as Record<string, unknown>]
      : [],
  );
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  return blocksOf(content)
    .flatMap((block) => (typeof block.text === "string" ? [block.text] : []))
    .join("\n");
}

function usageOf(value: unknown): BrainUsage | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const usage = asRecord(value);
  const cost = asRecord(usage.cost).total;
  return {
    input: asNumber(usage.input),
    output: asNumber(usage.output),
    cacheRead: asNumber(usage.cacheRead),
    cacheWrite: asNumber(usage.cacheWrite),
    total: asNumber(usage.totalTokens),
    ...(typeof usage.reasoningTokens === "number"
      ? { reasoning: usage.reasoningTokens }
      : {}),
    ...(typeof cost === "number" ? { cost } : {}),
  };
}

function addUsage(
  sum: BrainUsage | undefined,
  usage: BrainUsage | undefined,
): BrainUsage | undefined {
  if (!usage) return sum;
  if (!sum) return usage;
  const reasoning = (sum.reasoning ?? 0) + (usage.reasoning ?? 0);
  const cost = (sum.cost ?? 0) + (usage.cost ?? 0);
  return {
    input: sum.input + usage.input,
    output: sum.output + usage.output,
    cacheRead: sum.cacheRead + usage.cacheRead,
    cacheWrite: sum.cacheWrite + usage.cacheWrite,
    total: sum.total + usage.total,
    ...(reasoning > 0 ? { reasoning } : {}),
    ...(sum.cost !== undefined || usage.cost !== undefined ? { cost } : {}),
  };
}

function stepsOf(content: unknown): BrainStep[] {
  if (typeof content === "string") {
    return content ? [{ type: "text", text: clip(content) }] : [];
  }
  return blocksOf(content).flatMap((block): BrainStep[] => {
    if (block.type === "thinking") {
      const text = asString(block.thinking) ?? asString(block.text);
      return text ? [{ type: "thinking", text: clip(text) }] : [];
    }
    if (block.type === "text") {
      const text = asString(block.text);
      return text ? [{ type: "text", text: clip(text) }] : [];
    }
    if (block.type === "toolCall") {
      return [
        {
          type: "tool",
          id: asString(block.id) ?? "",
          name: asString(block.name) ?? "tool",
          input: clip(JSON.stringify(block.arguments ?? {}, null, 2)),
        },
      ];
    }
    return [];
  });
}

/**
 * Folds a brain transcript into turns, oldest first. A turn is one host run
 * (`__openclaw.runId`) and each assistant message in it is one LLM call, so
 * every count here is what the host recorded; nothing is tracked separately.
 * Input that has reached no run yet is returned as a last turn with no calls.
 */
export function brainTurns(rows: readonly TranscriptRow[]): BrainTurn[] {
  const turns: BrainTurn[] = [];
  const toolSteps = new Map<string, Extract<BrainStep, { type: "tool" }>>();
  let prompts: string[] = [];
  let promptAt: number | undefined;
  let runId: string | undefined;

  const open = (id: string, at?: number): void => {
    turns.push({ id, at: promptAt ?? at, prompts, calls: [] });
    prompts = [];
    promptAt = undefined;
  };

  for (const { entryId, message } of rows) {
    if (message.role === "user") {
      const text = textOf(message.content);
      if (text) prompts.push(clip(text));
      promptAt ??= message.timestamp;
    } else if (message.role === "assistant") {
      const nextRun = asString(message.__openclaw?.runId);
      if (turns.length === 0 || nextRun === undefined || nextRun !== runId) {
        open(nextRun ?? entryId, message.timestamp);
      }
      runId = nextRun;
      const turn = turns[turns.length - 1];
      // Input that arrived mid-run steers that same run.
      if (prompts.length > 0) {
        turn.prompts.push(...prompts);
        prompts = [];
        promptAt = undefined;
      }
      const usage = usageOf(message.usage);
      const steps = stepsOf(message.content);
      for (const step of steps) {
        if (step.type === "tool") toolSteps.set(step.id, step);
      }
      const call: BrainCall = {
        id: entryId,
        at: message.timestamp,
        provider: asString(message.provider),
        model: asString(message.model),
        stopReason: asString(message.stopReason),
        error: asString(message.errorMessage),
        usage,
        steps,
      };
      turn.calls.push(call);
      turn.usage = addUsage(turn.usage, usage);
    } else if (message.role === "toolResult") {
      const step = toolSteps.get(asString(message.toolCallId) ?? "");
      if (step) {
        step.result = clip(textOf(message.content));
        if (message.isError === true) step.isError = true;
      }
    }
  }
  if (prompts.length > 0) open(`waiting:${rows[rows.length - 1].entryId}`);
  return turns;
}

/**
 * Puts the latest failed run where it happened. A run can fail before any model
 * call is recorded, say on a missing or rejected key, and the transcript then
 * holds nothing but its prompts; an error the host did record is already
 * shown.
 */
export function withFailure(
  turns: readonly BrainTurn[],
  failure: RunFailure | undefined,
): BrainTurn[] {
  if (!failure) return [...turns];
  const last = turns.at(-1);
  const failed =
    turns.find((turn) => turn.id === failure.runId) ??
    (last?.id.startsWith("waiting:") ? last : undefined);
  if (failed?.calls.some((call) => call.error)) return [...turns];
  if (failed)
    return turns.map((turn) =>
      turn === failed ? { ...turn, error: failure.error } : turn,
    );
  return [
    ...turns,
    {
      id: failure.runId,
      at: failure.at,
      prompts: [],
      calls: [],
      error: failure.error,
    },
  ];
}
