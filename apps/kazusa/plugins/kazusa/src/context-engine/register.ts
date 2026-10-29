import { currentConfig } from "../current-config.ts";
import { estimateTokens } from "openclaw/plugin-sdk/agent-core";
import {
  buildMemorySystemPromptAddition,
  delegateCompactionToRuntime,
  type OpenClawPluginApi,
  type OpenClawConfig,
} from "openclaw/plugin-sdk/core";
import { parseAgentSessionKey } from "openclaw/plugin-sdk/routing";
import type { AssembledContext } from "@kazusa/client";
import type { Clock } from "../clock/clock.ts";
import type { StateStore } from "../state.ts";
import { CONTEXT_ENGINE_CONFIG } from "./config.ts";
import {
  assembleContext,
  readSessionStreams,
  type ContextEngine,
} from "./context-engine.ts";
import { createSkillLoader } from "./skill-loader.ts";
import { readPersonalWiki } from "./decision-sources.ts";
import type { ActiveTask } from "../taskman/types.ts";
import type { AwaitingReply } from "../messaging/messaging.ts";
import { personName } from "../identity.ts";

interface ContextEngineDeps {
  readonly clock: Clock;
  /** Canonical "glance at the phone" view; absent until Messaging exists. */
  readonly awaitingReplies?: (
    agentId: string,
    since: number,
  ) => Promise<readonly AwaitingReply[]>;
  /** Desires' `How you feel` line; absent until Desires exists. */
  readonly feelings?: (agentId: string, at: number) => Promise<string>;
  /**
   * Location's `Where you are` lines; absent for a world without places.
   * `evidence` is this turn's input, so places it names come to mind.
   */
  readonly whereabouts?: (
    agentId: string,
    at: number,
    evidence: string,
  ) => Promise<string | undefined>;
  /** Whether someone else is where the character is: face to face. */
  readonly inCompany?: (agentId: string, at: number) => Promise<boolean>;
}

/**
 * Wire host lifecycle and session I/O; selection and skill expansion stay in
 * the engine.
 */
/** How many brain turns' contexts are kept per character, for observers. */
const RECENT_CONTEXTS = 20;

export interface ContextEngineService {
  /** A character's last brain turns' contexts, newest first. */
  readonly recentContexts: (agentId: string) => Promise<AssembledContext[]>;
}

export function registerContextEngine(
  api: OpenClawPluginApi,
  deps: ContextEngineDeps,
): ContextEngineService {
  const getConfig = () => currentConfig(api);
  // What each brain turn was given, which no transcript keeps.
  const recent = api.runtime.state.openKeyedStore<AssembledContext[]>({
    namespace: "context",
    retention: "retained",
  });
  api.registerContextEngine("kazusa", () =>
    createContextEngine(api, deps, recent, getConfig),
  );
  return {
    recentContexts: async (agentId) => (await recent.lookup(agentId)) ?? [],
  };
}

function createContextEngine(
  api: OpenClawPluginApi,
  {
    clock,
    awaitingReplies,
    feelings,
    whereabouts,
    inCompany,
  }: ContextEngineDeps,
  recent: StateStore<AssembledContext[]>,
  getConfig: () => OpenClawConfig,
): ContextEngine {
  const config = CONTEXT_ENGINE_CONFIG.parse(
    api.pluginConfig?.contextEngine ?? {},
  );
  const skillLoader = createSkillLoader({
    config: getConfig(),
    pluginRootDir: api.rootDir,
  });
  const tasks = api.runtime.state.openKeyedStore<ActiveTask>({
    namespace: "tasks",
    retention: "retained",
  });
  return {
    info: {
      id: "kazusa",
      name: "Kazusa character context",
      ownsCompaction: false,
      hostRequirements: {
        "agent-run": { requiredCapabilities: ["assemble-before-prompt"] },
      },
      transcriptSemantics: {
        currentTurnFence: "before-current-turn-entry-v1",
        turnAdvancementIdempotency: "atomic-idempotent-v1",
      },
    },
    // OpenClaw already persists the canonical transcript. With no secondary
    // store to advance, ingestion/commit are side-effect-free and replay safe.
    async ingest() {
      return { ingested: false };
    },
    async commitTurn() {
      return { status: "committed" };
    },
    // Proactive compaction is disabled in world config. Retain native manual
    // and overflow recovery instead of pretending a no-op freed any capacity.
    compact: delegateCompactionToRuntime,
    async assemble(params) {
      const sessionKey = params.sessionKey;
      const owner = parseAgentSessionKey(sessionKey ?? "");
      const agentId = owner?.agentId;
      // The slot is global, but private character state belongs only in brain
      // turns, never chat ledgers, operator sessions, or spawned helper agents.
      if (!owner || owner.rest !== "brain") {
        return {
          messages: params.messages,
          estimatedTokens: params.messages.reduce(
            (sum, message) => sum + estimateTokens(message),
            0,
          ),
          systemPromptAddition: buildMemorySystemPromptAddition({
            availableTools: params.availableTools ?? new Set(),
            citationsMode: params.citationsMode,
            agentId,
            agentSessionKey: sessionKey,
          }),
        };
      }
      const brainAgentId = owner.agentId;
      await clock.init();
      const now = clock.time();
      const cutoff = now - config.shortTermHours * 3_600_000;
      const sessions = api.runtime.agent.session;
      const storePath = sessions.resolveStorePath(getConfig().session?.store, {
        agentId: brainAgentId,
      });
      const readSessions = await sessions.createSessionEntryListReader({
        agentId: brainAgentId,
        storePath,
      });
      const snapshot = await readSessions();
      // Skip the brain stream: host already passed active brain turns in params.messages.
      const streams = snapshot.entries.filter(({ sessionKey }) => {
        const key = parseAgentSessionKey(sessionKey);
        return (
          key?.agentId === brainAgentId &&
          (key.rest === "tasks" ||
            key.rest.startsWith("chat:direct:") ||
            key.rest.startsWith("chat:group:") ||
            key.rest.startsWith("chat:huddle:"))
        );
      });
      const workspaceDir = api.runtime.agent.resolveAgentWorkspaceDir(
        getConfig(),
        brainAgentId,
      );
      const [
        sessionsContext,
        activeTask,
        personalWiki,
        awaiting,
        feeling,
        place,
        company,
      ] = await Promise.all([
        readSessionStreams({
          agentId: brainAgentId,
          streams,
          storePath,
          pluginId: api.id,
          now,
          cutoff,
        }),
        tasks.lookup(brainAgentId),
        readPersonalWiki(
          workspaceDir,
          [],
          params.prompt ?? "",
          config.personalWikiMaxTokens ? config.personalWikiMaxArticles : 0,
        ),
        awaitingReplies?.(brainAgentId, cutoff) ?? [],
        feelings?.(brainAgentId, now),
        whereabouts?.(brainAgentId, now, params.prompt ?? ""),
        inCompany?.(brainAgentId, now) ?? false,
      ]);
      // Everyone the records speak of, named from their own identity.
      const speakers = new Set(
        Object.values(sessionsContext).flatMap((items) =>
          items.flatMap((item) =>
            item.sender ? [item.sender.identity.id] : [],
          ),
        ),
      );
      const names = new Map(
        await Promise.all(
          [...speakers].map(
            async (id) => [id, await personName(api, id)] as const,
          ),
        ),
      );
      const assembled = await assembleContext({
        run: params,
        names,
        agentId: brainAgentId,
        workspaceDir,
        sessionsContext,
        activeTask: activeTask ?? null,
        personalWiki,
        awaitingReplies: awaiting,
        feelings: feeling,
        whereabouts: place,
        inCompany: company,
        simTime: now,
        config,
        skillLoader,
      });
      // The situation message is always last (see assembleContext).
      const last = assembled.messages.at(-1);
      const situation = last && "content" in last ? last.content : undefined;
      try {
        const previous = (await recent.lookup(brainAgentId)) ?? [];
        await recent.register(
          brainAgentId,
          [
            {
              simTime: now,
              situation:
                typeof situation === "string"
                  ? situation
                  : JSON.stringify(situation),
              inPerson: company,
              estimatedTokens: assembled.estimatedTokens,
            },
            ...previous,
          ].slice(0, RECENT_CONTEXTS),
        );
      } catch (error: unknown) {
        api.logger.warn(
          `Context engine: could not record context: ${String(error)}`,
        );
      }
      return assembled;
    },
  };
}
