import { listAgentIds } from "openclaw/plugin-sdk/agent-scope-runtime";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import {
  readSessionTranscriptCatalogPage,
  readVisibleSessionTranscriptMessageEntries,
} from "openclaw/plugin-sdk/session-transcript-runtime";
import { parseAgentSessionKey } from "openclaw/plugin-sdk/routing";
import type {
  JournalEvent,
  JournalKind,
  TimelineResponse,
} from "@kazusa/client";
import { JOURNAL_KINDS } from "@kazusa/client";
import type { Clock } from "../clock/clock.ts";
import type { PerceptionDecisionRecord } from "../perception/types.ts";
import { createRouteRegistrar, sendJson } from "../http/helpers.ts";

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
  },
): void {
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

    // Clients hide messages by default; skip reading every chat ledger then.
    const wantsMessages =
      !kindsFilter?.length || kindsFilter.includes("message.sent");

    const allAgentIds = [...new Set(listAgentIds(api.config))];
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

    // Read sessions for each target agent
    for (const agentId of targetAgents) {
      try {
        const storePath = sessionsApi.resolveStorePath(
          api.config.session?.store,
          { agentId },
        );
        const readSessions = await sessionsApi.createSessionEntryListReader({
          agentId,
          storePath,
        });
        const snapshot = await readSessions();

        const streams = snapshot.entries.filter(({ sessionKey }) => {
          const key = parseAgentSessionKey(sessionKey);
          return (
            key?.agentId === agentId &&
            (key.rest === "tasks" ||
              (wantsMessages &&
                (key.rest.startsWith("chat:direct:") ||
                  key.rest.startsWith("chat:group:") ||
                  key.rest.startsWith("chat:huddle:"))))
          );
        });

        for (const { sessionKey, entry } of streams) {
          const isLedger = sessionKey.endsWith(":tasks");
          const rowLimit = Math.min(limit * 2, 200);

          // 1. Task ledger. The catalog projection drops
          // `__openclaw`, where each row carries its structured journal
          // metadata, so read raw message entries instead. Ledger text is
          // narrative for characters and is never parsed for fields.
          if (isLedger) {
            const sessionId = entry.sessionId?.trim();
            if (!sessionId) continue;
            const rows = await readVisibleSessionTranscriptMessageEntries({
              agentId,
              sessionKey,
              sessionId,
              storePath,
            });
            for (const { message } of rows.slice(-rowLimit)) {
              const timestamp = message.timestamp;
              if (typeof timestamp !== "number" || !Number.isFinite(timestamp))
                continue;
              const kazusa = message.__openclaw?.kazusa as
                RawKazusaMetadata | undefined;
              if (!kazusa?.kind || !kazusa.payload) continue;
              rawEvents.push({
                simTime: timestamp,
                kind: kazusa.kind,
                actors: [agentId],
                payload: kazusa.payload,
              });
            }
            continue;
          }

          // 2. Chat streams
          const page = await readSessionTranscriptCatalogPage({
            agentId,
            sessionKey,
            storePath,
            pluginId: api.id,
            sourceDomain: "kazusa",
            limit: rowLimit,
          });
          for (const item of page.items) {
            const timestamp = item.timestamp
              ? Date.parse(item.timestamp)
              : Number.NaN;
            if (Number.isNaN(timestamp)) continue;
            const sender = item.sender?.identity.id ?? agentId;
            rawEvents.push({
              simTime: timestamp,
              kind: "message.sent",
              actors: [sender, agentId],
              payload: {
                messageId: item.id ?? `msg:${timestamp}`,
                sequence: 0,
                senderId: sender,
                preview: (item.text ?? "").slice(0, 100),
              },
            });
          }
        }
      } catch (error: unknown) {
        // Continue querying other agents if one fails, but say why.
        api.logger.warn(
          `Timeline read failed for ${agentId}: ${String(error)}`,
        );
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

    // Deduplicate and sort chronologically ascending to assign monotonic seq
    const unique = new Map<string, RawJournalItem>();
    for (const e of filtered) {
      // Attention decisions share a task (and, while paused, a sim time);
      // their stimuli tell them apart.
      const entityId =
        (Array.isArray(e.payload.stimulusIds)
          ? e.payload.stimulusIds.join(",")
          : "") ||
        (typeof e.payload.taskId === "string" ? e.payload.taskId : "") ||
        (typeof e.payload.messageId === "string" ? e.payload.messageId : "");
      const key = `${e.kind}:${e.actors.join(",")}:${e.simTime}:${entityId}`;
      if (!unique.has(key)) unique.set(key, e);
    }

    const sortedAsc = [...unique.values()].sort(
      (a, b) => a.simTime - b.simTime,
    );

    const journalEvents = sortedAsc.map((e, index) => ({
      seq: e.simTime * 100 + (index % 100),
      simTime: e.simTime,
      kind: e.kind,
      actors: e.actors,
      ...(e.chatId ? { chatId: e.chatId } : {}),
      payload: e.payload,
    })) as JournalEvent[];

    // Sort newest-first for response
    journalEvents.sort((a, b) => b.seq - a.seq);

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
