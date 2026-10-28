import type { Clock } from "../clock/clock.ts";
import type { StateStore } from "../state.ts";

/** Canonical major task categories recognized across the simulation framework. */
export const TASK_CATEGORIES = [
  "sleeping",
  "traveling",
  "eating",
  "studying",
  "working",
  "socializing",
  "having fun",
  "miscellaneous",
] as const;

export type TaskCategory = (typeof TASK_CATEGORIES)[number];

/** Durable active-task lease. */
export interface ActiveTask {
  readonly id: string;
  readonly type: TaskCategory;
  readonly description: string;
  readonly startedAt: string;
  readonly endAt: string;
  readonly duration: number;
  readonly metadata?: Record<string, unknown>;
}

/** The keyed-store operations Taskman uses. */
export type TaskStore = StateStore<ActiveTask>;

/** A lease about to be written by `start_task` or `delay_task`. */
export interface TaskTransition {
  readonly kind: "started" | "delayed";
  readonly agentId: string;
  /** Sim time of the transition. */
  readonly at: number;
  readonly task: ActiveTask;
  /** Raw tool arguments; each extension validates its own parameters. */
  readonly params: Readonly<Record<string, unknown>>;
}

/**
 * Another module's contribution to the task tools. Taskman stays ignorant of
 * what the parameters mean.
 */
export interface TaskExtension {
  /** JSON-schema properties merged into `start_task`'s parameters. */
  readonly startTaskParameters: Readonly<Record<string, unknown>>;
  /** The same properties for `delay_task`, which may refer to `start_task`. */
  readonly delayTaskParameters: Readonly<Record<string, unknown>>;
  /** Which of the properties both tools require. */
  readonly required: readonly string[];
  /** Runs before the lease is written; a thrown error fails the tool call. */
  beforeCommit(transition: TaskTransition): Promise<void>;
}

/** Context passed to task tool execution. */
export interface ToolExecutionContext {
  readonly agentId: string;
  readonly store: TaskStore;
  readonly clock: Pick<Clock, "time">;
  readonly minDuration: number;
  readonly beforeCommit?: (transition: TaskTransition) => Promise<void>;
  readonly appendTaskLedgerEntry: (
    message: string,
    timestamp: number,
    metadata?: unknown,
  ) => Promise<void>;
}

/** Tool arguments, including parameters contributed by extensions. */
export type TaskToolArguments<T> = T & Readonly<Record<string, unknown>>;

export interface StartTaskParams {
  readonly type: TaskCategory;
  readonly description: string;
  readonly duration: number;
  /** What happened in the prior task when this call replaces one. */
  readonly summary?: string;
  /** One or two sentences in the character's voice, as plain text. */
  readonly monologue?: string;
  readonly metadata?: Record<string, unknown>;
}

export interface DelayTaskParams {
  readonly additionalDuration?: number;
  readonly reason?: string;
  /** One or two sentences in the character's voice, as plain text. */
  readonly monologue?: string;
}

export type StartTaskResult =
  | {
      readonly success: true;
      readonly task: ActiveTask;
      readonly message: string;
    }
  | { readonly success: false; readonly message: string };

export interface DelayTaskResult {
  readonly success: boolean;
  readonly task?: ActiveTask;
  readonly message: string;
}
