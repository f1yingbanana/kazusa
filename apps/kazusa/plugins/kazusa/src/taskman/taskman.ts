import { randomUUID } from "node:crypto";
import type {
  ActiveTask,
  DelayTaskParams,
  DelayTaskResult,
  StartTaskParams,
  StartTaskResult,
  TaskToolArguments,
  TaskTransition,
  ToolExecutionContext,
} from "./types.ts";

/** Let extensions see the lease first; their refusal leaves nothing written. */
async function commitExtensions(
  ctx: ToolExecutionContext,
  transition: TaskTransition,
): Promise<string | undefined> {
  try {
    await ctx.beforeCommit?.(transition);
    return undefined;
  } catch (error: unknown) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** Append character voice as a separate italic blockquote in the ledger text. */
function formatTaskLedgerEntry(summary: string, monologue?: string): string {
  const speech = monologue?.trim();
  if (!speech) return summary;
  // Keep plain character speech in one quoted paragraph, even when it contains
  // line breaks or Markdown punctuation.
  const quoted = speech.replace(/\s+/gu, " ").replace(/[\\`*_<>[\]]/gu, "\\$&");
  return `${summary}\n\n> *${quoted}*`;
}

export async function executeStartTask(
  params: TaskToolArguments<StartTaskParams>,
  ctx: ToolExecutionContext,
): Promise<StartTaskResult> {
  const duration = Math.max(
    ctx.minDuration,
    Math.round(params.duration || ctx.minDuration),
  );
  const timestamp = ctx.clock.time();
  const startedAt = new Date(timestamp).toISOString();
  const endAt = new Date(
    new Date(startedAt).getTime() + duration * 60_000,
  ).toISOString();
  const task: ActiveTask = {
    id: randomUUID(),
    type: params.type,
    description: params.description,
    startedAt,
    endAt,
    duration,
    ...(params.metadata === undefined ? {} : { metadata: params.metadata }),
  };

  const priorTask = await ctx.store.lookup(ctx.agentId);
  const refusal = await commitExtensions(ctx, {
    kind: "started",
    agentId: ctx.agentId,
    at: timestamp,
    task,
    params,
  });
  if (refusal !== undefined) {
    return { success: false, message: `Task not started: ${refusal}` };
  }
  await ctx.store.register(ctx.agentId, task);
  const priorSummary = params.summary?.trim();
  const message = priorTask
    ? `Concluded ${priorTask.type} task.${priorSummary ? ` Summary: "${priorSummary}".` : ""} Started ${task.type} task: "${task.description}". Scheduled to conclude at ${endAt} (${duration} minutes).`
    : `Started ${task.type} task: "${task.description}". Scheduled to conclude at ${endAt} (${duration} minutes).`;
  await ctx.appendTaskLedgerEntry(
    formatTaskLedgerEntry(message, params.monologue),
    timestamp,
    {
      kind: "task.started",
      payload: {
        taskId: task.id,
        type: task.type,
        description: task.description,
        duration: task.duration,
        endAt: Date.parse(task.endAt),
        summary: params.summary,
        monologue: params.monologue,
        replacedTaskId: priorTask?.id,
      },
    },
  );
  return { success: true, task, message };
}

export async function executeDelayTask(
  params: TaskToolArguments<DelayTaskParams>,
  ctx: ToolExecutionContext,
): Promise<DelayTaskResult> {
  const timestamp = ctx.clock.time();
  const current = await ctx.store.lookup(ctx.agentId);
  if (!current) {
    return { success: false, message: "No active task in progress to delay." };
  }

  const additionalDuration = Math.max(
    1,
    Math.round(params.additionalDuration ?? 5),
  );
  const task: ActiveTask = {
    ...current,
    id: current.id ?? randomUUID(),
    duration: current.duration + additionalDuration,
    endAt: new Date(
      new Date(current.endAt).getTime() + additionalDuration * 60_000,
    ).toISOString(),
  };
  const refusal = await commitExtensions(ctx, {
    kind: "delayed",
    agentId: ctx.agentId,
    at: timestamp,
    task,
    params,
  });
  if (refusal !== undefined) {
    return { success: false, message: `Task not delayed: ${refusal}` };
  }
  await ctx.store.register(ctx.agentId, task);

  const reason = params.reason ? ` Reason: ${params.reason}.` : "";
  const message = `Delayed current task by ${additionalDuration} minutes. New completion time: ${task.endAt}.${reason}`;
  await ctx.appendTaskLedgerEntry(
    formatTaskLedgerEntry(message, params.monologue),
    timestamp,
    {
      kind: "task.delayed",
      payload: {
        taskId: task.id,
        additionalMinutes: additionalDuration,
        endAt: Date.parse(task.endAt),
        reason: params.reason,
        monologue: params.monologue,
      },
    },
  );
  return { success: true, task, message };
}
