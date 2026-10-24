import type { Clock } from "../clock/clock.ts";

/** Durable active-task lease. */
export interface ActiveTask {
  readonly type: string;
  readonly description: string;
  readonly startedAt: string;
  readonly endAt: string;
  readonly duration: number;
  readonly metadata?: Record<string, unknown>;
}

/** The keyed-store operations Taskman uses. */
export interface TaskStore {
  lookup(key: string): Promise<ActiveTask | undefined>;
  register(key: string, value: ActiveTask): Promise<void>;
  entries(): Promise<
    ReadonlyArray<{ readonly key: string; readonly value: ActiveTask }>
  >;
}

/** Context passed to task tool execution. */
export interface ToolExecutionContext {
  readonly agentId: string;
  readonly store: TaskStore;
  readonly clock: Pick<Clock, "time">;
  readonly minDuration: number;
  readonly appendTaskLedgerEntry: (
    message: string,
    timestamp: number,
  ) => Promise<void>;
}

export interface StartTaskParams {
  readonly type: string;
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
