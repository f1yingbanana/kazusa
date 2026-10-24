import { estimateTokens } from "openclaw/plugin-sdk/agent-core";
import {
  buildMemorySystemPromptAddition,
  delegateCompactionToRuntime,
  type OpenClawPluginApi,
} from "openclaw/plugin-sdk/core";
import {
  readRecentUserAssistantTextForSession,
  type SessionRecentConversationText,
} from "openclaw/plugin-sdk/session-store-runtime";
import type { Clock } from "../clock/clock.ts";
import { CONTEXT_ENGINE_CONFIG } from "./config.ts";
import { assembleContext, type ContextEngine } from "./context-engine.ts";
import { parseAgentSessionKey } from "openclaw/plugin-sdk/routing";
import { createSkillLoader } from "./skill-loader.ts";

/**
 * Wire host lifecycle and session I/O; selection and skill expansion stay in
 * the engine.
 */
export function registerContextEngine(
  api: OpenClawPluginApi,
  deps: { readonly clock: Clock },
): void {
  api.registerContextEngine("kazusa", () => createContextEngine(api, deps));
}

function createContextEngine(
  api: OpenClawPluginApi,
  { clock }: { readonly clock: Clock },
): ContextEngine {
  const config = CONTEXT_ENGINE_CONFIG.parse(
    api.pluginConfig?.contextEngine ?? {},
  );
  const skillLoader = createSkillLoader({
    config: api.config,
    pluginRootDir: api.rootDir,
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
      const target = params.runtimeContext?.sessionTarget;
      if (!target?.agentId) {
        throw new Error(
          "Kazusa context assembly requires runtimeContext.sessionTarget.agentId.",
        );
      }
      const agentId = target.agentId;
      const sessionKey = params.sessionKey ?? target.sessionKey;
      const owner = parseAgentSessionKey(sessionKey ?? "");
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
      if (owner.agentId !== agentId) {
        throw new Error(
          `Session owner "${owner.agentId}" does not match runtime agent "${agentId}".`,
        );
      }
      await clock.init();
      const now = clock.time();
      const cutoff = now - config.shortTermHours * 3_600_000;
      const sessions = api.runtime.agent.session;
      const storePath =
        target.storePath ??
        sessions.resolveStorePath(api.config.session?.store, {
          agentId,
        });
      const readSessions = await sessions.createSessionEntryListReader({
        agentId,
        storePath,
      });
      const snapshot = await readSessions();
      // Skip the brain stream: host already passed active brain turns in params.messages.
      const streams = snapshot.entries.filter(({ sessionKey }) => {
        const key = parseAgentSessionKey(sessionKey);
        return (
          key?.agentId === agentId &&
          (key.rest === "tasks" ||
            key.rest.startsWith("chat:direct:") ||
            key.rest.startsWith("chat:group:"))
        );
      });
      const sessionsContext: Record<string, SessionRecentConversationText[]> =
        {};
      for (const { sessionKey } of streams) {
        sessionsContext[sessionKey] =
          await readRecentUserAssistantTextForSession({
            agentId,
            sessionKey,
            storePath,
            minTimestampMs: cutoff,
            beforeTimestampMs: now + 1,
            limit: Number.MAX_SAFE_INTEGER,
          });
      }
      return assembleContext({
        run: params,
        sessionsContext,
        simTime: now,
        config,
        skillLoader,
      });
    },
  };
}
