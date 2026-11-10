import { currentConfig } from "../current-config.ts";
import { inBackground } from "../background.ts";
import { estimateTokens } from "openclaw/plugin-sdk/agent-core";
import {
  buildMemorySystemPromptAddition,
  type OpenClawPluginApi,
  type OpenClawConfig,
} from "openclaw/plugin-sdk/core";
import { parseAgentSessionKey } from "openclaw/plugin-sdk/routing";
import type { BrainTurn, ContextSettings } from "@kazusa/client";
import type { Clock } from "../clock/clock.ts";
import { CONTEXT_ENGINE_CONFIG, type ContextEngineConfig } from "./config.ts";
import { contextSettings, contextSettingsBase } from "./settings.ts";
import {
  assembleContext,
  ledgerWindowEnd,
  ledgerCutoff,
  renderLedgerRecords,
  readSessionStreams,
  type ContextEngine,
} from "./context-engine.ts";
import { readBrainTurns } from "../perception/brain-trace.ts";
import { currentBrainRun } from "../perception/run-limits.ts";
import { pluginSkillLoader } from "./skill-loader.ts";
import type { ActiveTask } from "../taskman/types.ts";
import type { AwaitingReply } from "../messaging/messaging.ts";
import { pluginSkillText } from "../skill-text.ts";
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
    options?: {
      readonly listLimit?: number;
      readonly exclude?: readonly string[];
    },
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
    options?: {
      readonly maxTokens?: number;
      readonly rosterLimit?: number;
      readonly exclude?: readonly string[];
    },
  ) => Promise<Pick<MemoryPrefetch, "onYourMind" | "roster" | "ids">>;
  /** The character's brain run under way, if any (`currentBrainRun`). */
  readonly runOf?: (agentId: string) => string | undefined;
}

/**
 * What one brain turn reads once and every later build of it reuses: none of it
 * changes within a turn. OpenClaw assembles before every model call of a turn
 * (its tool loop), so a turn of four model calls built everything five times,
 * measured at 3.4 s a build with 16 characters thinking.
 */
interface TurnInputs {
  readonly runId: string;
  /** The world's and the character's context settings. */
  readonly chosen: ContextSettings;
  /** What memory brought to mind, for this prompt. */
  readonly prompt: string;
  readonly recollection:
    Pick<MemoryPrefetch, "onYourMind" | "roster" | "ids"> | undefined;
  /** Past turns for the past-tool-call note; the current one is left out. */
  readonly brainTurns: readonly BrainTurn[];
}

/**
 * What a turn reuses, and the model windows read so far, for one registration.
 * The engine object itself may be made afresh for each run, so these outlive
 * it.
 */
interface TurnCaches {
  /** Each character's current turn. */
  readonly turns: Map<string, TurnInputs>;
  /** A model's window per character and model: it changes only with the model. */
  readonly windows: Map<string, number>;
}

/**
 * Wire host lifecycle and session I/O; selection and skill expansion stay in
 * the engine.
 */
export interface ContextEngineService {
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
  // Earlier versions kept each character's last 20 situations here, for
  // debugging only, and rewrote them on every first build. Drop what is left,
  // once the plugin state database is open: it isn't while plugins register.
  api.on("gateway_start", () => {
    inBackground(
      api,
      () =>
        api.runtime.state
          .openKeyedStore({ namespace: "context", retention: "retained" })
          .clear(),
      (error) =>
        api.logger.warn(
          `Context engine: could not drop old situations: ${String(error)}`,
        ),
    );
  });
  const caches: TurnCaches = { turns: new Map(), windows: new Map() };
  api.registerContextEngine("kazusa", () =>
    createContextEngine(api, deps, getConfig, caches),
  );
  return {
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
  const skillText = pluginSkillText(api);
  // Sized and rendered alike, so the night reads all that fits.
  const deliveries = (section: string): string =>
    skillText(`kazusa-deliveries#${section}`, {}, { agentId });
  const through = ledgerWindowEnd({
    sessionsContext,
    since,
    now,
    tokenBudget: SLEEP_RECORD_TOKENS,
    text: deliveries,
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
  return {
    speakers,
    through,
    text: renderLedgerRecords({
      sessionsContext,
      simTime: through,
      cutoff: since,
      tokenBudget: Number.POSITIVE_INFINITY,
      trimTo: 1,
      text: deliveries,
    }).text,
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
    runOf = currentBrainRun,
  }: ContextEngineDeps,
  getConfig: () => OpenClawConfig,
  { turns, windows }: TurnCaches,
): ContextEngine {
  const config = CONTEXT_ENGINE_CONFIG.parse(
    api.pluginConfig?.contextEngine ?? {},
  );
  const skillLoader = pluginSkillLoader(api);
  const tasks = api.runtime.state.openKeyedStore<ActiveTask>({
    namespace: "tasks",
    retention: "retained",
  });
  const settings = contextSettings(api);
  // Where each character's records started last turn, so the start holds and
  // the provider keeps them cached. Losing it costs one re-read.
  const recordsStarts = api.runtime.state.openKeyedStore<{
    readonly from: number;
  }>({ namespace: "records", retention: "retained" });
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
      // Later builds of the same turn reuse what can't have changed.
      const runId = runOf(brainAgentId);
      const prompt = params.prompt ?? "";
      const cached = turns.get(brainAgentId);
      const turn =
        runId !== undefined && cached?.runId === runId ? cached : undefined;
      await clock.init();
      const now = clock.time();
      // The world's and this character's choices in Settings, over the config.
      const chosen =
        turn?.chosen ??
        (await settings
          .resolve(contextSettingsBase(api.pluginConfig), brainAgentId)
          .then(({ effective }) => effective)
          .catch((error: unknown) => {
            api.logger.warn(
              `Context engine: can't read ${brainAgentId}'s context settings: ${String(error)}`,
            );
            return contextSettingsBase(api.pluginConfig);
          }));
      const turnConfig: ContextEngineConfig = {
        ...config,
        shortTermHours: chosen.shortTermHours,
        ledgerMaxTokens: chosen.ledgerMaxTokens,
        maxContextTokens: chosen.maxContextTokens,
        ledgerGridHours: chosen.ledgerGridHours,
        ledgerTrimTo: chosen.ledgerTrimTo,
        toolHistoryMaxTokens: chosen.toolHistoryTokens,
      };
      const cutoff = ledgerCutoff(
        now,
        turnConfig.shortTermHours,
        turnConfig.ledgerGridHours,
      );
      // Past turns, read while the rest is: only the first build waits.
      const pastTurns: Promise<readonly BrainTurn[]> = turn
        ? Promise.resolve(turn.brainTurns)
        : readBrainTurns({
            agentId: brainAgentId,
            sessionId: params.sessionId,
          }).catch((error: unknown) => {
            api.logger.warn(
              `Context engine: can't read past tool calls of ${brainAgentId}: ${String(error)}`,
            );
            return [];
          });
      // The model's window, which the host budgets: read once per model. Its
      // session entry waited in OpenClaw's transcript worker (1.9 s of each
      // build with 16 characters thinking).
      const windowKey = `${brainAgentId}\u0000${params.model ?? ""}`;
      const contextWindow: Promise<number | undefined> = windows.has(windowKey)
        ? Promise.resolve(windows.get(windowKey))
        : api.runtime.agent.session
            .getSessionEntryAsync({
              agentId: brainAgentId,
              sessionKey: `agent:${brainAgentId}:brain`,
            })
            .then((session) => {
              if (session?.contextTokens)
                windows.set(windowKey, session.contextTokens);
              return session?.contextTokens;
            })
            .catch(() => undefined);
      const { storePath, streams } = await ownLedgers(
        api,
        getConfig,
        brainAgentId,
      );
      const workspaceDir = api.runtime.agent.resolveAgentWorkspaceDir(
        getConfig(),
        brainAgentId,
      );
      // What a tool call can change: read again for every build.
      const [
        sessionsContext,
        activeTask,
        here,
        awaiting,
        feeling,
        company,
        recordsStart,
        window,
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
        inCompany?.(brainAgentId, now) ?? false,
        recordsStarts.lookup(brainAgentId).catch((error: unknown) => {
          api.logger.warn(
            `Context engine: can't read where ${brainAgentId}'s records start: ${String(error)}`,
          );
          return undefined;
        }),
        contextWindow,
      ]);
      // One memory search a turn: what comes to mind is about what arrived.
      const recollection =
        turn && turn.prompt === prompt
          ? turn.recollection
          : await memory?.(
              brainRequest({
                agentId: brainAgentId,
                prompt,
                ...(activeTask ? { task: activeTask.description } : {}),
                here,
                awaiting: awaiting.map((chat) => chat.sender),
                now,
              }),
              {
                maxTokens: chosen.onYourMindTokens,
                rosterLimit: chosen.peopleLimit,
                // Who is in front of them is in With you already.
                exclude: here,
              },
            );
      // After memory: Places you know leaves out what On your mind shows.
      const place = await whereabouts?.(brainAgentId, now, prompt, {
        listLimit: chosen.placesLimit,
        exclude: recollection?.ids ?? [],
      });
      const brainTurns = await pastTurns;
      // Every build assembles afresh, for its own token budget: each model
      // call leaves less, as the turn's own messages grow.
      const assembled = await assembleContext({
        run: params,
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
        config: turnConfig,
        ...(window ? { contextWindow: window } : {}),
        skillLoader,
        toolHistoryMaxTokens:
          getConfig().agents?.defaults?.systemAgent?.agentId === brainAgentId
            ? config.systemAgentToolHistoryMaxTokens
            : turnConfig.toolHistoryMaxTokens,
        runId,
        ...(recordsStart ? { recordsFrom: recordsStart.from } : {}),
        brainTurns,
      });
      if (runId !== undefined)
        turns.set(brainAgentId, {
          runId,
          chosen,
          prompt,
          recollection,
          brainTurns,
        });
      try {
        if (
          assembled.recordsFrom !== undefined &&
          assembled.recordsFrom !== recordsStart?.from
        )
          await recordsStarts.register(brainAgentId, {
            from: assembled.recordsFrom,
          });
      } catch (error: unknown) {
        api.logger.warn(
          `Context engine: could not keep where records start: ${String(error)}`,
        );
      }
      return assembled;
    },
  };
}
