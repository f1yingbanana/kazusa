import { estimateTokens } from "openclaw/plugin-sdk/agent-core";
import {
  buildMemorySystemPromptAddition,
  delegateCompactionToRuntime,
  type OpenClawPluginApi,
} from "openclaw/plugin-sdk/core";
import { parseAgentSessionKey } from "openclaw/plugin-sdk/routing";
import type { Clock } from "../clock/clock.ts";
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

interface ContextEngineDeps {
  readonly clock: Clock;
  /** Canonical "glance at the phone" view; absent until Messaging exists. */
  readonly awaitingReplies?: (
    agentId: string,
    since: number,
  ) => Promise<readonly AwaitingReply[]>;
  /** Desires' `How you feel` line; absent until Desires exists. */
  readonly feelings?: (agentId: string, at: number) => Promise<string>;
}

/**
 * Wire host lifecycle and session I/O; selection and skill expansion stay in
 * the engine.
 */
export function registerContextEngine(
  api: OpenClawPluginApi,
  deps: ContextEngineDeps,
): void {
  api.registerContextEngine("kazusa", () => createContextEngine(api, deps));
}

function createContextEngine(
  api: OpenClawPluginApi,
  { clock, awaitingReplies, feelings }: ContextEngineDeps,
): ContextEngine {
  const config = CONTEXT_ENGINE_CONFIG.parse(
    api.pluginConfig?.contextEngine ?? {},
  );
  const skillLoader = createSkillLoader({
    config: api.config,
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
      const storePath = sessions.resolveStorePath(api.config.session?.store, {
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
            key.rest.startsWith("chat:group:"))
        );
      });
      const workspaceDir = api.runtime.agent.resolveAgentWorkspaceDir(
        api.config,
        brainAgentId,
      );
      const [sessionsContext, activeTask, personalWiki, awaiting, feeling] =
        await Promise.all([
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
        ]);
      return assembleContext({
        run: params,
        agentId: brainAgentId,
        workspaceDir,
        sessionsContext,
        activeTask: activeTask ?? null,
        personalWiki,
        awaitingReplies: awaiting,
        feelings: feeling,
        simTime: now,
        config,
        skillLoader,
      });
    },
  };
}
