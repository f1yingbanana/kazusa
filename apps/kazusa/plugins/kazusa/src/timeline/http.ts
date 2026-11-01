import { currentConfig } from "../current-config.ts";
import { listAgentIds } from "openclaw/plugin-sdk/agent-scope-runtime";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { readVisibleSessionTranscriptMessageEntries } from "openclaw/plugin-sdk/session-transcript-runtime";
import { parseAgentSessionKey } from "openclaw/plugin-sdk/routing";
import type {
  JournalEvent,
  JournalKind,
  TimelineResponse,
} from "@kazusa/client";
import { JOURNAL_KINDS } from "@kazusa/client";
import type { Clock } from "../clock/clock.ts";
import {
  messageJournal,
  type MessageDelivery,
} from "../messaging/messaging.ts";
import type { PerceptionDecisionRecord } from "../perception/types.ts";
import { createRouteRegistrar, sendJson } from "../http/helpers.ts";
import {
  journalKey,
  ledgerJournal,
  loadLedgerJournal,
  withJournalSeq,
  type LedgerJournalRow,
} from "../realtime.ts";

interface RawKazusaMetadata {
  kind: JournalKind;
  payload: Record<string, unknown>;
}

export function registerTimelineHttp(
  api: OpenClawPluginApi,
  deps: {
    readonly clock: Clock;
    /** Perception's recorded attention decisions (the "perception" store). */
    readonly decisions?: () => Promise<
      ReadonlyArray<{
        readonly agentId: string;
        readonly record: PerceptionDecisionRecord;
      }>
    >;
    /** Canonical messages: one row each, however many ledgers hold a copy. */
    readonly messages?: () => Promise<readonly MessageDelivery[]>;
  },
): void {
  const getConfig = () => currentConfig(api);
  const route = createRouteRegistrar(api);

  route("timeline", "GET", async (req, res) => {
    await deps.clock.init();
    const url = new URL(req.url ?? "/", "http://localhost");
    const query = url.searchParams;

    const before = query.get("before")
      ? parseInt(query.get("before")!, 10)
      : undefined;
    const after = query.get("after")
      ? parseInt(query.get("after")!, 10)
      : undefined;
    const limit = Math.min(
      query.get("limit") ? parseInt(query.get("limit")!, 10) : 50,
      500,
    );

    const actorsFilter = query.get("actors")
      ? query
          .get("actors")!
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined;
    const kindsFilter = query.get("kinds")
      ? query
          .get("kinds")!
          .split(",")
          .map((s) => s.trim())
          .filter((k): k is JournalKind =>
            (JOURNAL_KINDS as readonly string[]).includes(k),
          )
      : undefined;

    // Clients hide messages by default; skip reading them all then.
    const wantsMessages =
      !kindsFilter?.length || kindsFilter.includes("message.sent");

    const allAgentIds = [...new Set(listAgentIds(getConfig()))];
    const targetAgents = actorsFilter
      ? allAgentIds.filter((id) => actorsFilter.includes(id))
      : allAgentIds;

    const sessionsApi = api.runtime.agent.session;
    interface RawJournalItem {
      simTime: number;
      kind: JournalKind;
      actors: string[];
      chatId?: string;
      payload: Record<string, unknown>;
    }
    const rawEvents: RawJournalItem[] = [];

    const readLedger = async (agentId: string): Promise<LedgerJournalRow[]> => {
      const storePath = sessionsApi.resolveStorePath(
        getConfig().session?.store,
        { agentId },
      );
      const readSessions = await sessionsApi.createSessionEntryListReader({
        agentId,
        storePath,
      });
      const snapshot = await readSessions();
      const found: LedgerJournalRow[] = [];
      for (const { sessionKey, entry } of snapshot.entries) {
        const key = parseAgentSessionKey(sessionKey);
        if (key?.agentId !== agentId || key.rest !== "tasks") continue;
        // The catalog projection drops `__openclaw`, where each row carries
        // its structured journal metadata, so read raw message entries
        // instead. Ledger text is narrative for characters and is never
        // parsed for fields.
        const sessionId = entry.sessionId?.trim();
        if (!sessionId) continue;
        const rows = await readVisibleSessionTranscriptMessageEntries({
          agentId,
          sessionKey,
          sessionId,
          storePath,
        });
        for (const { message } of rows) {
          const timestamp = message.timestamp;
          if (typeof timestamp !== "number" || !Number.isFinite(timestamp))
            continue;
          const kazusa = message.__openclaw?.kazusa as
            RawKazusaMetadata | undefined;
          if (!kazusa?.kind || !kazusa.payload) continue;
          found.push({
            simTime: timestamp,
            kind: kazusa.kind,
            payload: kazusa.payload,
          });
        }
      }
      return found;
    };

    for (const agentId of targetAgents) {
      try {
        await loadLedgerJournal(agentId, () => readLedger(agentId));
        for (const row of ledgerJournal(agentId))
          rawEvents.push({ ...row, actors: [agentId] });
      } catch (error: unknown) {
        // Continue querying other agents if one fails, but say why.
        api.logger.warn(
          `Timeline read failed for ${agentId}: ${String(error)}`,
        );
      }
    }

    if (wantsMessages) {
      try {
        const targets = new Set(targetAgents);
        for (const delivery of (await deps.messages?.()) ?? []) {
          const row = messageJournal(delivery);
          if (!actorsFilter || row.actors.some((id) => targets.has(id)))
            rawEvents.push(row);
        }
      } catch (error: unknown) {
        api.logger.warn(`Timeline message read failed: ${String(error)}`);
      }
    }

    // Attention decisions are machine records in the "perception" store, not a
    // ledger: nothing character-facing ever reads them.
    try {
      const targets = new Set(targetAgents);
      for (const { agentId, record } of (await deps.decisions?.()) ?? []) {
        if (!targets.has(agentId)) continue;
        const { simTime, wallTime: _wallTime, ...payload } = record;
        rawEvents.push({
          simTime,
          kind: "attention.decided",
          actors: [agentId],
          payload,
        });
      }
    } catch (error: unknown) {
      api.logger.warn(`Timeline decision read failed: ${String(error)}`);
    }

    // Apply filtering
    let filtered = rawEvents;
    if (kindsFilter?.length) {
      filtered = filtered.filter((e) => kindsFilter.includes(e.kind));
    }
    if (before !== undefined) {
      filtered = filtered.filter((e) => e.simTime < before);
    }
    if (after !== undefined) {
      filtered = filtered.filter((e) => e.simTime > after);
    }

    // A row read while the same row was appended is listed twice.
    const unique = new Map<string, RawJournalItem>();
    for (const e of filtered) {
      const key = journalKey(e);
      if (!unique.has(key)) unique.set(key, e);
    }

    // Newest first.
    const journalEvents = [...unique.values()]
      .map((e) => withJournalSeq(e))
      .sort((a, b) => b.seq - a.seq) as JournalEvent[];

    const sliced = journalEvents.slice(0, limit);
    const hasMore = journalEvents.length > limit;
    const nextCursor =
      hasMore && sliced.length > 0
        ? sliced[sliced.length - 1].simTime
        : undefined;

    sendJson(res, 200, {
      events: sliced,
      nextCursor,
      hasMore,
    } satisfies TimelineResponse);
  });
}
