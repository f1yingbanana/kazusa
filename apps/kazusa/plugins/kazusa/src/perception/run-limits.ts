import {
  abortAgentHarnessRun,
  resolveActiveEmbeddedRunSessionId,
} from "openclaw/plugin-sdk/agent-harness-runtime";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { currentConfig } from "../current-config.ts";
import { pluginSkillText } from "../skill-text.ts";
import {
  chooseActivity,
  LOOKUP_NAMES,
  MAX_LOOKUPS,
  repeatsItself,
  turnOf,
} from "../turn.ts";
import { PERCEPTION_CONFIG } from "./types.ts";

/** Model calls kept back so a run can still say where things stand. */
const WRAP_UP_MODEL_CALLS = 2;
/** Share of a run's time after which it is told to wrap up. */
const WRAP_UP_TIME_SHARE = 0.8;

interface RunLimits {
  readonly maxModelCalls: number;
  readonly maxToolCalls: number;
  readonly maxRunSeconds: number;
}

/** A character's limits for one brain run; the system agent has its own. */
export function brainRunLimits(
  api: OpenClawPluginApi,
  agentId: string,
): RunLimits {
  const limits = PERCEPTION_CONFIG.parse(api.pluginConfig?.perception ?? {});
  return currentConfig(api).agents?.defaults?.systemAgent?.agentId === agentId
    ? limits.systemAgent
    : limits;
}

interface BrainRun {
  readonly controller: AbortController;
  readonly limits: RunLimits;
  readonly startedAt: number;
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
    controller,
    limits,
    startedAt: Date.now(),
    models: new Set(),
    tools: new Set(),
    expire,
    dispose: () => {
      clearTimeout(timer);
      if (runs.get(runId) === state) runs.delete(runId);
      if (state.sessionKey && sessionOwners().get(state.sessionKey) === runId)
        sessionOwners().delete(state.sessionKey);
    },
  };
  const runs = activeRuns();
  runs.set(runId, state);
  const timer = setTimeout(
    () => expire(`${limits.maxRunSeconds}s elapsed`),
    limits.maxRunSeconds * 1000,
  );
  timer.unref();
  return {
    signal: AbortSignal.any([lifetime, controller.signal]),
    dispose: () => {
      // Native agent_end owns cleanup once execution starts. A deferred
      // turn creates its own tracked budget when its first call starts.
      if (!state.models.size) state.dispose();
    },
  };
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
  simTime: () => number,
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
    if (state.models.size >= state.limits.maxModelCalls)
      state.expire(`${state.limits.maxModelCalls} model calls`);
  });
  api.on("before_tool_call", (event, ctx) => {
    if (ctx.agentId) {
      const turn = turnOf(ctx.agentId);
      if (
        event.toolName === "send_message" &&
        repeatsItself(turn, event.params, ctx.toolCallId ?? event.toolCallId)
      )
        return refuse("already-said", ctx.agentId);
      if (LOOKUP_NAMES.has(event.toolName)) {
        if (turn.lookups >= MAX_LOOKUPS)
          return refuse("lookup-limit", ctx.agentId);
        turn.lookups++;
      }
      if (event.toolName === "start_task" || event.toolName === "delay_task") {
        const now = { wall: Date.now(), sim: simTime() };
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
    // Near the end only speech still runs, so a run is never cut off without
    // the chance to report. The model-call limit bounds what follows.
    const { maxModelCalls, maxToolCalls, maxRunSeconds } = state.limits;
    if (
      event.toolName !== "send_message" &&
      event.toolName !== "continue_work" &&
      (state.tools.size >= maxToolCalls ||
        state.models.size >= maxModelCalls - WRAP_UP_MODEL_CALLS ||
        Date.now() - state.startedAt >=
          maxRunSeconds * 1000 * WRAP_UP_TIME_SHARE)
    )
      return refuse("out-of-time", ctx.agentId);
    state.tools.add(key ?? `uncorrelated:${state.tools.size}`);
  });
  // The outer lifecycle owns cleanup, so provider fallback attempts cannot
  // reset a run's budget via their per-attempt agent_end hooks.
  return (runId) => activeRuns().get(runId)?.dispose();
}
