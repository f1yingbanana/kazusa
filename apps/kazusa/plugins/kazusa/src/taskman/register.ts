import {
  generateSecureUuid,
  type OpenClawPluginApi,
  type OpenClawPluginToolContext,
} from "openclaw/plugin-sdk/core";
import {
  appendSessionTranscriptMessageByIdentity,
  publishSessionTranscriptUpdateByIdentity,
} from "openclaw/plugin-sdk/session-transcript-runtime";
import { z } from "zod";
import type { Clock } from "../clock/clock.ts";
import type { KazusaRealtimeBroadcaster } from "../realtime.ts";
import { nextJournalSeq } from "../realtime.ts";
import type { Perception } from "../perception/perception.ts";
import { startIdleSupervisor } from "./supervisor.ts";
import { executeDelayTask, executeStartTask } from "./taskman.ts";
import {
  TASK_CATEGORIES,
  type ActiveTask,
  type DelayTaskParams,
  type StartTaskParams,
  type TaskStore,
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
  },
): TaskmanService {
  const { clock } = deps;
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
  let automationsReady = false;
  let synchronizeAgentAutomation:
    ((agentId: string) => Promise<void>) | undefined;
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
    automationsReady = false;
    synchronizeAgentAutomation = undefined;
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
        await removeJob(job.id);
      }
    };

    if (!event.enabled) {
      await clear();
      return;
    }

    synchronizeAgentAutomation = synchronize;
    reconcileAutomations = async (): Promise<void> => {
      const tasks = await store.entries();
      if (clock.now().speed <= 0) {
        await clear();
        return;
      }
      const activeAgentIds = new Set(tasks.map(({ key }) => key));
      const jobs = await listJobs();
      for (const job of jobs) {
        // Kazusa currently owns all automations, so a job not represented by a
        // retained lease is stale. This is deliberately lifecycle-only work.
        if (!job.declarationKey || !activeAgentIds.has(job.declarationKey)) {
          await removeJob(job.id);
        }
      }
      for (const { key: agentId } of tasks) {
        await synchronize(agentId);
      }
    };
    automationsReady = true;
    await reconcileAutomations();
  });

  // Cron jobs are not allowed to run while Taskman is rebuilding its retained
  // projection after startup or reload. The brain session serializes all
  // normal character turns, so no per-run task lookup or repair is required.
  api.on("before_agent_run", (_event, ctx) => {
    if (ctx.jobId && !automationsReady) {
      return { outcome: "block", reason: "kazusa:taskman-initializing" };
    }
  });

  const appendTaskLedgerEntry = async (
    agentId: string,
    message: string,
    timestamp: number,
    metadata?: unknown,
  ): Promise<void> => {
    const sessionKey = `agent:${agentId}:tasks`;
    const now = Date.now();
    const ledger = await api.runtime.agent.session.patchSessionEntry({
      agentId,
      sessionKey,
      fallbackEntry: { sessionId: "", updatedAt: now, displayName: "Tasks" },
      update: (entry) =>
        entry.sessionId?.trim()
          ? null
          : { sessionId: generateSecureUuid(), updatedAt: now },
    });
    const sessionId = ledger?.sessionId?.trim();
    if (!sessionId) {
      throw new Error(`Could not initialize task ledger ${sessionKey}.`);
    }
    const identity = { agentId, sessionKey, sessionId };
    // This separate ledger needs an append, without loading its history into a
    // SessionManager. The identity helper owns the write transaction; notify
    // transcript subscribers only after it returns a committed message ID.

    const appended = await appendSessionTranscriptMessageByIdentity({
      ...identity,
      message: {
        role: "assistant",
        content: [{ type: "text", text: message }],
        // Character experience uses simulation time. Native entry/envelope
        // bookkeeping remains wall-clock for OpenClaw's lifecycle machinery.
        timestamp,
        ...(metadata ? { __openclaw: { kazusa: metadata } } : {}),
      },
    });
    if (!appended) {
      throw new Error(`Task ledger append was suppressed for ${sessionKey}.`);
    }
    await publishSessionTranscriptUpdateByIdentity({
      ...identity,
      update: { messageId: appended.messageId },
    });
  };

  const resolveExecutionContext = (
    toolContext?: OpenClawPluginToolContext,
  ): ToolExecutionContext => {
    const agentId = toolContext?.agentId ?? "main";
    return {
      agentId,
      store,
      clock,
      minDuration: config.minDuration,
      appendTaskLedgerEntry: (message, timestamp, metadata): Promise<void> =>
        appendTaskLedgerEntry(agentId, message, timestamp, metadata),
    };
  };

  api.registerTool((toolContext) => ({
    name: "start_task",
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
      },
      required: ["type", "description", "duration"],
      additionalProperties: false,
    },
    async execute(_id, params: StartTaskParams) {
      await clock.init();
      const result = await executeStartTask(
        params,
        resolveExecutionContext(toolContext),
      );
      if (result.success && result.task) {
        const agentId = toolContext?.agentId ?? "main";
        await synchronizeAgentAutomation?.(agentId);
        notifyTaskChange(agentId, result.task);
        deps.broadcaster?.broadcast({
          type: "journal",
          event: {
            seq: nextJournalSeq(),
            simTime: clock.time(),
            kind: "task.started",
            actors: [agentId],
            payload: {
              taskId: result.task.id,
              type: result.task.type,
              description: result.task.description,
              duration: result.task.duration,
              endAt: Date.parse(result.task.endAt),
              summary: params.summary,
              monologue: params.monologue,
            },
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
      },
      additionalProperties: false,
    },
    async execute(_id, params: DelayTaskParams) {
      await clock.init();
      const result = await executeDelayTask(
        params,
        resolveExecutionContext(toolContext),
      );
      if (result.success && result.task) {
        const agentId = toolContext?.agentId ?? "main";
        await synchronizeAgentAutomation?.(agentId);
        notifyTaskChange(agentId, result.task);
        deps.broadcaster?.broadcast({
          type: "journal",
          event: {
            seq: nextJournalSeq(),
            simTime: clock.time(),
            kind: "task.delayed",
            actors: [agentId],
            payload: {
              taskId: result.task.id,
              additionalMinutes: params.additionalDuration ?? 5,
              endAt: Date.parse(result.task.endAt),
              reason: params.reason,
              monologue: params.monologue,
            },
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
      });
    },
  };
}
