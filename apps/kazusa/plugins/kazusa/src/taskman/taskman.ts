import { randomUUID } from "node:crypto";
import { formatSimTime } from "../context-engine/format.ts";
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
  const started = ctx.text("task-started", {
    type: lease.type,
    description: lease.description,
    notes: extensions.notes,
    until: formatSimTime(Date.parse(lease.endAt)),
    minutes: Math.round(lease.duration),
  });
  const message = !priorTask
    ? started
    : priorSummary
      ? ctx.text("task-finished-summary", {
          type: priorTask.type,
          summary: priorSummary,
          started,
        })
      : ctx.text("task-finished", { type: priorTask.type, started });
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
  return { success: true, task: lease, message, payload, simTime: timestamp };
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

  if (!Number.isFinite(params.minutesLeft)) {
    return { success: false, message: ctx.text("task-no-estimate", {}) };
  }
  // From now, not from the planned end: an activity that already ran over
  // would otherwise still be over after it was extended. Never earlier than
  // planned, though: that would hurry a trip along (start_task changes plans).
  const endAt = Math.max(
    Date.parse(current.endAt),
    timestamp + Math.max(1, Math.round(params.minutesLeft)) * 60_000,
  );
  const task: ActiveTask = {
    ...current,
    id: current.id ?? randomUUID(),
    duration: (endAt - Date.parse(current.startedAt)) / 60_000,
    endAt: new Date(endAt).toISOString(),
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

  const reason = params.reason?.trim();
  const delayed = {
    minutes: Math.round((Date.parse(lease.endAt) - timestamp) / 60_000),
    until: formatSimTime(Date.parse(lease.endAt)),
    notes: extensions.notes,
  };
  const message = reason
    ? ctx.text("task-delayed-reason", {
        ...delayed,
        reason: /[.!?]$/.test(reason) ? reason : `${reason}.`,
      })
    : ctx.text("task-delayed", delayed);
  const payload = {
    taskId: lease.id,
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
  return { success: true, task: lease, message, payload, simTime: timestamp };
}
