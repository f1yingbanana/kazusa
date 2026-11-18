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

/** What an extension says about a transition, for its history. */
export interface TaskCommitReport {
  /** One sentence added to the ledger row and the tool result. */
  readonly note?: string;
  /**
   * Said to the character with `start_task`'s result and nowhere else: never in
   * their records, so it is read once, in the turn that made the call.
   */
  readonly aside?: string;
  /** Structured fields merged into the ledger row's journal payload. */
  readonly payload?: Readonly<Record<string, unknown>>;
}

/** What an extension will do once every extension accepted a transition. */
export interface PreparedTaskCommit extends TaskCommitReport {
  /**
   * Sim ms by which this lease needs a check-in (an arrival). The earliest one
   * brings the lease's end forward; its one wake is the check-in.
   */
  readonly checkInAt?: number;
  /**
   * Writes the extension's own state against the final lease, before it is
   * written. What it returns is reported in place of what was prepared: an
   * extension whose write is worked out as it lands (another change may have
   * come first) says what it wrote, not what it expected to.
   */
  commit(task: ActiveTask): Promise<TaskCommitReport | void>;
}

/**
 * Another module's contribution to the task tools. Taskman stays ignorant of
 * what the parameters mean.
 */
export interface TaskExtension {
  /** JSON-schema properties merged into `start_task`'s parameters. */
  readonly startTaskParameters: Readonly<Record<string, unknown>>;
  /**
   * `start_task`'s properties for one character, when they differ from person
   * to person; read whenever the tool is built, in place of the above.
   */
  readonly startTaskParametersFor?: (
    agentId: string | undefined,
  ) => Readonly<Record<string, unknown>>;
  /** The same properties for `delay_task`, which may refer to `start_task`. */
  readonly delayTaskParameters: Readonly<Record<string, unknown>>;
  /** Required properties; each tool requires only the ones it takes. */
  readonly required: readonly string[];
  /**
   * Validates a lease about to be written, without writing anything. A thrown
   * error fails the tool call, and no extension commits unless all accepted.
   */
  prepare(transition: TaskTransition): Promise<PreparedTaskCommit>;
}

/** Context passed to task tool execution. */
export interface ToolExecutionContext {
  readonly agentId: string;
  readonly store: TaskStore;
  readonly clock: Pick<Clock, "time">;
  readonly minDuration: number;
  /** A `kazusa-results` section, filled: what an activity change says. */
  readonly text: (
    section: string,
    values: Readonly<Record<string, string | number>>,
  ) => string;
  readonly prepare?: (
    transition: TaskTransition,
  ) => Promise<readonly PreparedTaskCommit[]>;
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
  /** How much longer from now the activity will take, as they estimate it. */
  readonly minutesLeft: number;
  readonly reason?: string;
  /** One or two sentences in the character's voice, as plain text. */
  readonly monologue?: string;
}

/** `task.started` journal fields; extensions add their own beside them. */
export interface TaskStartedPayload extends Readonly<Record<string, unknown>> {
  readonly taskId: string;
  readonly type: string;
  readonly description: string;
  readonly duration: number;
  readonly endAt: number;
  readonly summary?: string;
  readonly monologue?: string;
  readonly replacedTaskId?: string;
}

/** `task.delayed` journal fields; extensions add their own beside them. */
export interface TaskDelayedPayload extends Readonly<Record<string, unknown>> {
  readonly taskId: string;
  readonly endAt: number;
  readonly reason?: string;
  readonly monologue?: string;
}

export type StartTaskResult =
  | {
      readonly success: true;
      readonly task: ActiveTask;
      readonly message: string;
      /** What extensions say with the result alone (`aside`). */
      readonly aside?: string;
      /** The journal payload written with the ledger row. */
      readonly payload: TaskStartedPayload;
      /** The ledger row's sim time; the live event must carry the same one. */
      readonly simTime: number;
    }
  | { readonly success: false; readonly message: string };

export interface DelayTaskResult {
  readonly success: boolean;
  readonly task?: ActiveTask;
  readonly message: string;
  /** The journal payload written with the ledger row. */
  readonly payload?: TaskDelayedPayload;
  /** The ledger row's sim time; the live event must carry the same one. */
  readonly simTime?: number;
}
