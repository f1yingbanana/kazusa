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
import { brainRequest } from "./memory/retrieve.ts";
import { registerContextHttp } from "./context-engine/http.ts";
import { directDecisions } from "./decisions/direct.ts";
import { createJevProvider, gatewayJevDeps } from "./decisions/jev.ts";
import {
  createDecisionUsage,
  type DecisionUsageBucket,
} from "./decisions/usage.ts";
import { registerDecisionModelsHttp } from "./decisions/http.ts";
import { modelsConfig } from "./models/config.ts";
import { modelSelection } from "./models/selection.ts";
import { registerPerception } from "./perception/register.ts";
import {
  registerBrainHttp,
  registerBrainTraceHttp,
} from "./perception/http.ts";
import { registerDesires } from "./desires/register.ts";
import { registerDesiresHttp } from "./desires/http.ts";
import { registerLocation, type PlaceEdits } from "./location/register.ts";
import { registerLocationHttp } from "./location/http.ts";
import { registerWorldUpdate } from "./world-update/register.ts";
import { registerRepoSearch } from "./repo-search/register.ts";
import { registerMemory } from "./memory/register.ts";
import { registerModels } from "./models/register.ts";
import { registerProfile } from "./profile/register.ts";
import { registerProvidersHttp } from "./providers/http.ts";
import { registerSkills } from "./skills/register.ts";
import { registerTaskman } from "./taskman/register.ts";
import { registerMessaging } from "./messaging/register.ts";
import { registerWelcome } from "./messaging/welcome.ts";
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
import { registerUsageHttp } from "./usage/http.ts";
import { registerStage, stageControl } from "./stage/register.ts";
import { registerStickerHttp } from "./stickers/http.ts";
import { registerScene } from "./scene/http.ts";
import { createRouteRegistrar } from "./http/helpers.ts";
import { usesOfMessage } from "./memory/familiarity.ts";

export default definePluginEntry({
  id: "kazusa",
  name: "Kazusa",
  description: "Core simulation plugin for Kazusa roleplay agents",
  register(api: OpenClawPluginApi): void {
    rememberRegistration(api);
    const jev = gatewayJevDeps(api);
    const decisionUsage = createDecisionUsage(
      api.runtime.state.openKeyedStore<DecisionUsageBucket>({
        namespace: "decisions",
        retention: "retained",
      }),
      (error) => api.logger.warn(`Decision usage: ${String(error)}`),
    );
    const jevProvider = createJevProvider({
      ...jev,
      onUsage: decisionUsage.record,
    });
    // Still OpenClaw's configured decision model, but Kazusa calls it itself.
    api.registerDecisionProvider(jevProvider);
    const decide = directDecisions(jevProvider);
    registerDecisionModelsHttp(api, {
      selection: modelSelection(api),
      keyConfigured: jev.keyConfigured,
      config: modelsConfig(api.pluginConfig),
    });
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
    registerProvidersHttp(api);
    const desires = registerDesires(api, { clock });
    registerDesiresHttp(api, { desires, broadcaster });
    const contextRef: { current?: ReturnType<typeof registerContextEngine> } =
      {};
    const placesRef: { current?: PlaceEdits } = {};
    const memory = registerMemory(api, {
      clock,
      broadcaster,
      feelings: desires.feelings,
      modelOf: models.model,
      experiences: async (agentId, since, now) =>
        (await contextRef.current?.experiences(agentId, since, now)) ?? {
          text: "",
          speakers: [],
          through: now,
        },
      places: placesRef,
    });
    const location = registerLocation(api, {
      clock,
      evaluate: decide,
      broadcaster,
      stage,
      rememberedPlaces: memory.places,
      placeChanges: memory.placeChanges,
      visited: memory.visited,
      familiarity: memory.familiarity,
      use: memory.use,
    });
    placesRef.current = location.pages;
    const scene = registerScene(api, createRouteRegistrar(api));
    registerLocationHttp(api, { location, times: scene.times });
    registerWorldUpdate(api, { clock, location });
    registerRepoSearch(api);
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
      // Only conversations the character read: an ignored message was never
      // shown, and a deferred one has not been yet.
      awaitingReplies: async (agentId, since) =>
        (await messagingRef.current?.awaitingReplies(agentId, since)) ?? [],
    });
    contextRef.current = context;
    registerContextHttp(api);
    registerSkills(api);
    registerUsageHttp(api, decisionUsage);

    const assembleDecisionContext = createDecisionContextAssembler(api, {
      clock,
      chatFacts: async (agentId, sessionKeys) =>
        (await messagingRef.current?.chatFacts(agentId, sessionKeys)) ?? [],
      recollections: memory.recollections,
    });
    const perception = registerPerception(api, {
      clock,
      evaluateDecision: decide,
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
      realtime: async (agentId, item) =>
        item.sessionKey.includes(":chat:") &&
        ((await messagingRef.current?.isHuddle(agentId, item.sessionKey)) ??
          false),
      thinking: async (agentId) => (await models.read(agentId)).thinking,
      model: models.model,
      // The turn's first build waits for this embedding; start it at handoff.
      warm: (agentId, message) => {
        void taskman.store
          .lookup(agentId)
          .then((task) => {
            memory.warm(
              brainRequest({
                agentId,
                prompt: message,
                ...(task ? { task: task.description } : {}),
                now: clock.time(),
              }),
            );
          })
          .catch((error: unknown) => {
            api.logger.warn(
              `Memory: could not start ${agentId}'s embedding early: ${String(error)}`,
            );
          });
      },
    });
    registerBrainHttp(api);
    registerBrainTraceHttp(
      api,
      async (agentId) => (await perception.getBrainState(agentId)).failure,
    );
    location.attachPerception(perception);

    const stopSupervisor = taskman.attachSupervisor(perception);
    api.lifecycle.onDispose?.(stopSupervisor);

    registerTimelineHttp(api, {
      clock,
      decisions: (window) => perception.decisions(window),
      messages: async (window) =>
        (await messagingRef.current?.messageLog(window)) ?? [],
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
    // Talking with someone is what makes them familiar (`usesOfMessage`).
    api.lifecycle.onDispose?.(
      messaging.onEvent((event) => {
        if (event.type !== "message") return;
        const { sender, audience, timestamp } = event.delivery;
        for (const [agentId, ids] of usesOfMessage(sender, audience))
          void memory.use(agentId, ids, timestamp).catch((error: unknown) => {
            api.logger.warn(
              `Memory: can't note who ${agentId} talked with: ${String(error)}`,
            );
          });
      }),
    );
    registerWelcome(api, messaging);

    // Huddles live in Messaging; Location reads them for sightings and
    // `With you`, and takes people out of them when they walk away.
    location.attachConversations(messaging);

    registerProfile(api);
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
        forgetSightings: (id) => perception.forgetForeseen(id),
        enter: location.enter,
        reschedule: (id) => taskman.reschedule(id),
        resumeDesires: desires.resume,
        drain: (id) => perception.drain(id),
      }),
    });
    registerStickerHttp(api, createRouteRegistrar(api));
  },
});
