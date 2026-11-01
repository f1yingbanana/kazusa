import { estimateTokens } from "openclaw/plugin-sdk/agent-core";
import { buildMemorySystemPromptAddition } from "openclaw/plugin-sdk/core";
import type { SessionCatalogTranscriptItem } from "openclaw/plugin-sdk/session-catalog";
import { readSessionTranscriptCatalogPage } from "openclaw/plugin-sdk/session-transcript-runtime";
import type { ContextEngineConfig } from "./config.ts";
import type { SkillLoader } from "./skill-loader.ts";
import type { ActiveTask } from "../taskman/types.ts";
import { personLabel } from "../person-label.ts";

import type { AssembledContext } from "@kazusa/client";
export type { HarnessContextEngine as ContextEngine } from "openclaw/plugin-sdk/agent-harness-runtime";
import type { HarnessContextEngine as ContextEngine } from "openclaw/plugin-sdk/agent-harness-runtime";
import {
  formatSimTime,
  formatSessionHeader,
  formatEnvelopeRecord,
} from "./format.ts";
type Message = Parameters<ContextEngine["assemble"]>[0]["messages"][number];

/**
 * What of the brain transcript the model sees: only the turn under way. Past
 * turns are in the records, and replaying them teaches the model to copy its
 * own tool calls. When the host gives a `prompt`, it appends the turn itself
 * after what we return, so `messages` holds nothing current.
 */
function brainHistory(
  messages: Message[],
  prompt: string | undefined,
): { readonly summaries: Message[]; readonly turn: Message[] } {
  const summaries = messages.filter(
    (message) =>
      message.role === "compactionSummary" || message.role === "branchSummary",
  );
  if (prompt) return { summaries, turn: [] };
  const start = messages.findLastIndex((message) => message.role === "user");
  return { summaries, turn: start < 0 ? [] : messages.slice(start) };
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
  /** What comes to mind this turn, rendered verbatim. */
  readonly onYourMind?: string;
  /** The people they know, rendered verbatim. */
  readonly roster?: string;
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
}): Promise<
  Awaited<ReturnType<ContextEngine["assemble"]>> & {
    readonly breakdown: NonNullable<AssembledContext["breakdown"]>;
    readonly situationText: string;
  }
> {
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
      ...(params.onYourMind ? ["", "### On your mind", params.onYourMind] : []),
      ...(params.roster ? ["", "### People you know", params.roster] : []),
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
  const brain = brainHistory(run.messages, run.prompt);
  const history = [...brain.summaries, ...brain.turn];
  remaining -= history.reduce(
    (sum, message) => sum + estimateTokens(message),
    0,
  );

  // No source quotas or additional clipping beyond the native catalog's display
  // projection. Skip records that cannot fit rather than cutting their text.
  const cutoff = params.simTime - config.shortTermHours * 3_600_000;
  const recordsText = renderLedgerRecords({
    sessionsContext: params.sessionsContext,
    simTime: params.simTime,
    cutoff,
    tokenBudget: Math.min(remaining, config.ledgerMaxTokens),
    ...(params.names ? { names: params.names } : {}),
  });

  // Leads with our own sim-time stamp: the host stamps any message without one,
  // in its own format.
  // Stamped with where it starts, not now: an unchanging first line keeps the
  // whole block in the provider's cache, and any stamp stops the host's own.
  const recordsDay = recordsText.match(/\(\w{3} (\d{4}-\d{2}-\d{2})\)/)?.[1];
  const recordsFrom = recordsDay ? Date.parse(`${recordsDay}T00:00:00Z`) : NaN;
  const stamp = Number.isFinite(recordsFrom) ? recordsFrom : params.simTime;
  const context: Message[] = recordsText
    ? [
        {
          role: "user",
          content: `[${formatSimTime(stamp)}] What you remember of the last while\n\n${recordsText}`,
          timestamp: stamp,
        },
      ]
    : [];
  // The host appends the pending turn after this history. Never replay ledger
  // records as assistant/tool messages or persist these synthetic context views.
  // The situation comes before the turn under way: last, it reads as a new
  // prompt after every tool result, and the model answers all over again.
  const messages = [...context, ...brain.summaries, situation, ...brain.turn];
  return {
    messages,
    estimatedTokens:
      messages.reduce((sum, message) => sum + estimateTokens(message), 0) +
      systemPromptTokens,
    systemPromptAddition,
    situationText:
      typeof situation.content === "string"
        ? situation.content
        : JSON.stringify(situation.content),
    breakdown: {
      skills: systemPromptTokens,
      situation: situationTokens,
      history: history.reduce((sum, m) => sum + estimateTokens(m), 0),
      records: context.reduce((sum, m) => sum + estimateTokens(m), 0),
    },
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

/** The speaker, time and any group header around one record's text. */
const RECORD_OVERHEAD_TOKENS = 20;

/**
 * Their records, oldest first, so new ones only ever append and the provider's
 * prompt cache survives. When the budget trims, the start snaps forward to a
 * sim hour, so it also stays put between turns. Whole records only.
 */
export function renderLedgerRecords(params: {
  readonly sessionsContext: Readonly<
    Record<string, readonly SessionCatalogTranscriptItem[]>
  >;
  readonly simTime: number;
  readonly cutoff: number;
  readonly tokenBudget: number;
  readonly names?: ReadonlyMap<string, string>;
}): string {
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
  const cost = (at: number): number =>
    estimateTokens({
      role: "user",
      content: fits[at].message.text ?? "",
      timestamp: fits[at].timestamp,
    }) + RECORD_OVERHEAD_TOKENS;
  // A record that could never fit is skipped, not cut, and hides nothing older.
  const fits = records.filter((record) => {
    const size = estimateTokens({
      role: "user",
      content: record.message.text ?? "",
      timestamp: record.timestamp,
    });
    return size + RECORD_OVERHEAD_TOKENS <= tokenBudget;
  });
  let start = 0;
  let used = 0;
  for (let at = fits.length - 1; at >= 0; at--) {
    used += cost(at);
    if (used <= tokenBudget) continue;
    start = at + 1;
    // Snap to the hour unless that throws away most of a busy hour.
    const hour = 3_600_000;
    const from = Math.ceil((fits[at].timestamp + 1) / hour) * hour;
    let snapped = 0;
    let index = fits.length;
    while (index > start && fits[index - 1].timestamp >= from) {
      index--;
      snapped += cost(index);
    }
    if (snapped >= tokenBudget / 2) start = index;
    break;
  }
  const lines: string[] = [];
  let day = "";
  let stream = "";
  const named = new Set<string>();
  for (const { sessionKey, message, timestamp } of fits.slice(start)) {
    const header = formatSessionHeader(sessionKey);
    const date = formatSimTime(timestamp).slice(0, 14);
    if (date !== day || header !== stream) {
      lines.push(`### ${header} (${date})`);
      day = date;
      stream = header;
    }
    lines.push(
      formatEnvelopeRecord({
        sessionKey,
        message,
        timestamp,
        ...(params.names ? { names: params.names } : {}),
        named,
      }).trim(),
    );
  }
  return lines.join("\n");
}

/**
 * How far oldest-first records fit a budget: the time to read up to, so
 * whatever doesn't fit stays unread for next time rather than being skipped.
 * Always moves forward, even if one record alone is over budget.
 */
export function ledgerWindowEnd(params: {
  readonly sessionsContext: Readonly<
    Record<string, readonly SessionCatalogTranscriptItem[]>
  >;
  readonly since: number;
  readonly now: number;
  readonly tokenBudget: number;
}): number {
  const records = Object.entries(params.sessionsContext)
    .flatMap(([sessionKey, messages]) =>
      messages.flatMap((message) => {
        const timestamp = Date.parse(message.timestamp ?? "");
        return (message.type === "userMessage" ||
          message.type === "agentMessage") &&
          message.text?.trim() &&
          timestamp >= params.since &&
          timestamp <= params.now
          ? [{ sessionKey, message, timestamp }]
          : [];
      }),
    )
    .sort((a, b) => a.timestamp - b.timestamp);
  let used = 0;
  let end: number | undefined;
  for (const event of records) {
    const content = formatEnvelopeRecord(event);
    used += estimateTokens({
      role: "user",
      content,
      timestamp: event.timestamp,
    });
    if (used > params.tokenBudget && end !== undefined && event.timestamp > end)
      return end;
    end = event.timestamp;
  }
  return params.now;
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
