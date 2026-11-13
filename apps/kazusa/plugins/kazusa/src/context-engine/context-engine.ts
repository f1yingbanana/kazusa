import { estimateTokens } from "openclaw/plugin-sdk/agent-core";
import { buildMemorySystemPromptAddition } from "openclaw/plugin-sdk/core";
import type { SessionCatalogTranscriptItem } from "openclaw/plugin-sdk/session-catalog";
import { readSessionTranscriptCatalogPage } from "openclaw/plugin-sdk/session-transcript-runtime";
import type { ContextEngineConfig } from "./config.ts";
import type { SkillLoader } from "./skill-loader.ts";
import type { ActiveTask } from "../taskman/types.ts";
import { personLabel } from "../person-label.ts";
import { createSkillText } from "../skill-text.ts";
import { renderToolHistory } from "./tool-history.ts";

import type { BrainTurn } from "@kazusa/client";
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
  readonly config: ContextEngineConfig;
  readonly skillLoader: SkillLoader;
  /** Past turns' tool calls in a turn: the system agent gets more. */
  readonly toolHistoryMaxTokens?: number;
  /** This brain session's turns, oldest first (`readBrainTurns`). */
  readonly brainTurns?: readonly BrainTurn[];
  /** The brain run under way, left out of them. */
  readonly runId?: string;
  /** Where last turn's records started (`recordsFrom`), to keep it cached. */
  readonly recordsFrom?: number;
  /**
   * The model's own window, which `run.tokenBudget` is reckoned from; the
   * world's `maxContextTokens` takes the difference off it.
   */
  readonly contextWindow?: number;
}): Promise<
  Awaited<ReturnType<ContextEngine["assemble"]>> & {
    /** Where these records start, for the next turn. */
    readonly recordsFrom?: number;
  }
> {
  const { config, run, skillLoader } = params;
  const resolutionContext = {
    agentId: params.agentId,
    workspaceDir: params.workspaceDir,
  };
  // The host leaves the model's whole window, less its own prompt and reply;
  // the world allows less. Without the window, the maximum alone applies.
  // `"unlimited"` leaves the host's budget: the model's whole window.
  const hostBudget = run.tokenBudget ?? Number.POSITIVE_INFINITY;
  const maximum = config.maxContextTokens;
  const budget = Math.max(
    0,
    maximum === "unlimited"
      ? hostBudget
      : params.contextWindow === undefined
        ? Math.min(hostBudget, maximum)
        : hostBudget - Math.max(0, params.contextWindow - maximum),
  );
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
  const inPerson = params.inCompany
    ? await skillLoader.loadSkill(config.skills.inPerson, resolutionContext)
    : undefined;
  const text = createSkillText(skillLoader);
  const deliveries = (
    section: string,
    values?: Readonly<Record<string, string | number>>,
  ): string => text(`kazusa-deliveries#${section}`, values, resolutionContext);

  // Only what is the same every turn, so the provider reuses the whole system
  // prompt and the records after it. The clock lives in the situation message,
  // never here.
  const systemPromptAddition = [
    baseConventions,
    buildMemorySystemPromptAddition({
      availableTools: run.availableTools ?? new Set(),
      citationsMode: run.citationsMode,
      agentId: params.agentId,
      agentSessionKey: run.sessionKey,
    }),
  ]
    .filter(Boolean)
    .join("\n\n");
  // The skills chosen by state change between turns, so they come after the
  // records, which grow every turn and are never reused past their end anyway.
  const guidance: Message = {
    role: "user",
    content: `[${formatSimTime(params.simTime)}]\n\n${[behavior, inPerson].filter(Boolean).join("\n\n")}`,
    timestamp: params.simTime,
  };
  const systemPromptTokens = estimateTokens({
    role: "user",
    content: systemPromptAddition,
    timestamp: params.simTime,
  });
  const skillTokens = systemPromptTokens + estimateTokens(guidance);
  if (skillTokens > budget) {
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
  if (skillTokens + situationTokens > budget) {
    throw new Error("Kazusa context budget cannot fit current activity.");
  }
  let remaining = budget - skillTokens - situationTokens;
  const brain = brainHistory(run.messages, run.prompt);
  const history = [...brain.summaries, ...brain.turn];
  remaining -= history.reduce(
    (sum, message) => sum + estimateTokens(message),
    0,
  );

  // How past turns called tools, so the same mistake isn't made twice. The run
  // under way is the model's already.
  const toolHistory = renderToolHistory(
    (params.brainTurns ?? []).filter((turn) => turn.id !== params.runId),
    Math.min(
      Math.max(0, remaining),
      params.toolHistoryMaxTokens ?? config.toolHistoryMaxTokens,
    ),
    deliveries,
  );
  const toolHistoryMessages: Message[] = toolHistory
    ? [
        {
          role: "user",
          content: `[${formatSimTime(params.simTime)}] ${toolHistory}`,
          timestamp: params.simTime,
        },
      ]
    : [];
  remaining -= toolHistoryMessages.reduce(
    (sum, message) => sum + estimateTokens(message),
    0,
  );

  // No source quotas or additional clipping beyond the native catalog's display
  // projection. Skip records that cannot fit rather than cutting their text.
  const records = renderLedgerRecords({
    sessionsContext: params.sessionsContext,
    simTime: params.simTime,
    cutoff: ledgerCutoff(
      params.simTime,
      config.shortTermHours,
      config.ledgerGridHours,
    ),
    tokenBudget:
      config.ledgerMaxTokens === "unlimited"
        ? remaining
        : Math.min(remaining, config.ledgerMaxTokens),
    trimTo: config.ledgerTrimTo,
    ...(params.recordsFrom === undefined
      ? {}
      : { keepFrom: params.recordsFrom }),
    text: deliveries,
  });

  // Leads with our own sim-time stamp: the host stamps any message without one,
  // in its own format.
  // Stamped with the day it starts, not now: an unchanging first line keeps the
  // whole block in the provider's cache, and any stamp stops the host's own.
  const stamp =
    records.from === undefined
      ? params.simTime
      : Math.floor(records.from / DAY_MS) * DAY_MS;
  const context: Message[] = records.text
    ? [
        {
          role: "user",
          content: `[${formatSimTime(stamp)}] ${deliveries("records", { records: records.text })}`,
          timestamp: stamp,
        },
      ]
    : [];
  // The host appends the pending turn after this history. Never replay ledger
  // records as assistant/tool messages or persist these synthetic context views.
  // The situation comes before the turn under way: last, it reads as a new
  // prompt after every tool result, and the model answers all over again.
  const messages = [
    ...context,
    guidance,
    ...toolHistoryMessages,
    ...brain.summaries,
    situation,
    ...brain.turn,
  ];
  return {
    messages,
    estimatedTokens:
      messages.reduce((sum, message) => sum + estimateTokens(message), 0) +
      systemPromptTokens,
    systemPromptAddition,
    ...(records.from === undefined ? {} : { recordsFrom: records.from }),
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
    const record = formatEnvelopeRecord({
      ...event,
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

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/**
 * Where the records begin: `hours` back, floored to a grid of `gridHours` so
 * the start moves once per step, not every turn, and the block stays in the
 * provider's cache in between.
 */
export function ledgerCutoff(
  simTime: number,
  hours: number,
  gridHours: number,
): number {
  const step = gridHours * HOUR_MS;
  return Math.floor((simTime - hours * HOUR_MS) / step) * step;
}

/** Fills a skill template's `{placeholders}` once, without rescanning values. */
function fill(
  template: string,
  values: Readonly<Record<string, string>>,
): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) =>
    key in values ? (values[key] ?? whole) : whole,
  );
}

type LedgerStreams = Readonly<
  Record<string, readonly SessionCatalogTranscriptItem[]>
>;

interface LedgerRecord {
  readonly sessionKey: string;
  readonly message: SessionCatalogTranscriptItem;
  readonly timestamp: number;
}

/** Readable records from `from` to `to`, oldest first, in the order shown. */
function ledgerRecords(
  sessionsContext: LedgerStreams,
  from: number,
  to: number,
): LedgerRecord[] {
  return Object.entries(sessionsContext)
    .flatMap(([sessionKey, messages]) =>
      messages.flatMap((message) => {
        const timestamp = Date.parse(message.timestamp ?? "");
        return (message.type === "userMessage" ||
          message.type === "agentMessage") &&
          message.text?.trim() &&
          Number.isFinite(timestamp) &&
          timestamp >= from &&
          timestamp <= to
          ? [{ sessionKey, message, timestamp }]
          : [];
      }),
    )
    .sort(
      (a, b) =>
        a.timestamp - b.timestamp || a.sessionKey.localeCompare(b.sessionKey),
    );
}

/**
 * Renders records as a character reads them, every line from
 * `kazusa-deliveries` (`text`, read once: rendering runs many times while
 * fitting a budget). People are their ids: names collide, ids don't.
 *
 * Grouped by where they happened, each chat (and `tasks`) whole and in order,
 * the one with the latest record last: interleaved by time, a conversation's
 * lines lay scattered through a day of every other chat, and characters said
 * again what they had said there minutes before. The chat being talked in is
 * usually the latest, so it sits last, by the delivery naming it, and stays
 * last turn after turn: everything above it is unchanged, which keeps the
 * provider's cache. Each group dates its first line and every new day.
 */
function ledgerRenderer(
  text: (section: string) => string,
): (records: readonly LedgerRecord[]) => string {
  const format = {
    day: text("records-day"),
    chat: text("records-chat"),
    record: text("record"),
    sameMinute: text("record-same-minute"),
    seen: text("record-seen"),
    you: text("record-you"),
    unknown: text("record-unknown"),
  };
  return (records) => {
    // Records come oldest first, so a group's place is its last record's.
    const streams = new Map<string, LedgerRecord[]>();
    for (const record of records) {
      const stream = streams.get(record.sessionKey) ?? [];
      stream.push(record);
      // Re-inserted, so the map's order is each group's latest record.
      streams.delete(record.sessionKey);
      streams.set(record.sessionKey, stream);
    }
    const lines: string[] = [];
    for (const [sessionKey, stream] of streams) {
      const header = formatSessionHeader(sessionKey);
      lines.push(fill(format.chat, { chat: header }));
      let day = "";
      let minute = "";
      for (const { message, timestamp } of stream) {
        const at = formatSimTime(timestamp);
        const date = at.slice(0, 14);
        const time = at.slice(15);
        if (date !== day) {
          lines.push(fill(format.day, { date }));
          day = date;
        }
        const words = message.text?.trim() ?? "";
        if (header === "tasks")
          lines.push(fill(format.seen, { time, text: words }));
        else {
          // The catalog projects __openclaw.senderIdentity into
          // sender.identity. Roles, dialogue, display names and peer keys are
          // never author evidence.
          const sender = message.sender?.identity.id;
          const who = !sender
            ? format.unknown
            : sender === sessionKey.split(":")[1]
              ? format.you
              : sender;
          lines.push(
            fill(at === minute ? format.sameMinute : format.record, {
              who,
              time,
              text: words,
            }),
          );
        }
        minute = at;
      }
    }
    return lines.join("\n");
  };
}

/**
 * Their records, oldest first, so new ones only ever append and the provider's
 * prompt cache survives. Everything since `cutoff` when it fits; otherwise last
 * turn's start (`keepFrom`) while it still fits, else cut back to `trimTo` of
 * the budget so the start holds again for a while. Whole records only, measured
 * as rendered (`ledgerRenderer`); `from` is when the first one shown happened,
 * the next turn's `keepFrom`.
 */
export function renderLedgerRecords(params: {
  readonly sessionsContext: LedgerStreams;
  readonly simTime: number;
  readonly cutoff: number;
  readonly tokenBudget: number;
  /** Share of the budget to cut back to when the records outgrow it. */
  readonly trimTo: number;
  /** Where last turn's records started. */
  readonly keepFrom?: number;
  /** A `kazusa-deliveries` section, by name. */
  readonly text: (section: string) => string;
}): { readonly text: string; readonly from?: number } {
  const { simTime, tokenBudget } = params;
  const records = ledgerRecords(params.sessionsContext, params.cutoff, simTime);
  if (records.length === 0) return { text: "" };
  const render = ledgerRenderer(params.text);
  const tokens = (from: readonly LedgerRecord[]): number =>
    estimateTokens({ role: "user", content: render(from), timestamp: simTime });
  // A record that could never fit is skipped, not cut, and hides nothing older.
  const fits = records.filter((record) => tokens([record]) <= tokenBudget);
  const fitsFrom = (start: number, budget = tokenBudget): boolean =>
    tokens(fits.slice(start)) <= budget;
  // The oldest start within a budget; dropping older records only shrinks the
  // rendering, so a binary search finds it.
  const oldestWithin = (budget: number): number => {
    let low = 0;
    let high = fits.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (fitsFrom(middle, budget)) high = middle;
      else low = middle + 1;
    }
    return low;
  };
  let start = 0;
  if (!fitsFrom(0)) {
    const keepFrom = params.keepFrom;
    const kept =
      keepFrom === undefined
        ? -1
        : fits.findIndex((record) => record.timestamp >= keepFrom);
    start =
      kept > 0 && fitsFrom(kept)
        ? kept
        : oldestWithin(tokenBudget * params.trimTo);
    // The newest record alone can be over the trimmed share.
    if (start >= fits.length) start = oldestWithin(tokenBudget);
  }
  const shown = fits.slice(start);
  return {
    text: render(shown),
    ...(shown[0] ? { from: shown[0].timestamp } : {}),
  };
}

/**
 * How far oldest-first records fit a budget, measured as they will be rendered:
 * the time to read up to, so whatever doesn't fit stays unread for next time
 * rather than being skipped. Records at one moment stay together. Always moves
 * forward, even if one record alone is over budget.
 */
export function ledgerWindowEnd(params: {
  readonly sessionsContext: LedgerStreams;
  readonly since: number;
  readonly now: number;
  readonly tokenBudget: number;
  /** A `kazusa-deliveries` section, by name, as `renderLedgerRecords` takes. */
  readonly text: (section: string) => string;
}): number {
  const records = ledgerRecords(
    params.sessionsContext,
    params.since,
    params.now,
  );
  if (records.length === 0) return params.now;
  const render = ledgerRenderer(params.text);
  const fitsTo = (end: number): boolean =>
    estimateTokens({
      role: "user",
      content: render(records.slice(0, end)),
      timestamp: params.now,
    }) <= params.tokenBudget;
  // The most records that fit; adding more only grows the rendering.
  let low = 1;
  let high = records.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (fitsTo(middle)) low = middle;
    else high = middle - 1;
  }
  let end = low;
  while (
    end < records.length &&
    records[end].timestamp === records[end - 1].timestamp
  )
    end++;
  return end === records.length ? params.now : records[end - 1].timestamp;
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
