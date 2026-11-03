import { currentConfig } from "../current-config.ts";
import { estimateTokens } from "openclaw/plugin-sdk/agent-core";
import {
  buildMemorySystemPromptAddition,
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
  ledgerWindowEnd,
  renderLedgerRecords,
  readSessionStreams,
  type ContextEngine,
} from "./context-engine.ts";
import { readBrainTurns } from "../perception/brain-trace.ts";
import { currentBrainRun } from "../perception/run-limits.ts";
import { createSkillLoader } from "./skill-loader.ts";
import type { ActiveTask } from "../taskman/types.ts";
import type { AwaitingReply } from "../messaging/messaging.ts";
import { personName } from "../identity.ts";
import type { MemoryPrefetch } from "../memory/register.ts";
import { brainRequest, type RetrievalRequest } from "../memory/retrieve.ts";

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
  /** Who and what is in front of them, for recognition. */
  readonly presence?: (
    agentId: string,
    at: number,
  ) => Promise<readonly string[]>;
  /** What comes to mind this turn; absent means no memory module. */
  readonly memory?: (
    request: RetrievalRequest,
  ) => Promise<Pick<MemoryPrefetch, "onYourMind" | "roster">>;
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
  /** The oldest of their ledgers since `since` that fit, for sleep. */
  readonly experiences: (
    agentId: string,
    since: number,
    now: number,
  ) => Promise<{
    readonly text: string;
    readonly speakers: readonly string[];
    /** Records up to here were read; a backlog waits for the next sleep. */
    readonly through: number;
  }>;
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
    experiences: (agentId, since, now) =>
      readExperiences(api, getConfig, agentId, since, now),
  };
}

/** How much of a day sleep can take in. */
const SLEEP_RECORD_TOKENS = 8_000;

async function ownLedgers(
  api: OpenClawPluginApi,
  getConfig: () => OpenClawConfig,
  agentId: string,
): Promise<{
  readonly storePath: string;
  readonly streams: ReadonlyArray<{ readonly sessionKey: string }>;
}> {
  const sessions = api.runtime.agent.session;
  const storePath = sessions.resolveStorePath(getConfig().session?.store, {
    agentId,
  });
  const readSessions = await sessions.createSessionEntryListReader({
    agentId,
    storePath,
  });
  const snapshot = await readSessions();
  // Skip the brain stream: the host passes active brain turns itself.
  const streams = snapshot.entries.filter(({ sessionKey }) => {
    const key = parseAgentSessionKey(sessionKey);
    return (
      key?.agentId === agentId &&
      (key.rest === "tasks" ||
        key.rest.startsWith("chat:direct:") ||
        key.rest.startsWith("chat:group:") ||
        key.rest.startsWith("chat:huddle:"))
    );
  });
  return { storePath, streams };
}

async function readExperiences(
  api: OpenClawPluginApi,
  getConfig: () => OpenClawConfig,
  agentId: string,
  since: number,
  now: number,
): Promise<{
  readonly text: string;
  readonly speakers: readonly string[];
  readonly through: number;
}> {
  const { storePath, streams } = await ownLedgers(api, getConfig, agentId);
  const sessionsContext = await readSessionStreams({
    agentId,
    streams,
    storePath,
    pluginId: api.id,
    now,
    cutoff: since,
  });
  const through = ledgerWindowEnd({
    sessionsContext,
    since,
    now,
    tokenBudget: SLEEP_RECORD_TOKENS,
  });
  const speakers = [
    ...new Set(
      Object.values(sessionsContext).flatMap((items) =>
        items.flatMap((item) =>
          item.sender && Date.parse(item.timestamp ?? "") <= through
            ? [item.sender.identity.id]
            : [],
        ),
      ),
    ),
  ].filter((id) => id !== agentId);
  const names = new Map(
    await Promise.all(
      speakers.map(async (id) => [id, await personName(api, id)] as const),
    ),
  );
  return {
    speakers,
    through,
    text: renderLedgerRecords({
      sessionsContext,
      simTime: through,
      cutoff: since,
      tokenBudget: Number.POSITIVE_INFINITY,
      names,
    }),
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
    presence,
    memory,
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
      ownsCompaction: true,
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
    // Assembly windows the original records; summarizing the brain cannot
    // shrink the ledgers it retrieves. The host also calls this for preflight,
    // manual requests and overflow recovery. Report a benign skip, never a
    // fabricated token reduction or a runtime summarization pass.
    async compact() {
      return {
        ok: true,
        compacted: false,
        reason: "Nothing to compact: Kazusa selects context during assembly.",
      };
    },
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
      const { storePath, streams } = await ownLedgers(
        api,
        getConfig,
        brainAgentId,
      );
      const workspaceDir = api.runtime.agent.resolveAgentWorkspaceDir(
        getConfig(),
        brainAgentId,
      );
      const [
        sessionsContext,
        activeTask,
        here,
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
        presence?.(brainAgentId, now) ?? [],
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
      const recollection = await memory?.(
        brainRequest({
          agentId: brainAgentId,
          prompt: params.prompt ?? "",
          ...(activeTask ? { task: activeTask.description } : {}),
          here,
          awaiting: awaiting.map((chat) => chat.sender),
          now,
        }),
      );
      const assembled = await assembleContext({
        run: params,
        names,
        agentId: brainAgentId,
        workspaceDir,
        sessionsContext,
        activeTask: activeTask ?? null,
        onYourMind: recollection?.onYourMind,
        roster: recollection?.roster,
        awaitingReplies: awaiting,
        feelings: feeling,
        whereabouts: place,
        inCompany: company,
        simTime: now,
        config,
        skillLoader,
        toolHistoryMaxTokens:
          getConfig().agents?.defaults?.systemAgent?.agentId === brainAgentId
            ? config.systemAgentToolHistoryMaxTokens
            : config.toolHistoryMaxTokens,
        runId: currentBrainRun(brainAgentId),
        brainTurns: await readBrainTurns({
          agentId: brainAgentId,
          sessionId: params.sessionId,
        }).catch((error: unknown) => {
          api.logger.warn(
            `Context engine: can't read past tool calls of ${brainAgentId}: ${String(error)}`,
          );
          return [];
        }),
      });
      try {
        const previous = (await recent.lookup(brainAgentId)) ?? [];
        await recent.register(
          brainAgentId,
          [
            {
              simTime: now,
              situation: assembled.situationText,
              inPerson: company,
              estimatedTokens: assembled.estimatedTokens,
              breakdown: assembled.breakdown,
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
