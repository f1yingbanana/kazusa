import { randomUUID } from "node:crypto";
import type {
  ActiveTask,
  DelayTaskParams,
  DelayTaskResult,
  PreparedTaskCommit,
  StartTaskParams,
  StartTaskResult,
  TaskToolArguments,
  TaskTransition,
  ToolExecutionContext,
} from "./types.ts";

interface CommittedExtensions {
  /** The lease as written: an extension may have brought its end forward. */
  readonly task: ActiveTask;
  /** Extension sentences, each prefixed with a space, or empty. */
  readonly notes: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

/** The lease ending at the earliest check-in an extension asked for. */
function checkedIn(
  task: ActiveTask,
  prepared: readonly PreparedTaskCommit[],
): ActiveTask {
  const startedAt = Date.parse(task.startedAt);
  const end = Math.min(
    Date.parse(task.endAt),
    ...prepared.flatMap(({ checkInAt }) =>
      checkInAt === undefined ? [] : [Math.max(startedAt, checkInAt)],
    ),
  );
  if (end === Date.parse(task.endAt)) return task;
  return {
    ...task,
    endAt: new Date(end).toISOString(),
    duration: task.duration - (Date.parse(task.endAt) - end) / 60_000,
  };
}

/**
 * Let every extension see the lease first. One refusal leaves nothing written;
 * otherwise each extension commits against the final lease before it is
 * written.
 */
async function commitExtensions(
  ctx: ToolExecutionContext,
  transition: TaskTransition,
): Promise<{ readonly refusal: string } | CommittedExtensions> {
  let prepared: readonly PreparedTaskCommit[];
  try {
    prepared = (await ctx.prepare?.(transition)) ?? [];
  } catch (error: unknown) {
    return { refusal: error instanceof Error ? error.message : String(error) };
  }
  const task = checkedIn(transition.task, prepared);
  for (const extension of prepared) await extension.commit(task);
  return {
    task,
    notes: prepared
      .map(({ note }) => note?.trim())
      .filter((note): note is string => !!note)
      .map((note) => ` ${note}`)
      .join(""),
    payload: prepared.reduce<Record<string, unknown>>(
      (all, { payload }) => ({ ...all, ...payload }),
      {},
    ),
  };
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
  const extensions = await commitExtensions(ctx, {
    kind: "started",
    agentId: ctx.agentId,
    at: timestamp,
    task,
    params,
  });
  if ("refusal" in extensions) {
    return {
      success: false,
      message: `Task not started: ${extensions.refusal}`,
    };
  }
  const lease = extensions.task;
  await ctx.store.register(ctx.agentId, lease);
  const priorSummary = params.summary?.trim();
  const started = `Started ${lease.type} task: "${lease.description}".${extensions.notes} Scheduled to conclude at ${lease.endAt} (${Math.round(lease.duration)} minutes).`;
  const message = priorTask
    ? `Concluded ${priorTask.type} task.${priorSummary ? ` Summary: "${priorSummary}".` : ""} ${started}`
    : started;
  const payload = {
    taskId: lease.id,
    type: lease.type,
    description: lease.description,
    duration: lease.duration,
    endAt: Date.parse(lease.endAt),
    summary: params.summary,
    monologue: params.monologue,
    replacedTaskId: priorTask?.id,
    ...extensions.payload,
  };
  await ctx.appendTaskLedgerEntry(
    formatTaskLedgerEntry(message, params.monologue),
    timestamp,
    { kind: "task.started", payload },
  );
  return { success: true, task: lease, message, payload };
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
  const extensions = await commitExtensions(ctx, {
    kind: "delayed",
    agentId: ctx.agentId,
    at: timestamp,
    task,
    params,
  });
  if ("refusal" in extensions) {
    return {
      success: false,
      message: `Task not delayed: ${extensions.refusal}`,
    };
  }
  const lease = extensions.task;
  await ctx.store.register(ctx.agentId, lease);

  const reason = params.reason ? ` Reason: ${params.reason}.` : "";
  const message = `Delayed current task by ${additionalDuration} minutes. New completion time: ${lease.endAt}.${reason}${extensions.notes}`;
  const payload = {
    taskId: lease.id,
    additionalMinutes: additionalDuration,
    endAt: Date.parse(lease.endAt),
    reason: params.reason,
    monologue: params.monologue,
    ...extensions.payload,
  };
  await ctx.appendTaskLedgerEntry(
    formatTaskLedgerEntry(message, params.monologue),
    timestamp,
    { kind: "task.delayed", payload },
  );
  return { success: true, task: lease, message, payload };
}
