import { estimateTokens } from "openclaw/plugin-sdk/agent-core";
import { buildMemorySystemPromptAddition } from "openclaw/plugin-sdk/core";
import type { SessionCatalogTranscriptItem } from "openclaw/plugin-sdk/session-catalog";
import { readSessionTranscriptCatalogPage } from "openclaw/plugin-sdk/session-transcript-runtime";
import type { ContextEngineConfig } from "./config.ts";
import type { SkillLoader } from "./skill-loader.ts";
import type { ActiveTask } from "../taskman/types.ts";
import { personLabel } from "../person-label.ts";

export type { HarnessContextEngine as ContextEngine } from "openclaw/plugin-sdk/agent-harness-runtime";
import type { HarnessContextEngine as ContextEngine } from "openclaw/plugin-sdk/agent-harness-runtime";
import {
  formatSimTime,
  formatSessionHeader,
  formatEnvelopeRecord,
} from "./format.ts";
type Message = Parameters<ContextEngine["assemble"]>[0]["messages"][number];

/** Keep whole prior turns so trimming cannot orphan a tool call or result. */
const FORGOTTEN_RESULT =
  "[You no longer have this result in mind. Look again if you still need it.]";

function callsTools(message: Message): boolean {
  return (
    message.role === "assistant" &&
    Array.isArray(message.content) &&
    message.content.some((block) => block.type === "toolCall")
  );
}

/**
 * The run in progress, then earlier whole turns within `budget`. A model has
 * nothing else to remember its own tool results by, so the run is never cut by
 * `budget`: only when it outgrows `capacity` do its oldest results go.
 */
function recentBrainHistory(
  messages: Message[],
  budget: number,
  capacity: number,
): Message[] {
  // A run ends with an assistant message that calls no tools. One cut off by
  // the run limits has none, so the next run continues from what it did.
  const runStart =
    messages.findLastIndex(
      (message) => message.role === "assistant" && !callsTools(message),
    ) + 1;
  let runTokens = messages
    .slice(runStart)
    .reduce((sum, message) => sum + estimateTokens(message), 0);
  const run = messages.slice(runStart).map((message): Message => {
    if (runTokens <= capacity || message.role !== "toolResult") return message;
    const forgotten: Message = {
      ...message,
      content: [{ type: "text", text: FORGOTTEN_RESULT }],
    };
    runTokens -= estimateTokens(message) - estimateTokens(forgotten);
    return forgotten;
  });

  // A steered user message can occur between a tool call and its result. Such
  // a message is not a safe place to cut the prior turn. A call that never got
  // a result holds nothing open.
  const calledAt = new Map<string, number>();
  const unsafe = new Set<number>();
  for (const [index, message] of messages.entries()) {
    if (message.role === "assistant" && Array.isArray(message.content)) {
      for (const block of message.content) {
        if (block.type === "toolCall") calledAt.set(block.id, index);
      }
    } else if (message.role === "toolResult") {
      const called = calledAt.get(message.toolCallId) ?? index;
      for (let inside = called + 1; inside < index; inside++)
        unsafe.add(inside);
    }
  }
  const earlierBudget = Math.min(budget, capacity - runTokens);
  let start = runStart;
  let tokens = 0;
  let turnTokens = 0;
  for (let index = runStart - 1; index >= 0; index--) {
    const message = messages[index];
    turnTokens += estimateTokens(message);
    if (
      unsafe.has(index) ||
      (message.role !== "user" &&
        message.role !== "compactionSummary" &&
        message.role !== "branchSummary")
    )
      continue;
    if (tokens + turnTokens > earlierBudget) break;
    tokens += turnTokens;
    turnTokens = 0;
    start = index;
  }
  return [...messages.slice(start, runStart), ...run];
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
    readonly senderName?: string;
    readonly timestamp: number;
  }[];
  /** One line of desire states, rendered verbatim. */
  readonly feelings?: string;
  /** Position and travel times, rendered verbatim. */
  readonly whereabouts?: string;
  /** Someone else is here, so the in-person skill applies. */
  readonly inCompany?: boolean;
  /** Names of the people in these records, by id. */
  readonly names?: ReadonlyMap<string, string>;
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
  // Last, so the stable prefix survives people coming and going.
  const inPerson = params.inCompany
    ? await skillLoader.loadSkill(config.skills.inPerson, resolutionContext)
    : undefined;

  // Ordered from most to least stable so the provider can reuse the prefix
  // across turns. The clock lives in the situation message, never here.
  const systemPromptAddition = [
    baseConventions,
    buildMemorySystemPromptAddition({
      availableTools: run.availableTools ?? new Set(),
      citationsMode: run.citationsMode,
      agentId: params.agentId,
      agentSessionKey: run.sessionKey,
    }),
    behavior,
    inPerson,
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
      "Kazusa context budget cannot fit its system prompt additions.",
    );
  }
  const situation: Message = {
    role: "user",
    content: [
      // A leading sim-time stamp also stops the host from stamping this
      // message with its own clock and time zone.
      `[${formatSimTime(params.simTime)}] Current simulation time`,
      "",
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
      ...(params.whereabouts
        ? ["", "### Where you are", params.whereabouts]
        : []),
      ...(params.feelings ? ["", "### How you feel", params.feelings] : []),
      ...(params.awaitingReplies?.length
        ? [
            "",
            "### Chats awaiting your reply",
            ...params.awaitingReplies.map(
              (chat) =>
                `- ${formatSessionHeader(chat.sessionKey)}: ${personLabel(chat.senderName, chat.sender)} at ${formatSimTime(chat.timestamp)}`,
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
    config.brainMaxTokens,
    remaining,
  );
  remaining -= history.reduce(
    (sum, message) => sum + estimateTokens(message),
    0,
  );

  const articles: string[] = [];
  let wikiBudget = Math.min(config.personalWikiMaxTokens, remaining);
  for (const article of (params.personalWiki ?? []).slice(
    0,
    config.personalWikiMaxArticles,
  )) {
    const text = `### Personal recollection\n${article}`;
    const tokens = estimateTokens({
      role: "user",
      content: text,
      timestamp: params.simTime,
    });
    if (tokens > wikiBudget) continue;
    articles.push(text);
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
    ...(params.names ? { names: params.names } : {}),
  });

  // Recollections and ledgers share one message that leads with our own
  // sim-time stamp: the host stamps any message without one, in its own format.
  const background = [
    ...articles,
    ...[...selected].map(
      ([key, records]) =>
        `### ${formatSessionHeader(key)}${records.reverse().join("")}`,
    ),
  ];
  const context: Message[] = background.length
    ? [
        {
          role: "user",
          content: [
            `[${formatSimTime(params.simTime)}] Recollections and recent records`,
            ...background,
          ].join("\n\n"),
          timestamp: params.simTime,
        },
      ]
    : [];
  // The host appends the pending turn after this history. Never replay ledger
  // records as assistant/tool messages or persist these synthetic context views.
  const messages = [...context, ...history, situation];
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
  readonly names?: ReadonlyMap<string, string>;
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
    const record = formatEnvelopeRecord({
      ...event,
      ...(params.names ? { names: params.names } : {}),
    });
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
