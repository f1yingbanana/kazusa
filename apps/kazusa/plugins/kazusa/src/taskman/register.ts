import {
  generateSecureUuid,
  type OpenClawPluginApi,
  type OpenClawPluginToolContext,
} from "openclaw/plugin-sdk/core";
import { listAgentIds } from "openclaw/plugin-sdk/agent-scope-runtime";
import { z } from "zod";
import type { Clock } from "../clock/clock.ts";
import { untilRunning } from "../clock/clock.ts";
import { shutdownSignal } from "../shutdown.ts";
import { appendLedgerEntry } from "../ledger.ts";
import type { KazusaRealtimeBroadcaster } from "../realtime.ts";
import { nextJournalSeq } from "../realtime.ts";
import type { Perception } from "../perception/perception.ts";
import { sharedSupervisorCell, startIdleSupervisor } from "./supervisor.ts";
import { executeDelayTask, executeStartTask } from "./taskman.ts";
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
      idleText: z.string().default("Activity check-in: no scheduled activity."),
    })
    .default({
      enabled: true,
      intervalMs: 60_000,
      maxAgentsPerTick: 2,
      idleText: "Activity check-in: no scheduled activity.",
    }),
});

/**
 * The cron projection as seen by every instance of this plugin in the Gateway
 * process. Only the instance that received `cron_reconciled` can write jobs,
 * but an agent turn may run task tools and cron wakes on a separately loaded
 * instance, which must still reach it.
 */
interface TaskAutomation {
  ready: boolean;
  synchronize?: (agentId: string) => Promise<void>;
}

const SHARED_TASK_AUTOMATION = Symbol.for("kazusa.taskman.automation");

function sharedTaskAutomation(): TaskAutomation {
  const scope = globalThis as { [SHARED_TASK_AUTOMATION]?: TaskAutomation };
  return (scope[SHARED_TASK_AUTOMATION] ??= { ready: false });
}

export interface TaskmanService {
  readonly store: TaskStore;
  onTaskChange(
    listener: (agentId: string, task: ActiveTask) => void,
  ): () => void;
  attachSupervisor(perception: Perception): () => void;
}

/** Registers task leases, their visible cron projection, and ledger. */
export function registerTaskman(
  api: OpenClawPluginApi,
  deps: {
    readonly clock: Clock;
    readonly broadcaster?: KazusaRealtimeBroadcaster;
    /** Modules that add `start_task` parameters and see leases first. */
    readonly extensions?: readonly TaskExtension[];
  },
): TaskmanService {
  const { clock } = deps;
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
  const store = api.runtime.state.openKeyedStore<ActiveTask>({
    namespace: "tasks",
    retention: "retained",
  });
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
  const automation = sharedTaskAutomation();
  let reconcileAutomations: (() => Promise<void>) | undefined;

  // Only explicit clock edits (advance or speed changes) change the mapping
  // between simulated deadlines and wall-clock run times. Ordinary passage of
  // real time does not emit this event and therefore does not rebuild jobs.
  const unsubscribeClockChange = clock.onClockChange(
    async (): Promise<void> => {
      await reconcileAutomations?.();
    },
  );
  api.lifecycle.onDispose?.(unsubscribeClockChange);

  // Cron is a dashboard-visible projection of retained task state, never the
  // source of truth. Its reconciliation lifecycle is the only time Taskman
  // examines the fleet; ordinary task changes upsert one declaration-keyed job.
  api.on("cron_reconciled", async (event, ctx): Promise<void> => {
    automation.ready = false;
    automation.synchronize = undefined;
    reconcileAutomations = undefined;
    await clock.init();
    ctx.abortSignal.throwIfAborted();
    const cron = ctx.getCron?.();
    if (!cron) return;

    // cron_reconciled is cancelled on reloading the cron scheduler. So recheck
    // before every subsequent mutation to ensure an old lifecycle cannot delete
    // or add jobs for the replacement lifecycle.
    const assertCurrent = (): void => ctx.abortSignal.throwIfAborted();

    const listJobs = async () => {
      assertCurrent();
      return await cron.list({ includeDisabled: true });
    };
    const removeJob = async (jobId: string): Promise<void> => {
      assertCurrent();
      await cron.remove(jobId);
    };

    // Other plugins declare jobs too (memory-core's dreaming promotion). Taskman
    // owns exactly the jobs keyed by a configured character.
    const isTaskmanJob = (declarationKey: string | undefined): boolean =>
      !!declarationKey && listAgentIds(api.config).includes(declarationKey);

    const removeAgentAutomation = async (agentId: string): Promise<void> => {
      const jobs = await listJobs();
      for (const job of jobs) {
        if (job.declarationKey !== agentId) continue;
        await removeJob(job.id);
      }
    };

    const wakeFor = (
      agentId: string,
      task: ActiveTask,
      simulationNow: number,
      speed: number,
    ) => {
      const remaining = Math.max(
        1,
        Math.round((new Date(task.endAt).getTime() - simulationNow) / speed),
      );
      return {
        // declarationKey is the native cron identity. cron.add atomically
        // creates or updates this one character's visible wake job.
        declarationKey: agentId,
        agentId,
        name: `Wake ${agentId}`,
        description: `Wake ${agentId} when its ${task.type} task ends.`,
        enabled: true,
        schedule: {
          kind: "at" as const,
          at: new Date(Date.now() + remaining).toISOString(),
          // Present only for the currently over-strict plugin SDK declaration;
          // the OpenClaw host discards it for an `at` schedule.
          expr: "",
        },
        // Taskman deadline automation projection:
        // Uses sessionTarget: "isolated" (ephemeral session) rather than targeting
        // "session:agent:<id>:brain" directly. OpenClaw serializes runs per session
        // lane; an isolated session avoids lane contention when :brain is busy,
        // allowing before_agent_reply to fire immediately and steer in-flight turns.
        sessionTarget: "isolated" as const,
        wakeMode: "now" as const,
        deleteAfterRun: true,
        payload: {
          kind: "agentTurn" as const,
          message: `Scheduled ${task.type} task deadline reached at ${task.endAt}.`,
        },
        // The task session is a ledger. A wake is not a chat reply.
        delivery: { mode: "none" as const },
      };
    };

    const synchronize = async (agentId: string): Promise<void> => {
      let task = await store.lookup(agentId);
      // One-time migration of leases retained before task IDs existed. Cron
      // reconciliation completes before the scheduled deadline is admitted.
      if (task && !task.id) {
        task = { ...task, id: generateSecureUuid() };
        await store.register(agentId, task, { assertCurrent });
      }
      const snapshot = clock.now();
      if (!task || snapshot.speed <= 0) {
        await removeAgentAutomation(agentId);
        return;
      }
      assertCurrent();
      await cron.add(wakeFor(agentId, task, snapshot.simTime, snapshot.speed));
    };

    const clear = async (): Promise<void> => {
      const jobs = await listJobs();
      for (const job of jobs) {
        if (isTaskmanJob(job.declarationKey)) await removeJob(job.id);
      }
    };

    if (!event.enabled) {
      await clear();
      return;
    }

    automation.synchronize = synchronize;
    reconcileAutomations = async (): Promise<void> => {
      const tasks = await store.entries();
      if (clock.now().speed <= 0) {
        await clear();
        return;
      }
      const activeAgentIds = new Set(tasks.map(({ key }) => key));
      const jobs = await listJobs();
      for (const job of jobs) {
        // A character's job not represented by a retained lease is stale. This
        // is deliberately lifecycle-only work.
        if (
          isTaskmanJob(job.declarationKey) &&
          !activeAgentIds.has(job.declarationKey!)
        ) {
          await removeJob(job.id);
        }
      }
      for (const { key: agentId } of tasks) {
        await synchronize(agentId);
      }
    };
    automation.ready = true;
    await reconcileAutomations();
  });

  // Cron jobs are not allowed to run while Taskman is rebuilding its retained
  // projection after startup or reload. The brain session serializes all
  // normal character turns, so no per-run task lookup or repair is required.
  api.on("before_agent_run", (_event, ctx) => {
    if (ctx.jobId && !automation.ready) {
      return { outcome: "block", reason: "kazusa:taskman-initializing" };
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

  api.registerTool((toolContext) => ({
    name: "start_task",
    // Every check-in uses this tool; deferring it behind Tool Search hides
    // its parameter descriptions (including extensions' `effects`).
    catalogMode: "direct-only",
    label: "Start or Transition Task",
    description:
      "Start an initial task or conclude your current task and begin the next one. Characters are never idle; include a summary when replacing a task.",
    parameters: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: config.categories,
          description: "Major activity category of the task.",
        },
        description: {
          type: "string",
          description:
            "Natural-language description of what your character is doing (e.g. 'Walking to the Academic Building', 'Eating a strawberry macaron at the cafe')",
        },
        duration: {
          type: "number",
          description: `Planned duration in minutes (minimum: ${config.minDuration} minutes)`,
        },
        summary: {
          type: "string",
          description:
            "What happened in the task being replaced, when applicable",
        },
        monologue: {
          type: "string",
          description:
            "Optional one or two sentences of inner monologue in your character's voice, as plain text, alongside the factual summary.",
        },
        metadata: {
          type: "object",
          description: "Optional task-specific metadata",
        },
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
    async execute(_id, params: TaskToolArguments<StartTaskParams>) {
      await clock.init();
      // A paused world holds whoever acts in it.
      await untilRunning(clock, shutdownSignal());
      const result = await executeStartTask(
        params,
        resolveExecutionContext(toolContext),
      );
      if (result.success && result.task) {
        const agentId = toolContext?.agentId ?? "main";
        await automation.synchronize?.(agentId);
        notifyTaskChange(agentId, result.task);
        deps.broadcaster?.broadcast({
          type: "journal",
          event: {
            seq: nextJournalSeq(),
            simTime: clock.time(),
            kind: "task.started",
            actors: [agentId],
            payload: result.payload,
          },
        });
      }
      return {
        content: [{ type: "text", text: result.message }],
        details: result,
      };
    },
  }));

  api.registerTool((toolContext) => ({
    name: "delay_task",
    catalogMode: "direct-only",
    label: "Delay Task",
    description:
      "Delay the completion time of your current active task by N minutes.",
    parameters: {
      type: "object",
      properties: {
        additionalDuration: {
          type: "number",
          description: "Additional minutes",
        },
        reason: { type: "string", description: "Optional reason" },
        monologue: {
          type: "string",
          description:
            "Optional one or two sentences of inner monologue in your character's voice, as plain text, alongside the reason for the delay.",
        },
        ...delayTaskParameters,
      },
      required: requiredBy("delayTaskParameters"),
      additionalProperties: false,
    },
    async execute(_id, params: TaskToolArguments<DelayTaskParams>) {
      await clock.init();
      await untilRunning(clock, shutdownSignal());
      const result = await executeDelayTask(
        params,
        resolveExecutionContext(toolContext),
      );
      if (result.success && result.task && result.payload) {
        const agentId = toolContext?.agentId ?? "main";
        await automation.synchronize?.(agentId);
        notifyTaskChange(agentId, result.task);
        deps.broadcaster?.broadcast({
          type: "journal",
          event: {
            seq: nextJournalSeq(),
            simTime: clock.time(),
            kind: "task.delayed",
            actors: [agentId],
            payload: result.payload,
          },
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
        idleText: config.supervisor.idleText,
        cell: sharedSupervisorCell(),
      });
    },
  };
}
