import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import { estimateTokens } from "openclaw/plugin-sdk/agent-core";
import {
  buildMemorySystemPromptAddition,
  type OpenClawPluginApi,
} from "openclaw/plugin-sdk/core";
import type { SessionRecentConversationText } from "openclaw/plugin-sdk/session-store-runtime";
import type { ContextEngineConfig } from "./config.ts";
import type { SkillLoader } from "./skill-loader.ts";

dayjs.extend(utc);

export type ContextEngine = Awaited<
  ReturnType<Parameters<OpenClawPluginApi["registerContextEngine"]>[1]>
>;
type Message = Parameters<ContextEngine["assemble"]>[0]["messages"][number];

/**
 * Format a simulation timestamp as UTC `ddd YYYY-MM-DD HH:mm` (e.g. `Fri
 * 2026-10-23 08:00`). Dropping seconds, 'T', and 'Z' saves significant token
 * budget across large histories.
 */
export function formatSimTime(timestamp: number): string {
  return dayjs.utc(timestamp).format("ddd YYYY-MM-DD HH:mm");
}

/**
 * Strips internal prefix `agent:<agentId>:` to yield clean stream headers (e.g.
 * `tasks`, `chat:direct:bob`).
 */
export function formatSessionHeader(sessionKey: string): string {
  const parts = sessionKey.split(":");
  if (parts.length >= 3 && parts[0] === "agent") {
    return parts.slice(2).join(":");
  }
  return sessionKey;
}

/**
 * Format a single transcript entry with the compact envelope `[<speaker>
 * <time>] <text>`.
 */
export function formatEnvelopeRecord(params: {
  sessionKey: string;
  message: SessionRecentConversationText;
  timestamp: number;
}): string {
  const time = formatSimTime(params.timestamp);
  let text = params.message.text.trim();
  let explicitSpeaker: string | undefined;

  const speakerTagMatch = text.match(/^\[speaker:([^\]]+)\]\s*(.*)$/s);
  if (speakerTagMatch) {
    explicitSpeaker = speakerTagMatch[1];
    text = speakerTagMatch[2];
  }

  const stream = formatSessionHeader(params.sessionKey);
  if (stream === "tasks") {
    return `\n\n[${time}] ${text}`;
  }

  if (params.message.role === "assistant") {
    return `\n\n[(self) ${time}] ${text}`;
  }

  if (explicitSpeaker) {
    return `\n\n[${explicitSpeaker} ${time}] ${text}`;
  }

  if (stream.startsWith("chat:direct:")) {
    const peer = stream.slice("chat:direct:".length);
    const peerPrefixMatch = text.match(new RegExp(`^${peer}:\\s*(.*)$`, "s"));
    const body = peerPrefixMatch ? peerPrefixMatch[1] : text;
    return `\n\n[${peer} ${time}] ${body}`;
  }

  const colonMatch = text.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/s);
  if (colonMatch) {
    return `\n\n[${colonMatch[1]} ${time}] ${colonMatch[2]}`;
  }

  return `\n\n[other ${time}] ${text}`;
}

/** Keep whole prior turns so trimming cannot orphan a tool call or result. */
function recentBrainHistory(messages: Message[], budget: number): Message[] {
  const boundaries = new Set<number>();
  const pending = new Set<string>();
  for (const [index, message] of messages.entries()) {
    // A steered user message can occur between a tool call and its result.
    // Such a message is not a safe place to cut the prior turn.
    if (
      pending.size === 0 &&
      (message.role === "user" ||
        message.role === "compactionSummary" ||
        message.role === "branchSummary")
    ) {
      boundaries.add(index);
    }
    if (message.role === "assistant" && Array.isArray(message.content)) {
      for (const block of message.content) {
        if (block.type === "toolCall") pending.add(block.id);
      }
    } else if (message.role === "toolResult") {
      pending.delete(message.toolCallId);
    }
  }
  let start = messages.length;
  let tokens = 0;
  let turnTokens = 0;
  for (let index = messages.length - 1; index >= 0; index--) {
    turnTokens += estimateTokens(messages[index]);
    if (!boundaries.has(index)) continue;
    if (tokens + turnTokens > budget) break;
    tokens += turnTokens;
    turnTokens = 0;
    start = index;
  }
  return messages.slice(start);
}

/**
 * Assemble dynamic skill instructions for tagged stimuli, whole brain turns,
 * and recent experiences under a shared task/chat token budget.
 */
export async function assembleContext(params: {
  /**
   * Host-supplied execution history and current stimulus; called only for brain
   * runs.
   */
  readonly run: Parameters<ContextEngine["assemble"]>[0];
  readonly sessionsContext: Readonly<
    Record<string, readonly SessionRecentConversationText[]>
  >;
  readonly simTime: number;
  readonly config: ContextEngineConfig;
  readonly skillLoader: SkillLoader;
}): ReturnType<ContextEngine["assemble"]> {
  const { config, run, skillLoader } = params;
  const resolutionContext = {
    agentId: run.runtimeContext?.sessionTarget?.agentId,
    cwd:
      typeof run.runtimeContext?.cwd === "string"
        ? run.runtimeContext.cwd
        : undefined,
  };
  const budget = Math.max(0, run.tokenBudget ?? Number.POSITIVE_INFINITY);
  const baseConventions = await skillLoader.loadSkill(
    "context-conventions",
    resolutionContext,
  );
  const skillMatches = run.prompt
    ? [...run.prompt.matchAll(/\[kazusa:skill=([a-zA-Z0-9_-]+)\]/g)]
    : [];
  const uniqueSkillNames = [...new Set(skillMatches.map((m) => m[1]))].filter(
    (name) => name !== "context-conventions" && name !== "context_conventions",
  );
  const loadedSkills: string[] = [];
  for (const skillName of uniqueSkillNames) {
    loadedSkills.push(
      await skillLoader.loadSkill(skillName, resolutionContext),
    );
  }

  const systemPromptAddition = [
    baseConventions,
    `Current simulation time: ${formatSimTime(params.simTime)}`,
    ...loadedSkills,
    buildMemorySystemPromptAddition({
      availableTools: run.availableTools ?? new Set(),
      citationsMode: run.citationsMode,
      agentId: run.runtimeContext?.sessionTarget?.agentId,
      agentSessionKey:
        run.sessionKey ?? run.runtimeContext?.sessionTarget?.sessionKey,
    }),
  ]
    .filter(Boolean)
    .join("\n\n");
  const systemPromptTokens = estimateTokens({
    role: "user",
    content: systemPromptAddition,
    timestamp: params.simTime,
  });
  if (systemPromptTokens > budget) {
    throw new Error(
      "Kazusa context budget cannot fit its system prompt additions and simulation time.",
    );
  }
  let remaining = budget - systemPromptTokens;
  const history = recentBrainHistory(
    run.messages,
    Math.min(config.brainMaxTokens, remaining),
  );
  remaining -= history.reduce(
    (sum, message) => sum + estimateTokens(message),
    0,
  );

  // No source quotas or per-message clipping. A large record that cannot fit
  // is skipped so smaller, older records can still use the remaining space.
  const cutoff = params.simTime - config.shortTermHours * 3_600_000;
  const records = Object.entries(params.sessionsContext)
    .flatMap(([sessionKey, messages]) =>
      messages.flatMap((message) => {
        const timestamp = message.timestamp;
        return timestamp !== undefined &&
          Number.isFinite(timestamp) &&
          timestamp >= cutoff &&
          timestamp <= params.simTime
          ? [{ sessionKey, message, timestamp }]
          : [];
      }),
    )
    .sort(
      (a, b) =>
        a.timestamp - b.timestamp || a.sessionKey.localeCompare(b.sessionKey),
    );
  const selected = new Map<string, string[]>();
  let used = 0;
  for (const event of records.reverse()) {
    const record = formatEnvelopeRecord(event);
    const streamHeader = `### ${formatSessionHeader(event.sessionKey)}`;
    const group = selected.get(event.sessionKey);
    const cost =
      estimateTokens({
        role: "user",
        content: record,
        timestamp: event.timestamp,
      }) +
      (group
        ? 0
        : estimateTokens({
            role: "user",
            content: `\n\n${streamHeader}`,
            timestamp: event.timestamp,
          }));
    if (used + cost > remaining) continue;
    if (group) group.push(record);
    else selected.set(event.sessionKey, [record]);
    used += cost;
  }
  const context: Message[] = [];
  if (selected.size) {
    context.push({
      role: "user",
      content: [...selected]
        .map(
          ([key, records]) =>
            `### ${formatSessionHeader(key)}${records.reverse().join("")}`,
        )
        .join("\n\n"),
      timestamp: params.simTime,
    });
  }
  // The host appends the pending turn after this history. Never replay ledger
  // records as assistant/tool messages or persist these synthetic context views.
  const messages = [...context, ...history];
  return {
    messages,
    estimatedTokens:
      messages.reduce((sum, message) => sum + estimateTokens(message), 0) +
      systemPromptTokens,
    systemPromptAddition,
  };
}
