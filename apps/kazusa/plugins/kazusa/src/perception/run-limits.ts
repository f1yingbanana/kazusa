import {
  abortAgentHarnessRun,
  resolveActiveEmbeddedRunSessionId,
} from "openclaw/plugin-sdk/agent-harness-runtime";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import type { Clock } from "../clock/clock.ts";
import { currentConfig } from "../current-config.ts";
import { pluginSkillText } from "../skill-text.ts";
import { chooseActivity, LOOKUP_NAMES, MAX_LOOKUPS, turnOf } from "../turn.ts";
import { PERCEPTION_CONFIG } from "./types.ts";

/**
 * What still runs near a run's end, so it can always report: speaking, and
 * opening the conversation to speak in (`send_message` needs an address).
 */
const SPEECH_TOOLS: ReadonlySet<string> = new Set([
  "send_message",
  "talk",
  "create_group",
  "continue_work",
]);

/**
 * Never refused near the end either: a run that can't choose what comes next
 * leaves its character on an activity that is already over.
 */
const ACTIVITY_TOOLS: ReadonlySet<string> = new Set([
  "start_task",
  "delay_task",
]);

/** Model calls kept back so a run can still say where things stand. */
const WRAP_UP_MODEL_CALLS = 2;
/** Share of a run's thinking time after which it is told to wrap up. */
const WRAP_UP_TIME_SHARE = 0.8;

interface RunLimits {
  readonly maxModelCalls: number;
  readonly maxToolCalls: number;
  readonly maxThinkingSeconds: number;
}

function isSystemAgent(api: OpenClawPluginApi, agentId: string): boolean {
  return currentConfig(api).agents?.defaults?.systemAgent?.agentId === agentId;
}

/** A character's limits for one brain run; the system agent has its own. */
export function brainRunLimits(
  api: OpenClawPluginApi,
  agentId: string,
): RunLimits {
  const limits = PERCEPTION_CONFIG.parse(api.pluginConfig?.perception ?? {});
  return isSystemAgent(api, agentId) ? limits.systemAgent : limits;
}

interface BrainRun {
  readonly agentId: string;
  readonly controller: AbortController;
  readonly limits: RunLimits;
  /** Time spent in model calls that have ended, as the host measured them. */
  thoughtMs: number;
  /** Model calls under way, by call id: when each started. */
  readonly thinking: Map<string, number>;
  timer?: ReturnType<typeof setTimeout>;
  readonly models: Set<string>;
  readonly tools: Set<string>;
  readonly expire: (reason: string) => void;
  sessionKey?: string;
  sessionId?: string;
  readonly dispose: () => void;
}

// Turns and tools may execute through different plugin registrations.
const RUNS = Symbol.for("kazusa.brain.run-limits");
const OWNERS = Symbol.for("kazusa.brain.run-limit-owners");
function sessionOwners(): Map<string, string> {
  const scope = globalThis as { [OWNERS]?: Map<string, string> };
  return (scope[OWNERS] ??= new Map<string, string>());
}
function activeRuns(): Map<string, BrainRun> {
  const scope = globalThis as { [RUNS]?: Map<string, BrainRun> };
  return (scope[RUNS] ??= new Map<string, BrainRun>());
}

/**
 * How long a run has spent thinking: its model calls, ended and under way.
 * Waiting on a tool (typing, the floor, a paused world) is not thinking.
 */
function thinkingMs(run: BrainRun, now = Date.now()): number {
  let ms = run.thoughtMs;
  for (const startedAt of run.thinking.values()) ms += now - startedAt;
  return ms;
}

/** Ends the run once its thinking time is spent; only a model call spends it. */
function armExpiry(run: BrainRun): void {
  clearTimeout(run.timer);
  if (!run.thinking.size) return;
  const { maxThinkingSeconds } = run.limits;
  run.timer = setTimeout(
    () => run.expire(`${maxThinkingSeconds}s of thinking`),
    Math.max(0, maxThinkingSeconds * 1000 - thinkingMs(run)),
  );
  run.timer.unref();
}

/** The native dispatcher owns this signal through the complete run lifetime. */
export function beginBrainRun(
  api: OpenClawPluginApi,
  agentId: string,
  runId: string,
  lifetime: AbortSignal,
): { readonly signal: AbortSignal; readonly dispose: () => void } {
  const controller = new AbortController();
  const limits = brainRunLimits(api, agentId);
  const expire = (reason: string): void => {
    if (controller.signal.aborted) return;
    api.logger.warn(`Brain run ${runId} stopped: ${reason}`);
    controller.abort(new Error(`Brain run limit: ${reason}`));
    // A queued host turn can outlive its dispatch call. Cancel the public
    // harness too, while this exact tracked run still owns the session.
    if (
      runs.get(runId) === state &&
      state.sessionKey &&
      state.sessionId &&
      sessionOwners().get(state.sessionKey) === runId &&
      resolveActiveEmbeddedRunSessionId(state.sessionKey) === state.sessionId
    )
      abortAgentHarnessRun(state.sessionId);
  };
  const state: BrainRun = {
    agentId,
    controller,
    limits,
    thoughtMs: 0,
    thinking: new Map(),
    models: new Set(),
    tools: new Set(),
    expire,
    dispose: () => {
      clearTimeout(state.timer);
      if (runs.get(runId) === state) runs.delete(runId);
      if (state.sessionKey && sessionOwners().get(state.sessionKey) === runId)
        sessionOwners().delete(state.sessionKey);
    },
  };
  const runs = activeRuns();
  runs.set(runId, state);
  return {
    signal: AbortSignal.any([lifetime, controller.signal]),
    dispose: () => {
      // Native agent_end owns cleanup once execution starts. A deferred
      // turn creates its own tracked budget when its first call starts.
      if (!state.models.size) state.dispose();
    },
  };
}

/** The id of a character's brain run under way, from before it starts. */
export function currentBrainRun(agentId: string): string | undefined {
  return [...activeRuns()].findLast(([, run]) => run.agentId === agentId)?.[0];
}

function brainRun(
  api: OpenClawPluginApi,
  runId: string | undefined,
  sessionKey: string | undefined,
  sessionId: string | undefined,
): BrainRun | undefined {
  const agentId = sessionKey?.match(/^agent:([^:]+):brain$/)?.[1];
  if (!runId || !agentId) return undefined;
  if (!activeRuns().has(runId))
    beginBrainRun(api, agentId, runId, new AbortController().signal);
  const state = activeRuns().get(runId);
  if (state) {
    state.sessionKey = sessionKey;
    state.sessionId = sessionId;
    sessionOwners().set(sessionKey, runId);
  }
  return state;
}

export function registerBrainRunLimits(
  api: OpenClawPluginApi,
  clock: Pick<Clock, "time">,
): (runId: string) => void {
  // What a refused call says is the `kazusa-results` skill's.
  const text = pluginSkillText(api);
  const refuse = (result: string, agentId?: string) => ({
    block: true,
    blockReason: text(
      `kazusa-results#${result}`,
      {},
      agentId ? { agentId } : {},
    ),
  });
  api.on("model_call_started", (event, ctx) => {
    const state = brainRun(
      api,
      event.runId,
      ctx.sessionKey ?? event.sessionKey,
      ctx.sessionId ?? event.sessionId,
    );
    if (!state || state.models.has(event.callId)) return;
    state.models.add(event.callId);
    state.thinking.set(event.callId, Date.now());
    armExpiry(state);
    if (state.models.size >= state.limits.maxModelCalls)
      state.expire(`${state.limits.maxModelCalls} model calls`);
  });
  api.on("model_call_ended", (event) => {
    const state = activeRuns().get(event.runId);
    if (!state?.thinking.delete(event.callId)) return;
    state.thoughtMs += event.durationMs;
    armExpiry(state);
    if (state.thoughtMs >= state.limits.maxThinkingSeconds * 1000)
      state.expire(`${state.limits.maxThinkingSeconds}s of thinking`);
  });
  api.on("before_tool_call", (event, ctx) => {
    if (ctx.agentId) {
      const turn = turnOf(ctx.agentId);
      if (LOOKUP_NAMES.has(event.toolName)) {
        if (turn.lookups >= MAX_LOOKUPS)
          return refuse("lookup-limit", ctx.agentId);
        turn.lookups++;
      }
      if (event.toolName === "start_task" || event.toolName === "delay_task") {
        const now = { wall: Date.now(), sim: clock.time() };
        const callId = ctx.toolCallId ?? event.toolCallId;
        if (!chooseActivity(ctx.agentId, now, callId))
          return refuse("second-activity", ctx.agentId);
      }
    }
    const runId = ctx.runId ?? event.runId;
    const state = runId ? activeRuns().get(runId) : undefined;
    if (!state) return;
    if (state.controller.signal.aborted)
      return refuse("hard-limit", ctx.agentId);
    const callId = ctx.toolCallId ?? event.toolCallId;
    const key = callId ? `${state.models.size}:${callId}` : undefined;
    // A host can invoke a hook through multiple registrations; count once.
    if (key && state.tools.has(key)) return;
    // Near the end only speech and choosing what comes next still run, so a
    // run is never cut off without the chance to report or move on. The
    // model-call limit bounds what follows.
    const { maxModelCalls, maxToolCalls, maxThinkingSeconds } = state.limits;
    if (
      !SPEECH_TOOLS.has(event.toolName) &&
      !ACTIVITY_TOOLS.has(event.toolName) &&
      (state.tools.size >= maxToolCalls ||
        state.models.size >= maxModelCalls - WRAP_UP_MODEL_CALLS ||
        thinkingMs(state) >= maxThinkingSeconds * 1000 * WRAP_UP_TIME_SHARE)
    )
      return refuse("out-of-time", ctx.agentId);
    state.tools.add(key ?? `uncorrelated:${state.tools.size}`);
  });
  // The outer lifecycle owns cleanup, so provider fallback attempts cannot
  // reset a run's budget via their per-attempt agent_end hooks.
  return (runId) => activeRuns().get(runId)?.dispose();
}
