import {
  SYSTEM_AGENT_CONFIG,
  systemAgent,
  systemAgentOf,
} from "./system-agent.ts";
import { createHandBack } from "./stage/hand-back.ts";
import { inBackground, rememberRegistration } from "./background.ts";
import { registerHostPromptEdits } from "./host-prompt.ts";
import { currentConfig } from "./current-config.ts";
import { readdirSync } from "node:fs";
import path from "node:path";
import { listAgentIds } from "openclaw/plugin-sdk/agent-scope-runtime";
import { runMigrations, type MigrationRecord } from "./migrations/index.ts";
import { playAsMigration } from "./migrations/0082-play-as.ts";
import { worldWikiDir } from "./characters/card.ts";
import { cachedStore } from "./state.ts";
import type { StatRecord } from "@kazusa/client";
import type { LocationRecord } from "./location/location.ts";
import type { FamiliarityRecord } from "./memory/familiarity.ts";
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
import { roomForSleep } from "./perception/run-limits.ts";
import { beginGatewayLifetime, followGatewayLifetime } from "./shutdown.ts";
import {
  registerBrainHttp,
  registerBrainTraceHttp,
} from "./perception/http.ts";
import { registerDesires } from "./desires/register.ts";
import { registerDesiresHttp } from "./desires/http.ts";
import { registerStats } from "./stats/register.ts";
import { registerStatsHttp } from "./stats/http.ts";
import { registerLocation, type PlaceEdits } from "./location/register.ts";
import { registerLocationHttp } from "./location/http.ts";
import { registerWorldUpdate } from "./world-update/register.ts";
import { registerRepoSearch } from "./repo-search/register.ts";
import { registerMemory } from "./memory/register.ts";
import { OFFER_CHARS } from "./memory/sleep.ts";
import { registerModels } from "./models/register.ts";
import { registerProfile } from "./profile/register.ts";
import { registerWikiEditor } from "./editor/register.ts";
import { registerCharacterCard } from "./characters/card.ts";
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
import { playControl, registerStage, stageControl } from "./stage/register.ts";
import { createPlayer } from "./player.ts";
import { CONTEXT_ENGINE_CONFIG } from "./context-engine/config.ts";
import { stopBrainRuns } from "./perception/run-limits.ts";
import { characterName } from "./identity.ts";
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
    beginGatewayLifetime();
    // A stop through the host's stdin lifeline sends no process signal; this
    // is how anything waiting on a paused clock hears of it.
    api.on("gateway_start", (_event, ctx) =>
      followGatewayLifetime(ctx.abortSignal),
    );
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
    registerHostPromptEdits(api, systemAgentOf(currentConfig(api)));
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

    // A console linked to someone who isn't in the cast is its own persona:
    // said once, so a typo in the world's config doesn't pass unnoticed.
    api.on("gateway_start", () => {
      const { is } = SYSTEM_AGENT_CONFIG.parse(
        (api.pluginConfig as { systemAgent?: unknown } | undefined)
          ?.systemAgent ?? {},
      );
      if (is && !systemAgent(api).linked())
        api.logger.warn(
          `systemAgent.is names "${is}", who isn't a character in the cast: the console stays its own persona.`,
        );
    });
    const stage = registerStage(api);
    // The person at the keyboard and who they play; read once at start-up so
    // a stream's events can be filtered synchronously from then on.
    const player = createPlayer(api, stage);
    api.on("gateway_start", () => {
      void player.playing().catch((error: unknown) => {
        api.logger.warn(`Who is played couldn't be read: ${String(error)}`);
      });
    });
    const models = registerModels(api);
    registerProvidersHttp(api);
    const desires = registerDesires(api, { clock });
    registerDesiresHttp(api, { desires, broadcaster });
    const stats = registerStats(api, { clock, broadcaster });
    registerStatsHttp(api, { stats, clock });
    const placesRef: { current?: PlaceEdits } = {};
    const sleepTurnRef: {
      current?: (agentId: string, text: string) => Promise<void>;
    } = {};
    const memory = registerMemory(api, {
      clock,
      broadcaster,
      states: stats.review,
      room: roomForSleep,
      turn: sleepTurnRef,
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
    registerLocationHttp(api, { location, times: scene.times, player });
    registerWorldUpdate(api, { clock, location, broadcaster });
    registerRepoSearch(api);
    // On unless a world turns it off: observing is what the client is for.
    const observer =
      (api.pluginConfig?.observer as { enabled?: boolean } | undefined)
        ?.enabled !== false;
    // A world without places has no positions to serve.
    registerClockHttp(api, clock, {
      player,
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
        stats.taskExtension,
        memory.sleep.taskExtension,
        ...(location.taskExtension ? [location.taskExtension] : []),
      ],
      stage,
    });
    const messagingRef: { current?: ReturnType<typeof registerMessaging> } = {};
    registerContextEngine(api, {
      clock,
      feelings: desires.feelings,
      states: stats.situation,
      whereabouts: location.whereabouts,
      inCompany: location.inCompany,
      presence: location.presence,
      memory: memory.prefetch,
      // Only conversations the character read: an ignored message was never
      // shown, and a deferred one has not been yet.
      awaitingReplies: async (agentId, since) =>
        (await messagingRef.current?.awaitingReplies(agentId, since)) ?? [],
      player,
    });
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
      // The night a run went over ends with it (`memory/sleep.ts`).
      onRunStarted: memory.sleep.runStarted,
      onRunEnded: memory.sleep.runEnded,
      confirm: location.confirm,
      onstage: (agentId) => stage.isOnstage(agentId),
      played: (agentId) => stage.isPlayed(agentId),
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
    // A night asked for by hand: a turn of their own, like a job's next run.
    sleepTurnRef.current = (agentId, text) =>
      perception.receive(agentId, {
        id: `sleep:${agentId}:${clock.time()}`,
        sessionKey: `agent:${agentId}:tasks`,
        sender: "kazusa:memory",
        // A stimulus holds this much; what a night shows is budgeted under it.
        text: text.slice(0, OFFER_CHARS),
        idle: true,
        resume: true,
        timestamp: clock.time(),
      });

    const stopSupervisor = taskman.attachSupervisor(perception);
    api.lifecycle.onDispose?.(stopSupervisor);
    // When someone's activity ends: the check-in for it.
    const stopWaking = taskman.wakeWith((agentId) => {
      inBackground(
        api,
        async () => {
          await clock.init();
          const note = await location
            .settle(agentId)
            .catch((error: unknown) => {
              api.logger.warn(`Location settle: ${String(error)}`);
              return undefined;
            });
          await perception.deadline(agentId, note);
        },
        (error) =>
          api.logger.warn(
            `Taskman: waking ${agentId} failed: ${String(error)}`,
          ),
      );
    });
    api.lifecycle.onDispose?.(stopWaking);

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
      wearing: stats.wearing,
      player,
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

    // A world character lives by their World Wiki page, which the Wiki edits
    // with their memory, looks, stickers and the world's backdrops.
    registerCharacterCard(api);
    registerWikiEditor(api, { places: () => location.world?.map.places });

    // Huddles live in Messaging; Location reads them for sightings and
    // `With you`, and takes people out of them when they walk away.
    location.attachConversations(messaging);

    registerProfile(api);
    const setOnstage = stageControl({
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
    });
    const contextConfig = CONTEXT_ENGINE_CONFIG.parse(
      api.pluginConfig?.contextEngine ?? {},
    );
    const play = playControl({
      stage,
      clock,
      bringOn: (id, person) => setOnstage(id, true, [], person),
      stop: (id) => {
        stopBrainRuns(id, "a person took them over");
        messaging.interrupt(id);
      },
      // In order, each on its own: one failing (a database still starting)
      // never leaves the others undone; the failures are said together.
      endActivity: async (id, at) => {
        const failed: unknown[] = [];
        for (const end of [
          () => location.halt(id),
          () => taskman.end(id, at),
          () => desires.settle(id, at),
        ])
          await end().catch((error: unknown) => failed.push(error));
        if (failed.length)
          throw new AggregateError(failed, failed.map(String).join("; "));
      },
      reschedule: (id) => taskman.reschedule(id),
      resumeDesires: desires.resume,
      drain: (id) => perception.takeOver(id),
      handBack: createHandBack({
        messageLog: (window) => messaging.messageLog(window),
        nameOf: (id) => characterName(api, getConfig(), id).catch(() => id),
        time: () => clock.time(),
        movedSince: async (id, since) =>
          ((await location.record(id))?.since ?? 0) > since,
        idleWake: (id) => perception.idleWake(id),
        lookBack: (id, lines) => memory.sleep.lookBack(id, lines),
        recordsReachMs:
          (contextConfig.shortTermHours - contextConfig.ledgerGridHours) *
          3_600_000,
      }),
      changed: () => {
        void player
          .playing()
          .then((actor) =>
            broadcaster.broadcast({ type: "player", player: actor ?? null }),
          );
      },
      warn: (message) => api.logger.warn(message),
    });
    // The world's first start: who the setup guide picked to play, once. Any
    // later start leaves who is played (nobody included) as it was.
    api.on("gateway_start", () => {
      const first = player.operator.defaultCharacter;
      if (!first) return;
      void (async () => {
        if (!(await stage.untouched())) return;
        await play(player.operator.id, first);
      })().catch((error: unknown) => {
        api.logger.warn(`Couldn't start as ${first}: ${String(error)}`);
      });
    });
    // What this world's data needs from earlier releases, once each, in order
    // (`migrations/`, one file per pull request).
    api.on("gateway_start", () => {
      const config = getConfig();
      const console = systemAgentOf(config);
      void runMigrations(
        [
          playAsMigration({
            operator: player.operator,
            worldWiki: worldWikiDir(api),
            // Every workspace on disk, in the cast or not yet.
            ownWikis: () => {
              const homes = new Set(
                listAgentIds(getConfig()).map((id) =>
                  path.dirname(
                    api.runtime.agent.resolveAgentWorkspaceDir(getConfig(), id),
                  ),
                ),
              );
              return [...homes].flatMap((home) =>
                readdirSync(home, { withFileTypes: true })
                  .filter((entry) => entry.isDirectory())
                  .map((entry) => path.join(home, entry.name, "wiki")),
              );
            },
            isAgent: (id) => listAgentIds(getConfig()).includes(id),
            stats: api.runtime.state.openKeyedStore<StatRecord>({
              namespace: "stats",
              retention: "retained",
            }),
            locations: cachedStore(
              "location",
              api.runtime.state.openKeyedStore<LocationRecord>({
                namespace: "location",
                retention: "retained",
              }),
            ),
            familiarity: cachedStore(
              "familiarity",
              api.runtime.state.openKeyedStore<FamiliarityRecord>({
                namespace: "familiarity",
                retention: "retained",
              }),
            ),
            oldChats: async () =>
              (await messaging.listChats(player.operator.id)).filter(
                (chat) =>
                  !(
                    chat.members.length === 2 &&
                    console &&
                    chat.members.includes(console)
                  ),
              ).length,
            playing: () => stage.playing(player.operator.id),
            play: (id) => play(player.operator.id, id),
          }),
        ],
        api.runtime.state.openKeyedStore<MigrationRecord>({
          namespace: "migrations",
          retention: "retained",
        }),
        api.logger,
      );
    });
    registerCharactersHttp(api, {
      taskman,
      perception,
      messaging,
      broadcaster,
      stage,
      setOnstage,
      player,
      play,
    });
    registerStickerHttp(api, createRouteRegistrar(api));
  },
});
