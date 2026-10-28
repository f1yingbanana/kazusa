import { estimateTokens } from "openclaw/plugin-sdk/agent-core";
import { buildMemorySystemPromptAddition } from "openclaw/plugin-sdk/core";
import type { SessionCatalogTranscriptItem } from "openclaw/plugin-sdk/session-catalog";
import { readSessionTranscriptCatalogPage } from "openclaw/plugin-sdk/session-transcript-runtime";
import type { ContextEngineConfig } from "./config.ts";
import type { SkillLoader } from "./skill-loader.ts";
import type { ActiveTask } from "../taskman/types.ts";

export type { HarnessContextEngine as ContextEngine } from "openclaw/plugin-sdk/agent-harness-runtime";
import type { HarnessContextEngine as ContextEngine } from "openclaw/plugin-sdk/agent-harness-runtime";
import {
  formatSimTime,
  formatSessionHeader,
  formatEnvelopeRecord,
} from "./format.ts";
type Message = Parameters<ContextEngine["assemble"]>[0]["messages"][number];

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
 * Assemble character behavior, current activity, recollections and whole brain
 * turns. Transport markers and message content never select system
 * instructions.
 */
export async function assembleContext(params: {
  /**
   * Host-supplied execution history and current stimulus; called only for brain
   * runs.
   */
  readonly run: Parameters<ContextEngine["assemble"]>[0];
  readonly agentId: string;
  readonly workspaceDir?: string;
  readonly sessionsContext: Readonly<
    Record<string, readonly SessionCatalogTranscriptItem[]>
  >;
  readonly simTime: number;
  readonly activeTask: ActiveTask | null;
  readonly personalWiki?: readonly string[];
  /** Chats whose latest visible message came from someone else. */
  readonly awaitingReplies?: readonly {
    readonly sessionKey: string;
    readonly sender: string;
    readonly timestamp: number;
  }[];
  readonly config: ContextEngineConfig;
  readonly skillLoader: SkillLoader;
}): ReturnType<ContextEngine["assemble"]> {
  const { config, run, skillLoader } = params;
  const resolutionContext = {
    agentId: params.agentId,
    workspaceDir: params.workspaceDir,
  };
  const budget = Math.max(0, run.tokenBudget ?? Number.POSITIVE_INFINITY);
  const conventionsSkill = config.skills.conventions;
  const lifecycleSkill = config.skills.lifecycle;
  const interruptSkill = config.skills.interrupt;

  const baseConventions = await skillLoader.loadSkill(
    conventionsSkill,
    resolutionContext,
  );
  const task = params.activeTask;
  const needsActivity = !task || Date.parse(task.endAt) <= params.simTime;
  const behavior = await skillLoader.loadSkill(
    needsActivity ? lifecycleSkill : interruptSkill,
    resolutionContext,
  );

  const systemPromptAddition = [
    baseConventions,
    `Current simulation time: ${formatSimTime(params.simTime)}`,
    behavior,
    buildMemorySystemPromptAddition({
      availableTools: run.availableTools ?? new Set(),
      citationsMode: run.citationsMode,
      agentId: params.agentId,
      agentSessionKey: run.sessionKey,
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
  const situation: Message = {
    role: "user",
    content: [
      "### Current activity",
      task
        ? [
            `Status: ${needsActivity ? "due for reassessment" : "ongoing"}`,
            `Activity: ${JSON.stringify(task.type)}`,
            `Description: ${JSON.stringify(task.description)}`,
            `Started: ${formatSimTime(Date.parse(task.startedAt))}`,
            `Planned check-in: ${formatSimTime(Date.parse(task.endAt))}`,
          ].join("\n")
        : "No activity has been chosen yet.",
      ...(params.awaitingReplies?.length
        ? [
            "",
            "### Chats awaiting your reply",
            ...params.awaitingReplies.map(
              (chat) =>
                `- ${formatSessionHeader(chat.sessionKey)}: ${chat.sender} at ${formatSimTime(chat.timestamp)}`,
            ),
          ]
        : []),
    ].join("\n"),
    timestamp: params.simTime,
  };
  const situationTokens = estimateTokens(situation);
  if (systemPromptTokens + situationTokens > budget) {
    throw new Error("Kazusa context budget cannot fit current activity.");
  }
  let remaining = budget - systemPromptTokens - situationTokens;
  const history = recentBrainHistory(
    run.messages,
    Math.min(config.brainMaxTokens, remaining),
  );
  remaining -= history.reduce(
    (sum, message) => sum + estimateTokens(message),
    0,
  );

  const recollections: Message[] = [];
  let wikiBudget = Math.min(config.personalWikiMaxTokens, remaining);
  for (const article of (params.personalWiki ?? []).slice(
    0,
    config.personalWikiMaxArticles,
  )) {
    const message: Message = {
      role: "user",
      content: `### Personal recollection\n${article}`,
      timestamp: params.simTime,
    };
    const tokens = estimateTokens(message);
    if (tokens > wikiBudget) continue;
    recollections.push(message);
    wikiBudget -= tokens;
    remaining -= tokens;
  }

  // No source quotas or additional clipping beyond the native catalog's display
  // projection. Skip records that cannot fit rather than cutting their text.
  const cutoff = params.simTime - config.shortTermHours * 3_600_000;
  const selected = packLedgerRecords({
    sessionsContext: params.sessionsContext,
    simTime: params.simTime,
    cutoff,
    tokenBudget: remaining,
  });

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
  const messages = [...recollections, ...context, ...history, situation];
  return {
    messages,
    estimatedTokens:
      messages.reduce((sum, message) => sum + estimateTokens(message), 0) +
      systemPromptTokens,
    systemPromptAddition,
  };
}

/**
 * Pack historical ledger records newest-first within a simulation cutoff and
 * token budget.
 */
export function packLedgerRecords(params: {
  readonly sessionsContext: Readonly<
    Record<string, readonly SessionCatalogTranscriptItem[]>
  >;
  readonly simTime: number;
  readonly cutoff: number;
  readonly tokenBudget: number;
}): Map<string, string[]> {
  const { sessionsContext, simTime, cutoff, tokenBudget } = params;
  const records = Object.entries(sessionsContext)
    .flatMap(([sessionKey, messages]) =>
      messages.flatMap((message) => {
        const timestamp = Date.parse(message.timestamp ?? "");
        return (message.type === "userMessage" ||
          message.type === "agentMessage") &&
          message.text?.trim() &&
          Number.isFinite(timestamp) &&
          timestamp >= cutoff &&
          timestamp <= simTime
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
    if (used + cost > tokenBudget) continue;
    if (group) group.push(record);
    else selected.set(event.sessionKey, [record]);
    used += cost;
  }
  return selected;
}

/**
 * Read session catalog transcripts for the brain context within the simulation
 * time window.
 */
export async function readSessionStreams(params: {
  agentId: string;
  streams: readonly { sessionKey: string }[];
  storePath?: string;
  pluginId: string;
  now: number;
  cutoff: number;
}): Promise<Record<string, SessionCatalogTranscriptItem[]>> {
  const { agentId, streams, storePath, pluginId, now, cutoff } = params;
  const sessionsContext: Record<string, SessionCatalogTranscriptItem[]> = {};

  for (const { sessionKey } of streams) {
    const messages: SessionCatalogTranscriptItem[] = [];
    let cursor: string | undefined;
    do {
      const page = await readSessionTranscriptCatalogPage({
        agentId,
        sessionKey,
        storePath,
        pluginId,
        sourceDomain: "kazusa",
        limit: 200, // Native catalog page maximum, not a history cap.
        cursor,
      });
      let reachedCutoff = false;
      for (const message of page.items) {
        const timestamp = message.timestamp
          ? Date.parse(message.timestamp)
          : Number.NaN;
        if (Number.isNaN(timestamp)) continue;
        if (timestamp > now) continue;
        if (timestamp < cutoff) {
          reachedCutoff = true;
          break;
        }
        messages.push(message);
      }
      if (reachedCutoff || !page.nextCursor) break;
      cursor = page.nextCursor;
    } while (cursor);
    sessionsContext[sessionKey] = messages.reverse();
  }
  return sessionsContext;
}
