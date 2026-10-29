import { runDetachedWebhookWork } from "openclaw/plugin-sdk/webhook-request-guards";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import {
  KeyedAsyncQueue,
  type OpenClawPluginApi,
} from "openclaw/plugin-sdk/core";
import type {
  DecisionBatch,
  DecisionOutcome,
  DecisionRuntimeV1,
} from "openclaw/plugin-sdk/decisions";
import type { GetReplyOptions } from "openclaw/plugin-sdk/reply-runtime";
import type { Clock } from "../clock/clock.ts";
import {
  formatSessionHeader,
  formatSimTime,
} from "../context-engine/format.ts";
import type { DecisionContextAssembler } from "../context-engine/decision-context.ts";
import { stimulusKey } from "../stimulus.ts";
import type { StateStore } from "../state.ts";

/**
 * Runs a callback in the async context this module was loaded in, at Gateway
 * startup. A readiness timer armed during a tool call (a sighting foreseen by
 * someone's `start_task`) wakes long after that call closed; inside its scope,
 * the decision runtime and brain handoff refuse ("agent tool caller authority
 * is no longer active"), and the character is quarantined.
 */
const outsideCallers = AsyncLocalStorage.snapshot();

/**
 * Starts work that outlives its caller. `runDetachedWebhookWork` keeps Gateway
 * admission but not the caller's request scope, so work started from an RPC or
 * HTTP call is refused once that client disconnects ("Gateway caller authority
 * is no longer active"). Live, every stimulus from `location.place` fell back.
 */
function detached<T>(run: () => Promise<T>): Promise<T> {
  return outsideCallers(() => runDetachedWebhookWork(run));
}
export type { StateStore } from "../state.ts";
import type { ActiveTask, TaskStore } from "../taskman/types.ts";
import { personLabel } from "../person-label.ts";
import { z } from "zod";
import {
  PERCEPTION_CONFIG,
  STIMULUS,
  latencyMs,
  type AttentionDecision,
  type DecisionTrace,
  type PerceptionConfig,
  type PerceptionDecisionRecord,
  type SpeechSource,
  type Stimulus,
} from "./types.ts";

/**
 * `QUEUE_NEXT` marks attention already approved. `until` holds it back: it is
 * ready once `notBefore` passes or its bound task is over, whichever is first.
 */
export interface PendingItem extends Stimulus {
  action?: "QUEUE_NEXT";
  until?: { taskId?: string; notBefore?: number };
}

const LATENCY_ANCHORS = z.array(z.looseObject({ minutes: z.number().min(0) }));

export interface PerceptionState {
  pending: PendingItem[];
  brainRun?: string;
  brainContext?: string;
  /**
   * Retained until host adoption; an interrupted handoff must not be blindly
   * replayed.
   */
  deliveries?: PerceptionDelivery[];
  stopped?: boolean;
  /** Adopted or ignored stimulus keys, for deduplication. */
  processedIds?: string[];
  /** The ignored subset: discarded on purpose, never shown to the brain. */
  ignoredIds?: string[];
}

/*
 * The "perception" store holds Perception's records: one `PerceptionState`
 * per character, keyed by agent id, and one entry per attention decision,
 * keyed `<agentId>:decision:<id>`. Agent ids never contain ":".
 */
const DECISION_KEY = ":decision:";

function isDecisionKey(key: string): boolean {
  return key.includes(DECISION_KEY);
}

export interface PerceptionDelivery {
  id: string;
  agentId: string;
  mode: "steer" | "followup";
  message: string;
  ids: string[];
  keys: string[];
  sessionKeys?: string[];
}

export interface PerceptionDeps {
  readonly clock: Pick<Clock, "time" | "now">;
  readonly api?: OpenClawPluginApi;
  readonly config?: Partial<PerceptionConfig>;
  readonly assertCurrent?: () => void;
  readonly stateStore?: StateStore<PerceptionState>;
  /** The same "perception" namespace, viewed as decision entries. */
  readonly decisionStore?: StateStore<PerceptionDecisionRecord>;
  readonly tasks?: Pick<TaskStore, "lookup">;
  readonly deliver?: (
    delivery: PerceptionDelivery,
    lifecycle: NonNullable<GetReplyOptions["turnAdoptionLifecycle"]>,
  ) => Promise<void>;
  readonly evaluateDecision?: DecisionRuntimeV1["evaluate"];
  readonly assembleDecisionContext?: DecisionContextAssembler;
  /** Observes each recorded decision; must not throw or block routing. */
  readonly onDecision?: (
    agentId: string,
    record: PerceptionDecisionRecord,
  ) => void;
  /**
   * When a foreseen stimulus's moment comes: what actually happens? Its
   * producer re-checks the world (and may judge it) and returns the stimulus as
   * it happens, or `undefined` to drop it unseen.
   */
  /**
   * The per-character lock, shared by every instance in the process: two
   * instances draining one character decided and delivered the same stimuli
   * twice. Each test gets its own.
   */
  readonly serial?: KeyedAsyncQueue;
  /**
   * Whether a handoff left over from before a restart reached the brain.
   * Absent: it stays quarantined.
   */
  readonly adopted?: (delivery: PerceptionDelivery) => Promise<boolean>;
  /** Whether the character is simulated. Absent: everyone is. */
  readonly onstage?: (agentId: string) => Promise<boolean>;
  readonly confirm?: (
    agentId: string,
    item: Stimulus,
  ) => Promise<Stimulus | undefined>;
}

function formatDeliveryMessage(
  bundle: PendingItem[],
  mode: "steer" | "followup",
  simTime: number,
): string {
  const chatItems = bundle.filter(
    (item) =>
      !item.deadline && !item.idle && item.sessionKey.includes(":chat:"),
  );
  // Things seen around them, recorded in their own `:tasks` ledger.
  const sightings = bundle.filter(
    (item) =>
      !item.deadline && !item.idle && !item.sessionKey.includes(":chat:"),
  );
  const deadlineItems = bundle.filter((item) => Boolean(item.deadline));
  const idleItems = bundle.filter((item) => Boolean(item.idle));

  const parts: string[] = [];

  if (chatItems.length) {
    const header =
      mode === "steer" ? "Messages noticed while thinking:" : "Incoming chats:";
    const formattedChats = chatItems.map((item) => {
      const channel = formatSessionHeader(item.sessionKey);
      return `- [${personLabel(item.senderName, item.sender)} ${formatSimTime(item.timestamp)}] (${channel}): ${item.text}`;
    });
    parts.push(`${header}\n${formattedChats.join("\n")}`);
  }
  if (sightings.length) {
    parts.push(
      `${mode === "steer" ? "Seen while thinking:" : "Seen around you:"}\n${sightings
        .map((item) => `- [${formatSimTime(item.timestamp)}] ${item.text}`)
        .join("\n")}`,
    );
  }

  // Check-ins need no stamp of their own: the delivery stamp is the time they
  // reach the character, and a deadline's text names the planned time.
  for (const item of [...deadlineItems, ...idleItems]) parts.push(item.text);

  // OpenClaw stamps each user turn at the LLM boundary with its wall-clock
  // write time in the host timezone, unless the text already opens with a
  // `[... YYYY-MM-DD HH:mm` envelope. Lead with simulation time so the character
  // never sees the operator's clock.
  return `[${formatSimTime(simTime)}] ${parts.join("\n\n")}`;
}

/**
 * Universal Perception Attention Gate. Evaluates incoming stimuli through
 * TypeSafe AI's Jev Decision Model against the agent's current activity for
 * both idle and busy states.
 */
export class Perception {
  private readonly serial: KeyedAsyncQueue;
  private readonly api?: OpenClawPluginApi;
  private readonly deps: PerceptionDeps;
  private readonly config: PerceptionConfig;
  private readonly store: StateStore<PerceptionState>;
  private readonly decisionStore: StateStore<PerceptionDecisionRecord>;
  private readonly taskStore: Pick<TaskStore, "lookup">;
  private readonly lifetime = new AbortController();
  private readonly debounceTimers = new Map<string, () => void>();
  private readonly readinessTimers = new Map<string, NodeJS.Timeout>();
  private speech?: SpeechSource;
  private readonly adoptedListeners = new Set<
    (delivery: PerceptionDelivery) => void | Promise<void>
  >();
  private readonly brainStateListeners = new Set<
    (agentId: string, brain: "idle" | "thinking", queued: number) => void
  >();

  constructor(deps: PerceptionDeps) {
    this.deps = deps;
    this.api = deps.api;
    this.serial = deps.serial ?? new KeyedAsyncQueue();

    this.config = PERCEPTION_CONFIG.parse(
      this.deps.config ?? this.api?.pluginConfig?.perception ?? {},
    );

    if (this.deps.stateStore && this.deps.decisionStore) {
      this.store = this.deps.stateStore;
      this.decisionStore = this.deps.decisionStore;
    } else if (this.api) {
      this.store = this.api.runtime.state.openKeyedStore<PerceptionState>({
        namespace: "perception",
        retention: "retained",
      });
      this.decisionStore =
        this.api.runtime.state.openKeyedStore<PerceptionDecisionRecord>({
          namespace: "perception",
          retention: "retained",
        });
    } else {
      throw new Error(
        "Perception requires an api or stateStore and decisionStore dependencies.",
      );
    }

    if (this.deps.tasks) {
      this.taskStore = this.deps.tasks;
    } else if (this.api) {
      this.taskStore = this.api.runtime.state.openKeyedStore<ActiveTask>({
        namespace: "tasks",
        retention: "retained",
      });
    } else {
      throw new Error("Perception requires an api or a tasks dependency.");
    }
  }

  private assertCurrent(): void {
    this.lifetime.signal.throwIfAborted();
    this.deps.assertCurrent?.();
  }

  async receive(agentId: string, input: Stimulus): Promise<void> {
    const stimulus = STIMULUS.parse(input);
    if (
      !stimulus.sessionKey.startsWith(`agent:${agentId}:chat:`) &&
      stimulus.sessionKey !== `agent:${agentId}:tasks`
    ) {
      throw new Error(
        "Perception input must belong to the recipient's chat or task ledger.",
      );
    }
    let pendingCount = 0;
    let shouldDrain = false;
    await this.change(
      agentId,
      (state) => {
        // Drop duplicates of recently adopted or ignored stimuli
        if (state.processedIds?.includes(stimulusKey(stimulus))) {
          return;
        }

        const alreadyPending = state.pending.some(
          (item) => stimulusKey(item) === stimulusKey(stimulus),
        );
        if (alreadyPending) {
          // If the stimulus is already pending and the handoff was explicitly stopped
          // (proven rejected/abandoned) without an in-flight delivery, retry resumes the handoff.
          if (state.stopped && !state.deliveries?.length) {
            state.stopped = false;
            shouldDrain = true;
            pendingCount = state.pending.filter(
              (item) =>
                !item.action &&
                !state.deliveries?.some((delivery) =>
                  delivery.keys.includes(stimulusKey(item)),
                ),
            ).length;
          }
          return;
        }

        if (!state.deliveries?.length) state.stopped = false;
        state.pending.push(stimulus);
        pendingCount = state.pending.filter(
          (item) =>
            !item.action &&
            !state.deliveries?.some((delivery) =>
              delivery.keys.includes(stimulusKey(item)),
            ),
        ).length;
        shouldDrain = !state.stopped;
      },
      false,
    );

    if (!shouldDrain) return;

    // If batch size threshold reached, flush immediately without debouncing
    if (pendingCount >= this.config.maxBatchSize) {
      const existing = this.debounceTimers.get(agentId);
      if (existing) {
        existing();
        this.debounceTimers.delete(agentId);
      }
      await this.drain(agentId);
      return;
    }

    // Debounce incoming rapid-fire messages into a coalesced sensory bundle
    if (this.config.coalesceWindowMs > 0) {
      const existing = this.debounceTimers.get(agentId);
      if (existing) return;
      // Reserve while ingress still owns admission, including the time spent
      // waiting. A bare timer would inherit a request/tool scope that can close.
      // Keep the fixed first-arrival window: a quiet-period debouncer would
      // change attention timing under continuous traffic.
      const ready = new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => {
          this.debounceTimers.delete(agentId);
          resolve(true);
        }, this.config.coalesceWindowMs);
        this.debounceTimers.set(agentId, () => {
          clearTimeout(timer);
          resolve(false);
        });
      });
      void detached(async () => {
        if (await ready) await this.drain(agentId);
      }).catch((error: unknown) => this.warn(error));
    } else {
      await this.drain(agentId);
    }
  }

  /** `note` is what the lease's end means elsewhere, such as an arrival. */
  async deadline(agentId: string, note?: string): Promise<void> {
    const task = await this.taskStore.lookup(agentId);
    if (!task?.id) return;
    const simNow = this.deps.clock.time();
    if (
      !Number.isFinite(Date.parse(task.endAt)) ||
      Date.parse(task.endAt) > simNow
    )
      return;
    const stimulus: Stimulus = {
      id: `task-deadline:${task.id}:${task.endAt}`,
      sessionKey: `agent:${agentId}:tasks`,
      sender: "kazusa:clock",
      text: `Activity check-in: your ${task.type} activity was planned to end at ${formatSimTime(Date.parse(task.endAt))}. ${note ? `${note} ` : ""}Reassess your progress.`,
      deadline: { taskId: task.id, endAt: task.endAt },
      timestamp: Date.parse(task.endAt),
    };
    await this.receive(agentId, stimulus);
  }

  async idleWake(agentId: string, text?: string): Promise<void> {
    const task = await this.taskStore.lookup(agentId);
    const simNow = this.deps.clock.time();
    if (
      task &&
      Number.isFinite(Date.parse(task.endAt)) &&
      Date.parse(task.endAt) > simNow
    ) {
      return;
    }
    const stimulus: Stimulus = {
      id: `task-idle:${agentId}:${simNow}`,
      sessionKey: `agent:${agentId}:tasks`,
      sender: "kazusa:taskman",
      text: text ?? "Activity check-in: no scheduled activity.",
      idle: true,
      timestamp: simNow,
    };
    await this.receive(agentId, stimulus);
  }

  /**
   * Captures the prompt body currently being processed by the character's
   * brain.
   *
   * When new sensory stimuli arrive while the brain is busy, Jev compares the
   * incoming stimulus against this active thought context to determine whether
   * the stimulus warrants an immediate interruption (STEER) or can wait
   * (QUEUE_NEXT).
   */
  async attending(agentId: string, text: string): Promise<void> {
    await this.change(
      agentId,
      (state) => {
        state.brainContext = text.slice(-this.config.maxBatchChars);
      },
      false,
    );
  }

  private notifyBrainState(
    agentId: string,
    brain: "idle" | "thinking",
    queued: number,
  ): void {
    for (const listener of this.brainStateListeners) {
      try {
        listener(agentId, brain, queued);
      } catch (err: unknown) {
        this.warn(err);
      }
    }
  }

  onBrainStateChange(
    listener: (
      agentId: string,
      brain: "idle" | "thinking",
      queued: number,
    ) => void,
  ): () => void {
    this.brainStateListeners.add(listener);
    return () => {
      this.brainStateListeners.delete(listener);
    };
  }

  async getBrainState(agentId: string): Promise<{
    brain: "idle" | "thinking";
    queued: number;
  }> {
    const state = await this.store.lookup(agentId);
    return {
      brain: state?.brainRun ? "thinking" : "idle",
      queued: state?.pending?.length ?? 0,
    };
  }

  async started(agentId: string, runId: string): Promise<void> {
    let queued = 0;
    await this.change(
      agentId,
      (state) => {
        if (state.brainRun === runId) return;
        state.brainRun = runId;
        queued = state.pending.length;
      },
      false,
    );
    this.notifyBrainState(agentId, "thinking", queued);
  }

  async ended(agentId: string, runId: string, stopped: boolean): Promise<void> {
    let queued = 0;
    let changed = false;
    await this.change(agentId, (state) => {
      if (state.brainRun === runId || state.brainRun === "external") {
        delete state.brainRun;
        delete state.brainContext;
        state.stopped = stopped;
        queued = state.pending.length;
        changed = true;
      } else return;
    });
    if (changed) {
      this.notifyBrainState(agentId, "idle", queued);
    }
  }

  /**
   * Which stimuli the brain was actually shown. Ignored ones were discarded on
   * purpose, and waiting ones have not been read yet.
   */
  async noticed(
    agentId: string,
  ): Promise<(ref: Pick<Stimulus, "id" | "sessionKey">) => boolean> {
    const state = await this.store.lookup(agentId);
    const processed = new Set(state?.processedIds);
    const ignored = new Set(state?.ignoredIds);
    return (ref) => {
      const key = stimulusKey(ref);
      return processed.has(key) && !ignored.has(key);
    };
  }

  /** Let attention see, and cut off, what the character is saying. */
  attachSpeech(source: SpeechSource): void {
    this.speech = source;
  }

  onAdopted(
    listener: (delivery: PerceptionDelivery) => void | Promise<void>,
  ): () => void {
    this.adoptedListeners.add(listener);
    return () => {
      this.adoptedListeners.delete(listener);
    };
  }

  /**
   * A persisted run ID is not a lock. An unconfirmed handoff is reconciled with
   * the brain transcript: adopted input is done (its turn ran, or was cut off
   * mid-way; replaying it could repeat tools), and input the brain never got
   * goes back to waiting. Without a way to tell, it is quarantined.
   */
  async recover(): Promise<void> {
    const entries = (await this.store.entries()).filter(
      ({ key }) => !isDecisionKey(key),
    );
    await Promise.all(
      entries.map(({ key: agentId }) =>
        this.change(
          agentId,
          async (state) => {
            const adopted = this.deps.adopted;
            if (state.deliveries?.length && adopted) {
              for (const delivery of state.deliveries) {
                let done: boolean;
                try {
                  done = await adopted(delivery);
                } catch (error) {
                  this.warn(error);
                  continue;
                }
                if (done) {
                  const keys = new Set(delivery.keys);
                  state.pending = state.pending.filter(
                    (item) => !keys.has(stimulusKey(item)),
                  );
                  state.processedIds = [
                    ...(state.processedIds ?? []),
                    ...delivery.keys,
                  ].slice(-1_000);
                }
                state.deliveries = state.deliveries?.filter(
                  (item) => item.id !== delivery.id,
                );
              }
              if (!state.deliveries?.length) {
                delete state.deliveries;
                state.stopped = false;
              }
            }
            if (state.deliveries?.length) {
              // The previous process may have handed this exact input to the
              // host before saving its receipt. Keep it for reconciliation, not
              // an automatic duplicate turn with potentially repeated tools.
              state.stopped = true;
              this.warn(
                `Unconfirmed brain handoff retained for ${agentId}: ${state.deliveries.map((delivery) => delivery.id).join(", ")}`,
              );
            }
            delete state.brainRun;
            delete state.brainContext;
          },
          true,
        ),
      ),
    );
  }

  private async change(
    agentId: string,
    update: (state: PerceptionState) => void | Promise<void>,
    autoDrain = true,
  ): Promise<void> {
    const delivery = await this.serial.enqueue(agentId, async () => {
      this.assertCurrent();
      const state = (await this.store.lookup(agentId)) ?? {
        pending: [],
      };
      await update(state);
      await this.save(agentId, state);
      if (autoDrain && !state.stopped) return this.drainState(agentId, state);
    });
    // Host dispatch can await this agent's lifecycle callbacks. Never run it
    // under the state lock: new stimuli and start/end events must keep flowing.
    if (delivery) await this.submit(delivery);
  }

  private async save(agentId: string, state: PerceptionState): Promise<void> {
    this.assertCurrent();
    await this.store.register(agentId, state, {
      assertCurrent: () => this.assertCurrent(),
    });
  }

  async drain(agentId: string): Promise<void> {
    await this.change(agentId, () => {});
  }

  /** The clock runs again: take up whatever waited while it was paused. */
  async resume(): Promise<void> {
    const agents = (await this.store.entries())
      .map(({ key }) => key)
      .filter((key) => !isDecisionKey(key));
    await Promise.all(agents.map((agentId) => this.drain(agentId)));
  }

  private batch(items: PendingItem[]): PendingItem[] {
    const selected: PendingItem[] = [];
    let chars = 0;
    for (const item of items) {
      if (
        selected.length >= this.config.maxBatchSize ||
        chars + item.text.length > this.config.maxBatchChars
      )
        break;
      selected.push(item);
      chars += item.text.length;
    }
    return selected;
  }

  private isCurrent(item: Stimulus, task?: ActiveTask): boolean {
    if (item.idle) {
      return !task || Date.parse(task.endAt) <= this.deps.clock.time();
    }
    if (!item.deadline) return true;
    return (
      item.deadline.taskId === task?.id &&
      item.deadline.endAt === task.endAt &&
      Date.parse(task.endAt) <= this.deps.clock.time()
    );
  }

  /** Approved attention waits until its delay passes or its activity ends. */
  private isReady(item: PendingItem, task?: ActiveTask): boolean {
    const now = this.deps.clock.time();
    // A foreseen stimulus has not happened yet.
    if (item.timestamp > now) return false;
    const until = item.until;
    if (!until) return true;
    if (until.notBefore !== undefined && until.notBefore <= now) return true;
    if (until.taskId === undefined) return until.notBefore === undefined;
    return !task || task.id !== until.taskId || Date.parse(task.endAt) <= now;
  }

  /**
   * Re-check readiness when the earliest delay should pass. Task boundaries
   * arrive as deadline stimuli or brain ends, so only `notBefore` needs a
   * timer; the poll cap absorbs clock speed changes and advances.
   */
  private armReadiness(agentId: string, items: readonly PendingItem[]): void {
    const existing = this.readinessTimers.get(agentId);
    if (existing) clearTimeout(existing);
    this.readinessTimers.delete(agentId);
    const { simTime, speed } = this.deps.clock.now();
    const times = items.flatMap((item) => [
      ...(item.until?.notBefore === undefined ? [] : [item.until.notBefore]),
      ...(item.timestamp > simTime ? [item.timestamp] : []),
    ]);
    if (!times.length || this.lifetime.signal.aborted) return;
    const wait =
      speed > 0
        ? Math.min(
            this.config.readinessPollMs,
            Math.max(0, Math.ceil((Math.min(...times) - simTime) / speed)),
          )
        : this.config.readinessPollMs;
    const timer = setTimeout(() => {
      this.readinessTimers.delete(agentId);
      void detached(() => this.drain(agentId)).catch((error: unknown) =>
        this.warn(error),
      );
    }, wait);
    timer.unref();
    this.readinessTimers.set(agentId, timer);
  }

  private async drainState(
    agentId: string,
    state: PerceptionState,
  ): Promise<PerceptionDelivery | undefined> {
    while (!state.stopped) {
      this.assertCurrent();
      // A paused world is frozen: nothing is judged or handed over until the
      // clock runs again (`resume`). Live, a paused meeting of four ran a
      // hundred bubbles at one sim instant.
      const systemAgent =
        this.deps.api?.runtime.config.current().agents?.defaults?.systemAgent
          ?.agentId === agentId;
      if (this.deps.clock.now().speed <= 0 && !systemAgent) return undefined;
      // Offstage, the same holds for one character: what reaches them waits,
      // unjudged, until they come back (`drain`).
      if (this.deps.onstage && !(await this.deps.onstage(agentId)))
        return undefined;
      const task = await this.taskStore.lookup(agentId);
      const reserved = new Set(
        state.deliveries?.flatMap((delivery) => delivery.keys),
      );
      // Keep reserved entries until their host lifecycle resolves custody.
      state.pending = state.pending.filter(
        (item) => reserved.has(stimulusKey(item)) || this.isCurrent(item, task),
      );
      const available = state.pending.filter(
        (item) => !reserved.has(stimulusKey(item)),
      );
      const busy = Boolean(state.brainRun || state.deliveries?.length);
      const now = this.deps.clock.time();
      const happened = this.batch(
        available.filter((item) => !item.action && item.timestamp <= now),
      );
      // A foreseen stimulus is kept only if it still happens now.
      const unconfirmed = new Set<string>();
      for (const item of happened) {
        if (!item.foreseen || !this.deps.confirm) continue;
        let happened: Stimulus | undefined;
        try {
          happened = await this.deps.confirm(agentId, item);
        } catch (error) {
          this.warn(error);
        }
        // Confirmed once is confirmed: it happened as told, and is now ordinary.
        if (happened) {
          item.text = happened.text;
          delete item.foreseen;
        } else unconfirmed.add(stimulusKey(item));
      }
      if (unconfirmed.size) {
        state.pending = state.pending.filter(
          (item) => !unconfirmed.has(stimulusKey(item)),
        );
        state.processedIds = [
          ...(state.processedIds ?? []),
          ...unconfirmed,
        ].slice(-1_000);
        await this.save(agentId, state);
        continue;
      }
      const fresh = happened;
      if (!fresh.length) {
        await this.save(agentId, state);
        if (busy || !available.length) {
          // A busy brain drains when it ends; only what has not happened yet
          // needs a timer meanwhile.
          this.armReadiness(
            agentId,
            available.filter((item) => item.timestamp > now),
          );
          return;
        }
        if (
          !available.some(
            (item) =>
              item.timestamp <= now &&
              (systemAgent || this.isReady(item, task)),
          )
        ) {
          this.armReadiness(agentId, available);
          return;
        }
        // Picking up the phone shows everything that was waiting, but not
        // what has not happened yet.
        return this.reserve(
          agentId,
          state,
          this.batch(available.filter((item) => item.timestamp <= now)),
          "followup",
        );
      }
      const decision: AttentionDecision & DecisionTrace =
        systemAgent ||
        (!busy && fresh.every((item) => item.deadline || item.idle))
          ? { action: "STEER", delayMs: 0, source: "automatic" }
          : await this.classify(agentId, state, task, fresh, busy);
      this.assertCurrent();
      const { action, delayMs } = decision;
      await this.recordDecision(agentId, decision, fresh, busy, task);
      // start_task/delay_task can execute while Jev is evaluating.
      const currentTask = await this.taskStore.lookup(agentId);
      const current = fresh.filter((item) => this.isCurrent(item, currentTask));
      const stale = new Set(
        fresh
          .filter((item) => !this.isCurrent(item, currentTask))
          .map(stimulusKey),
      );
      state.pending = state.pending.filter(
        (item) => !stale.has(stimulusKey(item)),
      );
      const activeTask =
        currentTask && Date.parse(currentTask.endAt) > this.deps.clock.time()
          ? currentTask
          : undefined;
      if (action === "STEER" && current.length && !busy && delayMs > 0) {
        const notBefore = this.deps.clock.time() + delayMs;
        for (const item of current) {
          item.action = "QUEUE_NEXT";
          item.until = activeTask
            ? { notBefore, taskId: activeTask.id }
            : { notBefore };
        }
        await this.save(agentId, state);
        continue;
      }
      if (action === "STEER" && current.length) {
        const admitted = busy
          ? current
          : this.batch([
              ...current,
              ...available.filter(
                (item) =>
                  this.isCurrent(item, currentTask) &&
                  item.action === "QUEUE_NEXT",
              ),
            ]);
        return this.reserve(
          agentId,
          state,
          admitted,
          busy ? "steer" : "followup",
        );
      }
      const ignored = new Set<string>();
      for (const item of current) {
        if (action === "DEFER") {
          item.action = "QUEUE_NEXT";
          if (activeTask) item.until = { taskId: activeTask.id };
        } else if (action === "QUEUE_NEXT" || item.deadline || item.idle)
          item.action = "QUEUE_NEXT";
        else ignored.add(stimulusKey(item));
      }
      state.pending = state.pending.filter(
        (item) => !ignored.has(stimulusKey(item)),
      );
      state.processedIds = [...(state.processedIds ?? []), ...ignored].slice(
        -1_000,
      );
      if (ignored.size)
        state.ignoredIds = [...(state.ignoredIds ?? []), ...ignored].slice(
          -1_000,
        );
      await this.save(agentId, state);
      // Continue through all unevaluated batches, including after IGNORE.
    }
  }

  private async classify(
    agentId: string,
    state: PerceptionState,
    task: ActiveTask | undefined,
    bundle: PendingItem[],
    busy: boolean,
  ): Promise<AttentionDecision & DecisionTrace> {
    const admit = (note: string) =>
      ({ action: "STEER", delayMs: 0, source: "fallback", note }) as const;
    const assemble = this.deps.assembleDecisionContext;
    const api = this.api;
    const evaluate =
      this.deps.evaluateDecision ??
      (api?.runtime.decisions
        ? (
            batch: DecisionBatch,
            opts: Parameters<DecisionRuntimeV1["evaluate"]>[1],
          ) => api.runtime.decisions.evaluate(batch, opts)
        : undefined);
    if (!assemble || !evaluate) return admit("no decision runtime");
    const timeout = new AbortController();
    const signal = AbortSignal.any([this.lifetime.signal, timeout.signal]);
    const timer = setTimeout(
      () => timeout.abort(new Error("Perception decision deadline exceeded")),
      this.config.decisionTimeoutMs,
    );
    const question = busy ? "attention_allocation" : "wake_decision";
    let onAbort: (() => void) | undefined;
    try {
      const aborted = new Promise<never>((_resolve, reject) => {
        onAbort = () =>
          reject(
            signal.reason instanceof Error
              ? signal.reason
              : new Error("Decision cancelled"),
          );
        signal.addEventListener("abort", onAbort, { once: true });
        if (signal.aborted) onAbort();
      });
      let anchors: number[] = [];
      const work = async (): Promise<DecisionOutcome> => {
        const speech = busy ? this.speech?.current(agentId) : undefined;
        const batch = await assemble(agentId, {
          activeTask: task,
          brainStatus: busy ? "busy_thinking" : "idle",
          brainContext: state.brainContext,
          ...(speech ? { currentSpeech: speech } : {}),
          incomingBundle: bundle,
          pendingQueue: state.pending
            .filter(
              (item) =>
                item.action === "QUEUE_NEXT" ||
                state.deliveries?.some((delivery) =>
                  delivery.keys.includes(stimulusKey(item)),
                ),
            )
            .slice(-16),
          signal,
        });
        signal.throwIfAborted();
        const latency = batch.questions.response_latency;
        if (latency?.type === "score") {
          const parsed = LATENCY_ANCHORS.safeParse(latency.criteria);
          if (parsed.success)
            anchors = parsed.data.map((level) => level.minutes);
        }
        return evaluate(batch, {
          agentId,
          purpose: `perception.${question}`,
          rubricVersion: "5",
          timeoutMs: this.config.decisionTimeoutMs,
          signal,
        });
      };
      const outcome = await Promise.race([work(), aborted]);
      const answer =
        outcome.status === "ok" ? outcome.result.answers[question] : undefined;
      if (answer?.type === "choice") {
        const { choice } = answer;
        const model = { source: "model", choice } as const;
        if (choice === "IGNORE")
          return { action: "IGNORE", delayMs: 0, ...model };
        if (choice === "DEFER")
          return { action: "DEFER", delayMs: 0, ...model };
        if (busy && choice === "QUEUE_NEXT")
          return { action: "QUEUE_NEXT", delayMs: 0, ...model };
        if (busy && choice === "STEER")
          return { action: "STEER", delayMs: 0, ...model };
        const latency =
          outcome.status === "ok"
            ? outcome.result.answers.response_latency
            : undefined;
        if (!busy && choice === "WAKE" && latency?.type === "score")
          return {
            action: "STEER",
            delayMs: latencyMs(latency.score, anchors),
            ...model,
            latencyScore: latency.score,
          };
        return admit(`unusable answer ${choice} to ${question}`);
      }
      if (outcome.status !== "ok") {
        this.warn(
          `Decision unavailable: ${outcome.reason}; admitting attention`,
        );
        return admit(`decision unavailable: ${outcome.reason}`);
      }
      return admit(`no choice answer to ${question}`);
    } catch (error) {
      this.assertCurrent(); // Disposal is cancellation, never a fallback brain turn.
      this.warn(error);
      return admit(String(error));
    } finally {
      clearTimeout(timer);
      if (onAbort) signal.removeEventListener("abort", onAbort);
    }
  }

  private async reserve(
    agentId: string,
    state: PerceptionState,
    bundle: PendingItem[],
    mode: PerceptionDelivery["mode"],
  ): Promise<PerceptionDelivery> {
    const keys = bundle.map(stimulusKey);
    const sessionKeys = [
      ...new Set(
        bundle
          .filter(
            (item) => !item.deadline && item.sessionKey.includes(":chat:"),
          )
          .map((item) => item.sessionKey),
      ),
    ];
    // Steering lands at the next tool boundary. If the character is mid-speech,
    // that boundary is the open send_message: stop it so the steer is noticed
    // before the remaining bubbles are said.
    if (mode === "steer") this.speech?.interrupt(agentId);
    const delivery: PerceptionDelivery = {
      id: createHash("sha256")
        .update(JSON.stringify([agentId, [...keys].sort()]))
        .digest("hex"),
      agentId,
      mode,
      keys,
      ids: bundle.map((item) => item.id),
      sessionKeys,
      message: formatDeliveryMessage(bundle, mode, this.deps.clock.time()),
    };
    state.deliveries = [...(state.deliveries ?? []), delivery];
    await this.save(agentId, state);
    return delivery;
  }

  /** Wait for adoption or deferred custody, not for the whole character turn. */
  private submit(delivery: PerceptionDelivery): Promise<void> {
    return new Promise((resolve, reject) => {
      let adopted = false;
      let deferred = false;
      let failed = false;
      const fail = async (
        error: unknown,
        uncertain: boolean,
      ): Promise<void> => {
        this.warn(error);
        if (adopted || failed) return;
        failed = true;
        try {
          await this.change(
            delivery.agentId,
            (state) => {
              if (!state.deliveries?.some((item) => item.id === delivery.id))
                return;
              state.stopped = true;
              if (!uncertain) {
                state.deliveries = state.deliveries?.filter(
                  (item) => item.id !== delivery.id,
                );
              }
            },
            false,
          );
        } finally {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      };
      const reportFailure = (error: unknown, uncertain = true): void => {
        void fail(error, uncertain).catch((failure: unknown) =>
          this.warn(failure),
        );
      };
      const lifecycle: NonNullable<GetReplyOptions["turnAdoptionLifecycle"]> = {
        admission: "exclusive",
        ownerKey: delivery.id,
        onAdopted: async () => {
          await this.change(
            delivery.agentId,
            (state) => {
              if (!state.deliveries?.some((item) => item.id === delivery.id))
                return;
              state.pending = state.pending.filter(
                (item) => !delivery.keys.includes(stimulusKey(item)),
              );
              state.processedIds = [
                ...(state.processedIds ?? []),
                ...delivery.keys,
              ].slice(-1_000);
              state.deliveries = state.deliveries?.filter(
                (item) => item.id !== delivery.id,
              );
              // Bridges adoption to the native start event; steering preserves the
              // existing run ID. Never label a turn with its source message ID.
              state.brainRun ??= "external";
              state.brainContext = (
                delivery.mode === "steer"
                  ? `${state.brainContext ?? ""}\n${delivery.message}`
                  : delivery.message
              ).slice(-this.config.maxBatchChars);
            },
            false,
          );
          adopted = true;
          resolve();
          for (const listener of this.adoptedListeners) {
            try {
              await listener(delivery);
            } catch (err: unknown) {
              this.warn(err);
            }
          }
          // Inputs can arrive while this reservation waits for adoption. Let
          // Jev assess them now; do not leave urgent arrivals asleep until the
          // newly started brain turn ends. Do not await a second host dispatch
          // from inside the first host's adoption callback.
          void detached(() => this.drain(delivery.agentId)).catch(
            (error: unknown) => this.warn(error),
          );
        },
        onDeferred: () => {
          // The host may retain this callback past dispatch's return. Keep our
          // pending copy until onAdopted; return ingress control immediately.
          deferred = true;
          resolve();
          return true;
        },
        onAbandoned: () =>
          reportFailure(
            new Error(`Brain handoff rejected: ${delivery.id}`),
            false,
          ),
        onSettled: () => {
          if (!adopted && !failed)
            reportFailure(
              new Error(`Brain handoff unconfirmed: ${delivery.id}`),
            );
        },
      };
      // Start outside the state lock, and observe the full dispatch promise even
      // after ingress has returned. Errors after adoption must never replay tools.
      void detached(async () => {
        this.assertCurrent();
        if (!this.deps.deliver)
          throw new Error("Perception requires a brain delivery adapter");
        await this.deps.deliver(delivery, lifecycle);
        if (!adopted && !deferred && !failed) {
          reportFailure(
            new Error(
              `Brain dispatch returned without adoption: ${delivery.id}`,
            ),
          );
        }
      }).catch((error: unknown) => reportFailure(error));
    });
  }

  /**
   * Persist one decision as its own entry, then log and report it. A failed
   * write is logged and never fails attention routing.
   */
  private async recordDecision(
    agentId: string,
    decision: AttentionDecision & DecisionTrace,
    bundle: readonly PendingItem[],
    busy: boolean,
    task: ActiveTask | undefined,
  ): Promise<void> {
    const record: PerceptionDecisionRecord = {
      ...decision,
      simTime: this.deps.clock.time(),
      wallTime: Date.now(),
      question: busy ? "attention_allocation" : "wake_decision",
      stimulusIds: bundle.map((item) => item.id),
      ...(task ? { taskId: task.id } : {}),
    };
    try {
      await this.decisionStore.register(
        `${agentId}${DECISION_KEY}${randomUUID()}`,
        record,
      );
    } catch (error) {
      this.warn(error);
    }
    try {
      this.deps.onDecision?.(agentId, record);
    } catch (error) {
      this.warn(error);
    }
    const detail = [
      decision.choice && `choice=${decision.choice}`,
      decision.latencyScore !== undefined &&
        `latencyScore=${decision.latencyScore}`,
      decision.delayMs > 0 &&
        `delay=${Math.round(decision.delayMs / 1000)}s readyAt=${formatSimTime(record.simTime + decision.delayMs)}`,
      decision.note && `note=${JSON.stringify(decision.note)}`,
    ].filter(Boolean);
    this.api?.logger.info(
      `Perception ${agentId}: ${record.question} -> ${decision.action} (${decision.source}) for ${bundle.length} stimuli${detail.length ? ` ${detail.join(" ")}` : ""}`,
    );
  }

  /** Every recorded attention decision, oldest first. */
  async decisions(): Promise<
    Array<{
      readonly agentId: string;
      readonly record: PerceptionDecisionRecord;
    }>
  > {
    return (await this.decisionStore.entries())
      .filter(({ key }) => isDecisionKey(key))
      .map(({ key, value }) => ({
        agentId: key.slice(0, key.indexOf(DECISION_KEY)),
        record: value,
      }))
      .sort(
        (a, b) =>
          a.record.simTime - b.record.simTime ||
          a.record.wallTime - b.record.wallTime,
      );
  }

  private warn(error: unknown): void {
    this.api?.logger.warn(`Perception: ${String(error)}`);
  }

  dispose(): void {
    this.lifetime.abort();
    this.adoptedListeners.clear();
    this.brainStateListeners.clear();
    for (const cancel of this.debounceTimers.values()) cancel();
    this.debounceTimers.clear();
    for (const timer of this.readinessTimers.values()) clearTimeout(timer);
    this.readinessTimers.clear();
  }
}
