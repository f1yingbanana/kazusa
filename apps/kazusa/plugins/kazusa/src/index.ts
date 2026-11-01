import { rememberRegistration } from "./background.ts";
import { registerHostPromptEdits } from "./host-prompt.ts";
import { currentConfig } from "./current-config.ts";
import { listAgentIds } from "openclaw/plugin-sdk/agent-scope-runtime";
import {
  definePluginEntry,
  type OpenClawPluginApi,
} from "openclaw/plugin-sdk/core";
import type { CharacterStatus } from "@kazusa/client";
import { createDecisionContextAssembler } from "./context-engine/decision-sources.ts";
import { registerClock } from "./clock/register.ts";
import { DEFAULT_CAPABILITIES, registerClockHttp } from "./clock/http.ts";
import { registerContextEngine } from "./context-engine/register.ts";
import { registerContextHttp } from "./context-engine/http.ts";
import { createJevProvider } from "./decisions/jev.ts";
import { registerPerception } from "./perception/register.ts";
import { registerBrainHttp } from "./perception/http.ts";
import { registerDesires } from "./desires/register.ts";
import { registerDesiresHttp } from "./desires/http.ts";
import { registerLocation } from "./location/register.ts";
import { registerLocationHttp } from "./location/http.ts";
import { registerMemory } from "./memory/register.ts";
import { registerModels } from "./models/register.ts";
import { registerTaskman } from "./taskman/register.ts";
import { registerMessaging } from "./messaging/register.ts";
import {
  registerCharactersHttp,
  resolveCharacterStatus,
} from "./characters/http.ts";
import {
  forwardClockOnce,
  withJournalSeq,
  sharedBroadcaster,
} from "./realtime.ts";
import { registerTimelineHttp } from "./timeline/http.ts";
import { registerStage, stageControl } from "./stage/register.ts";

export default definePluginEntry({
  id: "kazusa",
  name: "Kazusa",
  description: "Core simulation plugin for Kazusa roleplay agents",
  register(api: OpenClawPluginApi): void {
    rememberRegistration(api);
    api.registerDecisionProvider(createJevProvider());
    registerHostPromptEdits(
      api,
      currentConfig(api).agents?.defaults?.systemAgent?.agentId,
    );
    const getConfig = () => currentConfig(api);
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
          event: withJournalSeq({
            simTime: snapshot.simTime,
            kind: "clock.changed",
            actors: [],
            payload: { speed: snapshot.speed },
          }),
        });
      }),
    );

    const stage = registerStage(api);
    const models = registerModels(api);
    const desires = registerDesires(api, { clock });
    registerDesiresHttp(api, { desires, broadcaster });
    const contextRef: { current?: ReturnType<typeof registerContextEngine> } =
      {};
    const memory = registerMemory(api, {
      clock,
      broadcaster,
      feelings: desires.feelings,
      modelOf: async (agentId) => (await models.read(agentId)).model,
      experiences: async (agentId, since, now) =>
        (await contextRef.current?.experiences(agentId, since, now)) ?? {
          text: "",
          speakers: [],
          through: now,
        },
    });
    const location = registerLocation(api, {
      clock,
      broadcaster,
      stage,
      rememberedPlaces: memory.places,
      placeChanges: memory.placeChanges,
      visited: memory.visited,
    });
    registerLocationHttp(api, { location });
    // On unless a world turns it off: observing is what the client is for.
    const observer =
      (api.pluginConfig?.observer as { enabled?: boolean } | undefined)
        ?.enabled !== false;
    // A world without places has no positions to serve.
    registerClockHttp(api, clock, {
      getCapabilities: () => ({
        ...DEFAULT_CAPABILITIES,
        ...(observer ? {} : ({ observe: "unavailable" } as const)),
        ...(location.world
          ? ({ places: "live", location: "live" } as const)
          : {}),
      }),
    });
    const taskman = registerTaskman(api, {
      clock,
      broadcaster,
      extensions: [
        desires.taskExtension,
        memory.sleep.taskExtension,
        ...(location.taskExtension ? [location.taskExtension] : []),
      ],
      stage,
    });
    const messagingRef: { current?: ReturnType<typeof registerMessaging> } = {};
    const context = registerContextEngine(api, {
      clock,
      feelings: desires.feelings,
      whereabouts: location.whereabouts,
      inCompany: location.inCompany,
      presence: location.presence,
      memory: memory.prefetch,
      // Only conversations the character actually read: an ignored message was
      // discarded and a deferred one has not been seen yet.
      awaitingReplies: async (agentId, since) =>
        (await messagingRef.current?.awaitingReplies(
          agentId,
          since,
          await perception.noticed(agentId),
        )) ?? [],
    });
    contextRef.current = context;
    registerContextHttp(api, { context });

    const assembleDecisionContext = createDecisionContextAssembler(api, {
      clock,
      chatFacts: async (agentId, sessionKeys) =>
        (await messagingRef.current?.chatFacts(agentId, sessionKeys)) ?? [],
      recollections: memory.recollections,
    });
    const perception = registerPerception(api, {
      clock,
      assembleDecisionContext,
      broadcaster,
      // The wake turn should see the morning's memory, within reason.
      onDeadline: async (agentId) => {
        await memory.sleep.settled(agentId);
        return location.settle(agentId);
      },
      onAwoken: memory.sleep.wake,
      confirm: location.confirm,
      onstage: (agentId) => stage.isOnstage(agentId),
      realtime: async (agentId, item) => {
        if (!item.sessionKey.includes(":chat:")) return false;
        return (
          (
            await messagingRef.current?.chatFacts(agentId, [item.sessionKey])
          )?.some((chat) => chat.kind === "huddle") ?? false
        );
      },
      thinking: async (agentId) => (await models.read(agentId)).thinking,
    });
    registerBrainHttp(api);
    location.attachPerception(perception);

    const stopSupervisor = taskman.attachSupervisor(perception);
    api.lifecycle.onDispose?.(stopSupervisor);

    registerTimelineHttp(api, {
      clock,
      decisions: () => perception.decisions(),
      messages: async () => (await messagingRef.current?.messageLog()) ?? [],
    });

    const getStatuses = async (): Promise<Record<string, CharacterStatus>> => {
      if (!messagingRef.current) return {};
      const roster = [...new Set(listAgentIds(getConfig()))];
      const statuses: Record<string, CharacterStatus> = {};
      await Promise.all(
        roster.map(async (id) => {
          try {
            statuses[id] = await resolveCharacterStatus(id, {
              taskStore: taskman.store,
              perception,
              messaging: messagingRef.current!,
              stage,
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
      placeOf: location.placeOf,
      broadcaster,
      getStatuses,
      observer,
    });
    messagingRef.current = messaging;

    // Huddles live in Messaging; Location reads them for sightings and
    // `With you`, and takes people out of them when they walk away.
    location.attachConversations(messaging);

    registerCharactersHttp(api, {
      taskman,
      perception,
      messaging,
      broadcaster,
      stage,
      setOnstage: stageControl({
        stage,
        clock,
        interrupt: (id) => {
          messaging.interrupt(id);
        },
        exit: location.exit,
        enter: location.enter,
        reschedule: (id) => taskman.reschedule(id),
        resumeDesires: desires.resume,
        drain: (id) => perception.drain(id),
      }),
    });
  },
});
