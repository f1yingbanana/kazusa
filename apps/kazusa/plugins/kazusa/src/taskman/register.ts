import { currentConfig } from "../current-config.ts";
import type {
  OpenClawPluginApi,
  OpenClawPluginToolContext,
} from "openclaw/plugin-sdk/core";
import { listAgentIds } from "openclaw/plugin-sdk/agent-scope-runtime";
import { z } from "zod";
import type { Clock } from "../clock/clock.ts";
import { untilRunning } from "../clock/clock.ts";
import { shutdownSignal } from "../shutdown.ts";
import { openTaskStore } from "./store.ts";
import { appendLedgerEntry } from "../ledger.ts";
import { describeTool, pluginSkillText } from "../skill-text.ts";
import type { KazusaRealtimeBroadcaster } from "../realtime.ts";
import { withJournalSeq } from "../realtime.ts";
import type { Perception } from "../perception/perception.ts";
import type { Stage } from "../stage/stage.ts";
import { sharedSupervisorCell, startIdleSupervisor } from "./supervisor.ts";
import { executeDelayTask, executeStartTask } from "./taskman.ts";
import { createWakeSchedule, type WakeSchedule } from "./wakes.ts";
import {
  TASK_CATEGORIES,
  type ActiveTask,
  type DelayTaskParams,
  type StartTaskParams,
  type TaskExtension,
  type TaskStore,
  type TaskToolArguments,
  type ToolExecutionContext,
} from "./types.ts";

const TASKMAN_CONFIG_SCHEMA = z.object({
  minDuration: z.number().positive().default(10),
  categories: z
    .array(z.string().min(1))
    .min(1)
    .default([...TASK_CATEGORIES]),
  supervisor: z
    .object({
      enabled: z.boolean().default(true),
      intervalMs: z.number().positive().default(60_000),
      maxAgentsPerTick: z.number().int().positive().default(2),
    })
    .default({
      enabled: true,
      intervalMs: 60_000,
      maxAgentsPerTick: 2,
    }),
});

/**
 * Wakes at the end of each onstage character's activity, shared by every
 * instance of this plugin in the Gateway process: an agent turn may run task
 * tools on a separately loaded instance, which must reach the same schedule.
 * The newest instance to say how to wake someone (`wakeWith`) does it; each
 * stops only its own when disposed.
 */
interface TaskWakes {
  schedule?: WakeSchedule;
  readonly handlers: ((agentId: string) => void)[];
  /** Per character, the latest `synchronize` to start: it alone may set. */
  readonly syncs: Map<string, number>;
}

const SHARED_TASK_WAKES = Symbol.for("kazusa.taskman.wakes");

function sharedTaskWakes(): TaskWakes {
  const scope = globalThis as { [SHARED_TASK_WAKES]?: TaskWakes };
  return (scope[SHARED_TASK_WAKES] ??= { handlers: [], syncs: new Map() });
}

/** Forgets every wake and who does them; each test starts fresh. */
export function resetTaskWakes(): void {
  const wakes = sharedTaskWakes();
  wakes.schedule?.close();
  wakes.schedule = undefined;
  wakes.handlers.length = 0;
  wakes.syncs.clear();
}

export interface TaskmanService {
  readonly store: TaskStore;
  onTaskChange(
    listener: (agentId: string, task: ActiveTask) => void,
  ): () => void;
  attachSupervisor(perception: Perception): () => void;
  /** Re-reads one character's wake from their lease and stage. */
  reschedule(agentId: string): Promise<void>;
  /**
   * What waking someone at the end of their activity does. The first caller in
   * the process keeps it; returns a disposer.
   */
  wakeWith(wake: (agentId: string) => void): () => void;
}

/** Registers task leases, the wakes at their ends, and the ledger. */
export function registerTaskman(
  api: OpenClawPluginApi,
  deps: {
    readonly clock: Clock;
    readonly broadcaster?: KazusaRealtimeBroadcaster;
    /** Modules that add `start_task` parameters and see leases first. */
    readonly extensions?: readonly TaskExtension[];
    /** Offstage characters have no wake. Absent: everyone is onstage. */
    readonly stage?: Pick<Stage, "isOnstage" | "onstage">;
  },
): TaskmanService {
  const getConfig = () => currentConfig(api);
  const { clock } = deps;
  const text = pluginSkillText(api);
  const extensions = deps.extensions ?? [];
  const startTaskParameters = extensions.reduce<Record<string, unknown>>(
    (all, extension) => ({ ...all, ...extension.startTaskParameters }),
    {},
  );
  const delayTaskParameters = extensions.reduce<Record<string, unknown>>(
    (all, extension) => ({ ...all, ...extension.delayTaskParameters }),
    {},
  );
  // A tool requires only the extension properties it takes.
  const requiredBy = (
    tool: "startTaskParameters" | "delayTaskParameters",
  ): string[] =>
    extensions.flatMap((extension) =>
      extension.required.filter((name) => name in extension[tool]),
    );
  const store = openTaskStore(api);
  const taskChangeListeners = new Set<
    (agentId: string, task: ActiveTask) => void
  >();
  const notifyTaskChange = (agentId: string, task: ActiveTask) => {
    for (const listener of taskChangeListeners) {
      try {
        listener(agentId, task);
      } catch {
        // Ignore listener error
      }
    }
  };
  const config = TASKMAN_CONFIG_SCHEMA.parse(api.pluginConfig?.taskman ?? {});
  const wakes = sharedTaskWakes();
  const schedule = (wakes.schedule ??= createWakeSchedule({
    clock,
    wake: (agentId) => wakes.handlers.at(-1)?.(agentId),
  }));

  /**
   * One character's wake, from their lease and stage. Calls can overlap (the
   * start-up pass over every lease, a task tool, a stage change): only the
   * latest to start sets the wake, so an older read never replaces a newer
   * end.
   */
  const synchronize = async (agentId: string): Promise<void> => {
    const sync = (wakes.syncs.get(agentId) ?? 0) + 1;
    wakes.syncs.set(agentId, sync);
    const task = await store.lookup(agentId);
    const onstage = !deps.stage || (await deps.stage.isOnstage(agentId));
    if (wakes.syncs.get(agentId) !== sync) return;
    schedule.set(agentId, task && onstage ? Date.parse(task.endAt) : undefined);
  };

  // A clock edit (play, pause, a jump) moves every end in wall-clock time;
  // only the one timer is set again.
  const unsubscribeClockChange = clock.onClockChange(() => {
    schedule.rearm();
  });
  api.lifecycle.onDispose?.(unsubscribeClockChange);

  // Every lease's wake, once the Gateway is up. A lease that ended while it
  // was down wakes its character at once.
  api.on("gateway_start", async () => {
    await clock.init();
    for (const { key } of await store.entries()) await synchronize(key);
  });

  // Worlds from before wakes moved here kept one cron job per character, named
  // "Wake <id>". They would only repeat a wake; remove them.
  api.on("cron_reconciled", async (_event, ctx): Promise<void> => {
    const cron = ctx.getCron?.();
    if (!cron) return;
    const characters = new Set(listAgentIds(getConfig()));
    for (const job of await cron.list({ includeDisabled: true })) {
      ctx.abortSignal.throwIfAborted();
      if (
        job.declarationKey &&
        characters.has(job.declarationKey) &&
        job.name === `Wake ${job.declarationKey}`
      )
        await cron.remove(job.id);
    }
  });

  const resolveExecutionContext = (
    toolContext?: OpenClawPluginToolContext,
  ): ToolExecutionContext => {
    const agentId = toolContext?.agentId ?? "main";
    return {
      agentId,
      store,
      clock,
      minDuration: config.minDuration,
      text: (section, values) =>
        text(`kazusa-results#${section}`, values, { agentId }),
      async prepare(transition) {
        const prepared = [];
        for (const extension of extensions) {
          prepared.push(await extension.prepare(transition));
        }
        return prepared;
      },
      appendTaskLedgerEntry: (text, timestamp, metadata): Promise<void> =>
        appendLedgerEntry(api, {
          agentId,
          stream: "tasks",
          text,
          timestamp,
          metadata,
        }),
    };
  };

  // Their wording is the `kazusa-tools` skill's (`describeTool`).
  api.registerTool((toolContext) => ({
    ...describeTool(
      text,
      {
        name: "start_task",
        parameters: {
          type: "object",
          properties: {
            type: { type: "string", enum: config.categories },
            description: { type: "string" },
            duration: { type: "number" },
            summary: { type: "string" },
            monologue: { type: "string" },
            metadata: { type: "object" },
            ...startTaskParameters,
          },
          required: [
            "type",
            "description",
            "duration",
            ...requiredBy("startTaskParameters"),
          ],
          additionalProperties: false,
        },
      },
      { minDuration: config.minDuration },
      { agentId: toolContext?.agentId },
    ),
    // Every check-in uses this tool; deferring it behind Tool Search hides
    // its parameter descriptions (including extensions' `effects`).
    catalogMode: "direct-only",
    label: "Start or Transition Task",
    async execute(_id, params: TaskToolArguments<StartTaskParams>) {
      await clock.init();
      if (
        !toolContext?.agentId ||
        getConfig().agents?.defaults?.systemAgent?.agentId !==
          toolContext.agentId
      )
        await untilRunning(clock, shutdownSignal());
      const result = await executeStartTask(
        params,
        resolveExecutionContext(toolContext),
      );
      if (result.success && result.task) {
        const agentId = toolContext?.agentId ?? "main";
        await synchronize(agentId);
        notifyTaskChange(agentId, result.task);
        deps.broadcaster?.broadcast({
          type: "journal",
          event: withJournalSeq({
            simTime: result.simTime,
            kind: "task.started",
            actors: [agentId],
            payload: result.payload,
          }),
        });
      }
      return {
        content: [{ type: "text", text: result.message }],
        details: result,
      };
    },
  }));

  api.registerTool((toolContext) => ({
    ...describeTool(
      text,
      {
        name: "delay_task",
        parameters: {
          type: "object",
          properties: {
            minutesLeft: { type: "number" },
            reason: { type: "string" },
            monologue: { type: "string" },
            ...delayTaskParameters,
          },
          required: ["minutesLeft", ...requiredBy("delayTaskParameters")],
          additionalProperties: false,
        },
      },
      {},
      { agentId: toolContext?.agentId },
    ),
    catalogMode: "direct-only",
    label: "Delay Task",
    async execute(_id, params: TaskToolArguments<DelayTaskParams>) {
      await clock.init();
      if (
        !toolContext?.agentId ||
        getConfig().agents?.defaults?.systemAgent?.agentId !==
          toolContext.agentId
      )
        await untilRunning(clock, shutdownSignal());
      const result = await executeDelayTask(
        params,
        resolveExecutionContext(toolContext),
      );
      if (
        result.success &&
        result.task &&
        result.payload &&
        result.simTime !== undefined
      ) {
        const agentId = toolContext?.agentId ?? "main";
        await synchronize(agentId);
        notifyTaskChange(agentId, result.task);
        deps.broadcaster?.broadcast({
          type: "journal",
          event: withJournalSeq({
            simTime: result.simTime,
            kind: "task.delayed",
            actors: [agentId],
            payload: result.payload,
          }),
        });
      }
      return {
        content: [{ type: "text", text: result.message }],
        details: result,
      };
    },
  }));

  return {
    store,
    onTaskChange(listener) {
      taskChangeListeners.add(listener);
      return () => {
        taskChangeListeners.delete(listener);
      };
    },
    attachSupervisor(perception: Perception): () => void {
      if (!config.supervisor.enabled) return () => {};
      return startIdleSupervisor(api, {
        clock,
        store,
        perception,
        intervalMs: config.supervisor.intervalMs,
        maxAgentsPerTick: config.supervisor.maxAgentsPerTick,
        cell: sharedSupervisorCell(),
        ...(deps.stage ? { stage: deps.stage } : {}),
      });
    },
    async reschedule(agentId) {
      await synchronize(agentId);
    },
    wakeWith(wake) {
      wakes.handlers.push(wake);
      return () => {
        const at = wakes.handlers.lastIndexOf(wake);
        if (at >= 0) wakes.handlers.splice(at, 1);
      };
    },
  };
}
