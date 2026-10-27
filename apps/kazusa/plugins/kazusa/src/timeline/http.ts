import { listAgentIds } from "openclaw/plugin-sdk/agent-scope-runtime";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { readSessionTranscriptCatalogPage } from "openclaw/plugin-sdk/session-transcript-runtime";
import { parseAgentSessionKey } from "openclaw/plugin-sdk/routing";
import type {
  JournalEvent,
  JournalKind,
  TimelineResponse,
} from "@kazusa/client";
import { JOURNAL_KINDS } from "@kazusa/client";
import type { Clock } from "../clock/clock.ts";
import { createRouteRegistrar, sendJson } from "../http/helpers.ts";

interface RawKazusaMetadata {
  kind: JournalKind;
  payload: Record<string, unknown>;
}

function parseTaskStartedText(text: string): {
  type: string;
  description: string;
  endAt: number;
  duration: number;
  summary?: string;
  monologue?: string;
} | null {
  const monologueMatch = /\n\n> \*(.*)\*$/su.exec(text);
  const monologue = monologueMatch ? monologueMatch[1] : undefined;
  const clean = monologueMatch ? text.slice(0, monologueMatch.index) : text;

  const match =
    /(?:Concluded ([^ ]+) task\.(?: Summary: "([^"]+)"\.)? )?Started ([^ ]+) task: "([^"]+)"\. Scheduled to conclude at ([^ ]+) \((\d+) minutes\)\./u.exec(
      clean,
    );
  if (!match) return null;
  return {
    type: match[3],
    description: match[4],
    endAt: Date.parse(match[5]),
    duration: parseInt(match[6], 10),
    summary: match[2],
    monologue,
  };
}

function parseTaskDelayedText(text: string): {
  additionalMinutes: number;
  endAt: number;
  reason?: string;
  monologue?: string;
} | null {
  const monologueMatch = /\n\n> \*(.*)\*$/su.exec(text);
  const monologue = monologueMatch ? monologueMatch[1] : undefined;
  const clean = monologueMatch ? text.slice(0, monologueMatch.index) : text;

  const match =
    /Delayed current task by (\d+) minutes\. New completion time: ([^ ]+?)\.(?: Reason: (.*?)\.?)?$/u.exec(
      clean,
    );
  if (!match) return null;
  return {
    additionalMinutes: parseInt(match[1], 10),
    endAt: Date.parse(match[2]),
    reason: match[3],
    monologue,
  };
}

export function registerTimelineHttp(
  api: OpenClawPluginApi,
  deps: { readonly clock: Clock },
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
              key.rest.startsWith("chat:direct:") ||
              key.rest.startsWith("chat:group:"))
          );
        });

        for (const { sessionKey } of streams) {
          const isTasks = sessionKey.endsWith(":tasks");
          const page = await readSessionTranscriptCatalogPage({
            agentId,
            sessionKey,
            storePath,
            pluginId: api.id,
            sourceDomain: "kazusa",
            limit: Math.min(limit * 2, 200),
          });

          for (const item of page.items) {
            const timestamp = item.timestamp
              ? Date.parse(item.timestamp)
              : Number.NaN;
            if (Number.isNaN(timestamp)) continue;

            // 1. Process tasks stream
            if (isTasks) {
              const kazusa = (
                item.raw as { __openclaw?: { kazusa?: RawKazusaMetadata } }
              )?.__openclaw?.kazusa;
              if (kazusa && kazusa.kind && kazusa.payload) {
                rawEvents.push({
                  simTime: timestamp,
                  kind: kazusa.kind,
                  actors: [agentId],
                  payload: kazusa.payload,
                });
                continue;
              }

              // Fallback: parse from narrative text
              const text = item.text ?? "";
              const started = parseTaskStartedText(text);
              if (started) {
                rawEvents.push({
                  simTime: timestamp,
                  kind: "task.started",
                  actors: [agentId],
                  payload: {
                    taskId: `${agentId}:${timestamp}`,
                    type: started.type,
                    description: started.description,
                    duration: started.duration,
                    endAt: started.endAt,
                    summary: started.summary,
                    monologue: started.monologue,
                  },
                });
                continue;
              }

              const delayed = parseTaskDelayedText(text);
              if (delayed) {
                rawEvents.push({
                  simTime: timestamp,
                  kind: "task.delayed",
                  actors: [agentId],
                  payload: {
                    taskId: `${agentId}:${timestamp}`,
                    additionalMinutes: delayed.additionalMinutes,
                    endAt: delayed.endAt,
                    reason: delayed.reason,
                    monologue: delayed.monologue,
                  },
                });
                continue;
              }
            } else {
              // 2. Process chat stream
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
        }
      } catch {
        // Continue querying other agents if one fails
      }
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
      const entityId =
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
