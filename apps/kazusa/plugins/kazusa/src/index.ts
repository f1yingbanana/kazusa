import { listAgentIds } from "openclaw/plugin-sdk/agent-scope-runtime";
import {
  definePluginEntry,
  type OpenClawPluginApi,
} from "openclaw/plugin-sdk/core";
import type { CharacterStatus } from "@kazusa/client";
import { createDecisionContextAssembler } from "./context-engine/decision-sources.ts";
import { registerClock } from "./clock/register.ts";
import { registerClockHttp } from "./clock/http.ts";
import { registerContextEngine } from "./context-engine/register.ts";
import { registerPerception } from "./perception/register.ts";
import { registerDesires } from "./desires/register.ts";
import { registerDesiresHttp } from "./desires/http.ts";
import { registerTaskman } from "./taskman/register.ts";
import { registerMessaging } from "./messaging/register.ts";
import {
  registerCharactersHttp,
  resolveCharacterStatus,
} from "./characters/http.ts";
import {
  forwardClockOnce,
  nextJournalSeq,
  sharedBroadcaster,
} from "./realtime.ts";
import { registerTimelineHttp } from "./timeline/http.ts";

export default definePluginEntry({
  id: "kazusa",
  name: "Kazusa",
  description: "Core simulation plugin for Kazusa roleplay agents",
  register(api: OpenClawPluginApi): void {
    const broadcaster = sharedBroadcaster();
    const clock = registerClock(api);

    // Forward clock ticks and journal events to observer clients. The listener
    // only touches process-wide state, so it outlives this registration.
    forwardClockOnce(() =>
      clock.onClockChange((snapshot) => {
        broadcaster.broadcast({
          type: "clock",
          clock: {
            simTime: snapshot.simTime,
            speed: snapshot.speed,
            updatedAt: Date.now(),
          },
        });
        broadcaster.broadcast({
          type: "journal",
          event: {
            seq: nextJournalSeq(),
            simTime: snapshot.simTime,
            kind: "clock.changed",
            actors: [],
            payload: { speed: snapshot.speed },
          },
        });
      }),
    );

    registerClockHttp(api, clock);
    const desires = registerDesires(api, { clock });
    registerDesiresHttp(api, { desires, broadcaster });
    const taskman = registerTaskman(api, {
      clock,
      broadcaster,
      extensions: [desires.taskExtension],
    });
    const messagingRef: { current?: ReturnType<typeof registerMessaging> } = {};
    registerContextEngine(api, {
      clock,
      feelings: desires.feelings,
      // Only conversations the character actually read: an ignored message was
      // discarded and a deferred one has not been seen yet.
      awaitingReplies: async (agentId, since) =>
        (await messagingRef.current?.awaitingReplies(
          agentId,
          since,
          await perception.noticed(agentId),
        )) ?? [],
    });

    const assembleDecisionContext = createDecisionContextAssembler(api, {
      clock,
      chatFacts: async (agentId, sessionKeys) =>
        (await messagingRef.current?.chatFacts(agentId, sessionKeys)) ?? [],
    });
    const perception = registerPerception(api, {
      clock,
      assembleDecisionContext,
      broadcaster,
    });

    const stopSupervisor = taskman.attachSupervisor(perception);
    api.lifecycle.onDispose?.(stopSupervisor);

    registerTimelineHttp(api, {
      clock,
      decisions: () => perception.decisions(),
    });

    const getStatuses = async (): Promise<Record<string, CharacterStatus>> => {
      if (!messagingRef.current) return {};
      const roster = [...new Set(listAgentIds(api.config))];
      const statuses: Record<string, CharacterStatus> = {};
      await Promise.all(
        roster.map(async (id) => {
          try {
            statuses[id] = await resolveCharacterStatus(id, {
              taskStore: taskman.store,
              perception,
              messaging: messagingRef.current!,
            });
          } catch {
            // Ignore individual agent status failures
          }
        }),
      );
      return statuses;
    };

    const messaging = registerMessaging(api, {
      clock,
      perception,
      broadcaster,
      getStatuses,
    });
    messagingRef.current = messaging;

    registerCharactersHttp(api, {
      taskman,
      perception,
      messaging,
      broadcaster,
    });
  },
});
