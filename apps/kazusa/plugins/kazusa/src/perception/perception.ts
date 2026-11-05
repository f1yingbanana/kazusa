import { resetContinuations } from "./continue.ts";
import { inBackground } from "../background.ts";
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
import {
  quietConversationOf,
  type DecisionContextAssembler,
} from "../context-engine/decision-context.ts";
import { paceAt } from "../messaging/composing.ts";
import {
  FLOOR_CHOICES,
  type SpeechFacts,
  type SpeechJudgment,
} from "../messaging/floor.ts";
import { stimulusKey } from "../stimulus.ts";
import type { StateStore } from "../state.ts";
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
  type ConversationSource,
  type Stimulus,
} from "./types.ts";
import { BrainSlots } from "./brain-slots.ts";
import {
  bundledSkillText,
  pluginSkillText,
  type SkillText,
} from "../skill-text.ts";

/**
 * `action` marks attention already approved. `QUEUE_NEXT` waits for the next
 * turn; `until` holds it back further: it is ready once `notBefore` passes or
 * its bound task is over, whichever is first. `STEER` is the steer queue: all
 * of it goes into the running turn in one steer, else into the next turn.
 */
export interface PendingItem extends Stimulus {
  action?: "QUEUE_NEXT" | "STEER";
  /** Recheck chat coverage once the ongoing reply has finished. */
  reviewAfterRun?: boolean;
  until?: { taskId?: string; notBefore?: number };
  /** Keys of the later messages of a burst, whose text is in this item. */
  burstKeys?: string[];
  /** When the burst's latest message was sent. */
  burstAt?: number;
}

/** A sender's messages this close together in sim time are one thing to read. */
const BURST_WINDOW_MS = 60_000;

const keysOf = (item: PendingItem): string[] => [
  stimulusKey(item),
  ...(item.burstKeys ?? []),
];

const LATENCY_ANCHORS = z.array(z.looseObject({ minutes: z.number().min(0) }));

/** One live conversation in person, as opposed to a chat on the phone. */
const isHuddle = (item: Stimulus): boolean =>
  item.sessionKey.includes(":chat:huddle:");

/** `shared/skills/perception/SKILL.md` `metadata.rubricVersion`. */
const RUBRIC_VERSION = "11";

const PACE_ANCHORS = z.array(z.looseObject({ pace: z.number().positive() }));

/*
 * A way to take back each steer in custody, by delivery id. A run's end may
 * reach a different registration from the one that sent the steer, so the whole
 * process shares them.
 */
const CUSTODY = Symbol.for("kazusa.perception.steer-custody");
function steerCustody(): Map<string, AbortController> {
  const scope = globalThis as { [CUSTODY]?: Map<string, AbortController> };
  return (scope[CUSTODY] ??= new Map<string, AbortController>());
}

/** At is real time: this reports on the host, not the world. */
export interface BrainFailure {
  readonly error: string;
  readonly at: number;
  readonly runId: string;
}

export interface PerceptionState {
  pending: PendingItem[];
  brainRun?: string;
  /** Why the latest run failed, until a run gets through. */
  failure?: BrainFailure;
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
  /**
   * Conversations in person they stopped following, and when (sim time):
   * whatever was said there until then goes unheard, even arriving later.
   */
  tunedOut?: { conversation: string; at: number }[];
}

/** Said where they had already stopped listening. */
function unheard(
  state: PerceptionState,
  item: { readonly sessionKey: string; readonly timestamp: number },
): boolean {
  const conversation = formatSessionHeader(item.sessionKey);
  return (state.tunedOut ?? []).some(
    (entry) =>
      entry.conversation === conversation && item.timestamp <= entry.at,
  );
}

/** Keys discarded on purpose: never shown to the brain, never redelivered. */
function discard(state: PerceptionState, keys: Iterable<string>): void {
  const all = [...keys];
  state.processedIds = [...(state.processedIds ?? []), ...all].slice(-1_000);
  state.ignoredIds = [...(state.ignoredIds ?? []), ...all].slice(-1_000);
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
  /** Shared by every registration in the process; absent: this one's own. */
  readonly slots?: BrainSlots;
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
  /** Live in-person conversation, validated against current membership. */
  readonly realtime?: (agentId: string, item: Stimulus) => Promise<boolean>;
  readonly confirm?: (
    agentId: string,
    item: Stimulus,
  ) => Promise<Stimulus | undefined>;
  /** Where its wording comes from. Absent: the Gateway's skills, else Kazusa's. */
  readonly text?: SkillText;
}

/**
 * What a delivery says, with no words of its own: chat lines carry their
 * `chat:` address, things seen have none, check-ins are their own skill text,
 * and the closing reminder is `kazusa-deliveries#before-replying`.
 */
function formatDeliveryMessage(
  bundle: PendingItem[],
  simTime: number,
  beforeReplying: string,
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
  if (chatItems.length)
    parts.push(
      chatItems
        .map(
          (item) =>
            `- [${personLabel(item.senderName, item.sender)} ${formatSimTime(item.timestamp)}] (${formatSessionHeader(item.sessionKey)}): ${item.text}`,
        )
        .join("\n"),
    );
  if (sightings.length)
    parts.push(
      sightings
        .map((item) => `- [${formatSimTime(item.timestamp)}] ${item.text}`)
        .join("\n"),
    );

  // Check-ins need no stamp of their own: the delivery stamp is the time they
  // reach the character, and a deadline's text names the planned time.
  for (const item of [...deadlineItems, ...idleItems]) parts.push(item.text);

  if (chatItems.length || sightings.length) parts.push(beforeReplying);

  // OpenClaw stamps each user turn at the LLM boundary with its wall-clock
  // write time in the host timezone, unless the text already opens with a
  // `[... YYYY-MM-DD HH:mm` envelope. Lead with simulation time so the character
  // never sees the operator's clock.
  return `[${formatSimTime(simTime)}]\n${parts.join("\n\n")}`;
}

/**
 * Universal Perception Attention Gate. Evaluates incoming stimuli through
 * TypeSafe AI's Jev Decision Model against the agent's current activity for
 * both idle and busy states.
 */
export class Perception {
  private readonly serial: KeyedAsyncQueue;
  private readonly slots: BrainSlots;
  private readonly api?: OpenClawPluginApi;
  private readonly deps: PerceptionDeps;
  private readonly config: PerceptionConfig;
  private readonly text: SkillText;
  private readonly store: StateStore<PerceptionState>;
  private readonly decisionStore: StateStore<PerceptionDecisionRecord>;
  private readonly taskStore: Pick<TaskStore, "lookup">;
  private readonly lifetime = new AbortController();
  private readonly debounceTimers = new Map<string, () => void>();
  private readonly debounceReadyAt = new Map<string, number>();
  private readonly readinessTimers = new Map<string, NodeJS.Timeout>();
  private speech?: SpeechSource;
  private conversations?: ConversationSource;
  private readonly readListeners = new Set<
    (delivery: PerceptionDelivery) => void | Promise<void>
  >();
  private readonly brainStateListeners = new Set<
    (agentId: string, brain: "idle" | "thinking", queued: number) => void
  >();

  constructor(deps: PerceptionDeps) {
    this.deps = deps;
    this.api = deps.api;
    this.serial = deps.serial ?? new KeyedAsyncQueue();
    this.slots = deps.slots ?? new BrainSlots();
    this.text =
      deps.text ?? (this.api ? pluginSkillText(this.api) : bundledSkillText());

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
    if (stimulus.sender.startsWith("user:")) resetContinuations(agentId);
    if (
      !stimulus.sessionKey.startsWith(`agent:${agentId}:chat:`) &&
      stimulus.sessionKey !== `agent:${agentId}:tasks`
    ) {
      throw new Error(
        "Perception input must belong to the recipient's chat or task ledger.",
      );
    }
    // Offstage, nobody is there to see it happen (`forgetForeseen`).
    if (
      stimulus.foreseen &&
      this.deps.onstage &&
      !(await this.deps.onstage(agentId))
    )
      return;
    let pendingCount = 0;
    let shouldDrain = false;
    await this.change(
      agentId,
      (state) => {
        // Drop duplicates of recently adopted or ignored stimuli
        if (state.processedIds?.includes(stimulusKey(stimulus))) {
          return;
        }
        if (unheard(state, stimulus)) {
          discard(state, [stimulusKey(stimulus)]);
          return;
        }

        const alreadyPending = state.pending.some((item) =>
          keysOf(item).includes(stimulusKey(stimulus)),
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
        const burst = this.burstFor(state, stimulus);
        if (burst) {
          burst.text = `${burst.text}\n${stimulus.text}`;
          burst.burstKeys = [...(burst.burstKeys ?? []), stimulusKey(stimulus)];
          burst.burstAt = stimulus.timestamp;
        } else state.pending.push(stimulus);
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

    // In-person exchanges keep only a short burst window. An arriving huddle
    // can bring an existing remote-message timer forward, never push it back.
    const inPerson = await this.deps.realtime?.(agentId, stimulus);
    const windowMs = inPerson
      ? Math.min(this.config.coalesceWindowMs, 250)
      : this.config.coalesceWindowMs;
    if (windowMs > 0) {
      const existing = this.debounceTimers.get(agentId);
      const readyAt = Date.now() + windowMs;
      if (existing && readyAt >= (this.debounceReadyAt.get(agentId) ?? 0))
        return;
      existing?.();
      // Reserve while ingress still owns admission, including the time spent
      // waiting. A bare timer would inherit a request/tool scope that can close.
      // Keep the fixed first-arrival window: a quiet-period debouncer would
      // change attention timing under continuous traffic.
      const ready = new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => {
          this.debounceTimers.delete(agentId);
          this.debounceReadyAt.delete(agentId);
          resolve(true);
        }, windowMs);
        this.debounceTimers.set(agentId, () => {
          clearTimeout(timer);
          this.debounceReadyAt.delete(agentId);
          resolve(false);
        });
        this.debounceReadyAt.set(agentId, readyAt);
      });
      inBackground(
        this.deps.api,
        async () => {
          if (await ready) await this.drain(agentId);
        },
        (error) => {
          this.warn(error);
        },
      );
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
      text: this.text(
        "kazusa-deliveries#check-in",
        {
          type: task.type,
          time: formatSimTime(Date.parse(task.endAt)),
          note: note ?? "",
        },
        { agentId },
      ),
      deadline: { taskId: task.id, endAt: task.endAt },
      timestamp: Date.parse(task.endAt),
    };
    await this.receive(agentId, stimulus);
  }

  async idleWake(agentId: string): Promise<void> {
    const task = await this.taskStore.lookup(agentId);
    const simNow = this.deps.clock.time();
    if (
      task &&
      Number.isFinite(Date.parse(task.endAt)) &&
      Date.parse(task.endAt) > simNow
    ) {
      return;
    }
    // One check-in waits at a time: asking again only retries the one there,
    // which picks the queue back up after a failed run.
    const waiting = (await this.store.lookup(agentId))?.pending.find(
      (item) => item.idle && !item.resume,
    );
    const stimulus: Stimulus = {
      id: waiting?.id ?? `task-idle:${agentId}:${simNow}`,
      sessionKey: `agent:${agentId}:tasks`,
      sender: "kazusa:taskman",
      text:
        waiting?.text ??
        this.text("kazusa-deliveries#idle-check-in", {}, { agentId }),
      idle: true,
      timestamp: waiting?.timestamp ?? simNow,
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
    failure?: BrainFailure;
  }> {
    const state = await this.store.lookup(agentId);
    return {
      brain: state?.brainRun ? "thinking" : "idle",
      queued: state?.pending?.length ?? 0,
      ...(state?.failure ? { failure: state.failure } : {}),
    };
  }

  /** Records why a run failed, or with nothing, that one got through. */
  async noteRunOutcome(agentId: string, failure?: BrainFailure): Promise<void> {
    let queued = 0;
    let brain: "idle" | "thinking" = "idle";
    let changed = false;
    await this.change(
      agentId,
      (state) => {
        if (!failure && !state.failure) return;
        if (failure) state.failure = failure;
        else delete state.failure;
        queued = state.pending.length;
        brain = state.brainRun ? "thinking" : "idle";
        changed = true;
      },
      false,
    );
    if (changed) this.notifyBrainState(agentId, brain, queued);
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
        // A steer still in custody when its turn ends was refused, and OpenClaw
        // would run it as a turn of its own. Take it back: its items, still in
        // the steer queue, join the next turn with everything else.
        const refused = state.deliveries?.filter(
          (delivery) => delivery.mode === "steer",
        );
        if (refused?.length) {
          for (const delivery of refused)
            steerCustody().get(delivery.id)?.abort();
          state.deliveries = state.deliveries?.filter(
            (delivery) => delivery.mode !== "steer",
          );
          if (!state.deliveries?.length) delete state.deliveries;
        }
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

  /** Let attention take someone out of a conversation they stopped following. */
  attachConversations(source: ConversationSource): void {
    this.conversations = source;
  }

  /**
   * The brain was shown this delivery: adopted into a turn, or found adopted
   * when an interrupted handoff is reconciled at startup.
   */
  onRead(
    listener: (delivery: PerceptionDelivery) => void | Promise<void>,
  ): () => void {
    this.readListeners.add(listener);
    return () => {
      this.readListeners.delete(listener);
    };
  }

  private async notifyRead(delivery: PerceptionDelivery): Promise<void> {
    for (const listener of this.readListeners) {
      try {
        await listener(delivery);
      } catch (err: unknown) {
        this.warn(err);
      }
    }
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
    const read: PerceptionDelivery[] = [];
    await Promise.all(
      entries.map(({ key: agentId }) =>
        this.change(
          agentId,
          async (state) => {
            // Sightings kept from before going offstage never happen
            // (`forgetForeseen`).
            if (this.deps.onstage && !(await this.deps.onstage(agentId)))
              state.pending = state.pending.filter((item) => !item.foreseen);
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
                  read.push(delivery);
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
    for (const delivery of read) await this.notifyRead(delivery);
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

  /**
   * Going offstage: an offstage observer saw nothing, so what they were due to
   * notice never happens for them. Paused or offstage nothing drains, so left
   * here these only pile up until `confirm` refuses them all. Texts still
   * wait.
   */
  async forgetForeseen(agentId: string): Promise<void> {
    await this.change(
      agentId,
      (state) => {
        state.pending = state.pending.filter((item) => !item.foreseen);
      },
      false,
    );
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

  /** A batch with the steer queue taken first, in the order they came. */
  private batchUrgentFirst(items: PendingItem[]): PendingItem[] {
    const chosen = new Set(
      this.batch([
        ...items.filter((item) => item.action === "STEER"),
        ...items.filter((item) => item.action !== "STEER"),
      ]),
    );
    return items.filter((item) => chosen.has(item));
  }

  /**
   * Unread lines of in-person conversation the talk has left behind: older than
   * `staleChatterMs`, but never a conversation's newest line, so none goes
   * silent. A phone message waits however long it takes.
   */
  private mootChatter(
    pending: readonly PendingItem[],
    reserved: ReadonlySet<string>,
  ): PendingItem[] {
    const limit = this.config.staleChatterMs;
    if (!limit) return [];
    const said = (item: PendingItem): number => item.burstAt ?? item.timestamp;
    const newest = new Map<string, PendingItem>();
    for (const item of pending) {
      if (!isHuddle(item)) continue;
      const latest = newest.get(item.sessionKey);
      if (!latest || said(item) >= said(latest))
        newest.set(item.sessionKey, item);
    }
    const now = this.deps.clock.time();
    return pending.filter(
      (item) =>
        isHuddle(item) &&
        newest.get(item.sessionKey) !== item &&
        !reserved.has(stimulusKey(item)) &&
        now - said(item) > limit,
    );
  }

  private isCurrent(item: Stimulus, task?: ActiveTask): boolean {
    if (item.idle) {
      return (
        item.resume || !task || Date.parse(task.endAt) <= this.deps.clock.time()
      );
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
      inBackground(
        this.deps.api,
        () => this.drain(agentId),
        (error) => {
          this.warn(error);
        },
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
      const moot = new Set(
        this.mootChatter(state.pending, reserved).flatMap(keysOf),
      );
      if (moot.size) {
        state.pending = state.pending.filter(
          (item) => !moot.has(stimulusKey(item)),
        );
        // Let go unread, as an ignored line is: never shown to the brain.
        state.processedIds = [...(state.processedIds ?? []), ...moot].slice(
          -1_000,
        );
        state.ignoredIds = [...(state.ignoredIds ?? []), ...moot].slice(-1_000);
        this.api?.logger.info(
          `Perception ${agentId}: let ${moot.size} unread lines of conversation go`,
        );
      }
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
      const review = !busy
        ? this.batch(
            available.filter(
              (item) =>
                item.reviewAfterRun &&
                item.timestamp <= now &&
                this.isReady(item, task),
            ),
          )
        : [];
      const queuedReview = review.length > 0;
      const fresh = queuedReview ? review : happened;
      if (!fresh.length) {
        // The steer queue goes into the running turn whole, one steer at a
        // time: what is approved while one is in custody joins the next.
        const steer =
          state.brainRun &&
          !state.deliveries?.some((delivery) => delivery.mode === "steer")
            ? this.batch(available.filter((item) => item.action === "STEER"))
            : [];
        if (steer.length) return this.reserve(agentId, state, steer, "steer");
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
        const waiting = this.batchUrgentFirst(
          available.filter((item) => item.timestamp <= now),
        );
        if (!systemAgent && !this.takeSlot(agentId, waiting)) {
          await this.save(agentId, state);
          return;
        }
        return this.reserve(agentId, state, waiting, "followup");
      }
      const decision: AttentionDecision & DecisionTrace =
        systemAgent ||
        (!busy && fresh.every((item) => item.deadline || item.idle))
          ? { action: "STEER", delayMs: 0, source: "automatic" }
          : await this.classify(
              agentId,
              state,
              task,
              fresh,
              busy,
              queuedReview,
            );
      this.assertCurrent();
      // Out of a conversation they stopped following before anything else, so
      // what is left is judged on its own. Only a leave that happened counts.
      const { tunedOut, ...judged } = decision;
      const heard = tunedOut
        ? await this.stopFollowing(agentId, state, fresh, tunedOut)
        : fresh;
      const left = tunedOut !== undefined && heard !== fresh;
      // In-person attention has no simulated phone-check delay. Keep Jev's
      // choice: a person may still decline to engage or finish an activity.
      const inPerson = this.deps.realtime;
      const realtime =
        judged.delayMs > 0 && inPerson
          ? (
              await Promise.all(heard.map((item) => inPerson(agentId, item)))
            ).some(Boolean)
          : false;
      const effective: AttentionDecision & DecisionTrace = {
        ...judged,
        ...(realtime ? { delayMs: 0 } : {}),
        ...(left ? { tunedOut } : {}),
      };
      const { action, delayMs } = effective;
      await this.recordDecision(agentId, effective, fresh, busy, task);
      // start_task/delay_task can execute while Jev is evaluating.
      const currentTask = await this.taskStore.lookup(agentId);
      const current = heard.filter((item) => this.isCurrent(item, currentTask));
      for (const item of current) delete item.reviewAfterRun;
      const stale = new Set(
        heard
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
      // Into the steer queue, sent from the top of the loop.
      if (action === "STEER" && current.length && busy) {
        for (const item of current) item.action = "STEER";
        await this.save(agentId, state);
        continue;
      }
      if (action === "STEER" && current.length) {
        const approved = available.filter(
          (item) =>
            this.isCurrent(item, currentTask) &&
            item.action &&
            !item.reviewAfterRun &&
            !current.some((entry) => stimulusKey(entry) === stimulusKey(item)),
        );
        const admitted = this.batch([
          ...current,
          ...approved.filter((item) => item.action === "STEER"),
          ...approved.filter((item) => item.action !== "STEER"),
        ]);
        if (!systemAgent && !this.takeSlot(agentId, admitted)) {
          await this.save(agentId, state);
          return;
        }
        return this.reserve(agentId, state, admitted, "followup");
      }
      const ignored = new Set<string>();
      for (const item of current) {
        if (
          busy &&
          item.sessionKey.includes(":chat:") &&
          (action === "QUEUE_NEXT" || action === "DEFER")
        )
          item.reviewAfterRun = true;
        if (action === "DEFER") {
          item.action = "QUEUE_NEXT";
          if (activeTask) item.until = { taskId: activeTask.id };
        } else if (action === "QUEUE_NEXT" || item.deadline || item.idle)
          item.action = "QUEUE_NEXT";
        else for (const key of keysOf(item)) ignored.add(key);
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

  /**
   * They stopped following a conversation in person: out of it, and everything
   * said there so far goes unheard, as ignored lines do: this batch's, and any
   * still waiting, unless already handed to the brain. Returns what they still
   * heard, or the same batch when they couldn't leave (no longer in it, or a
   * pair: the other is talking to them). Attention routing never fails over
   * it.
   */
  private async stopFollowing(
    agentId: string,
    state: PerceptionState,
    bundle: PendingItem[],
    conversation: string,
  ): Promise<PendingItem[]> {
    let left = false;
    try {
      left =
        (await this.conversations?.tuneOut(agentId, conversation)) ?? false;
    } catch (error) {
      this.warn(error);
    }
    if (!left) return bundle;
    state.tunedOut = [
      ...(state.tunedOut ?? []).filter(
        (entry) => entry.conversation !== conversation,
      ),
      { conversation, at: this.deps.clock.time() },
    ].slice(-8);
    const handedOver = new Set(state.deliveries?.flatMap((item) => item.keys));
    const gone = new Set(
      [...bundle, ...state.pending]
        .filter(
          (item) =>
            unheard(state, item) &&
            !keysOf(item).some((key) => handedOver.has(key)),
        )
        .flatMap(keysOf),
    );
    state.pending = state.pending.filter(
      (item) => !gone.has(stimulusKey(item)),
    );
    discard(state, gone);
    return bundle.filter((item) => !gone.has(stimulusKey(item)));
  }

  private async classify(
    agentId: string,
    state: PerceptionState,
    task: ActiveTask | undefined,
    bundle: PendingItem[],
    busy: boolean,
    queuedReview = false,
  ): Promise<AttentionDecision & DecisionTrace> {
    // With no judgment to go on, a group chat can wait for the activity to end
    // and anything else for the next turn; none is worth breaking into one.
    const fallback = bundle.every((item) =>
      item.sessionKey.includes(":chat:group:"),
    )
      ? "DEFER"
      : "QUEUE_NEXT";
    const admit = (note: string) =>
      ({ action: fallback, delayMs: 0, source: "fallback", note }) as const;
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
      /** The conversation `still_following` asked about, if it was asked. */
      let quietIn: string | undefined;
      const work = async (): Promise<DecisionOutcome> => {
        const speech = busy ? this.speech?.current(agentId) : undefined;
        const batch = await assemble(agentId, {
          activeTask: task,
          brainStatus: busy ? "busy_thinking" : "idle",
          brainContext: state.brainContext,
          queuedReview,
          ...(speech ? { currentSpeech: speech } : {}),
          incomingBundle: bundle,
          pendingQueue: state.pending
            .filter(
              (item) =>
                !bundle.some(
                  (incoming) => stimulusKey(incoming) === stimulusKey(item),
                ) &&
                (item.action ||
                  state.deliveries?.some((delivery) =>
                    delivery.keys.includes(stimulusKey(item)),
                  )),
            )
            .slice(-16),
          signal,
        });
        signal.throwIfAborted();
        quietIn = batch.questions.still_following
          ? quietConversationOf(batch)
          : undefined;
        const latency = batch.questions.response_latency;
        if (latency?.type === "score") {
          const parsed = LATENCY_ANCHORS.safeParse(latency.criteria);
          if (parsed.success)
            anchors = parsed.data.map((level) => level.minutes);
        }
        return evaluate(batch, {
          agentId,
          purpose: `perception.${question}`,
          rubricVersion: RUBRIC_VERSION,
          timeoutMs: this.config.decisionTimeoutMs,
          signal,
        });
      };
      const outcome = await Promise.race([work(), aborted]);
      const following =
        outcome.status === "ok"
          ? outcome.result.answers.still_following
          : undefined;
      const verdict = (): AttentionDecision & DecisionTrace => {
        const answer =
          outcome.status === "ok"
            ? outcome.result.answers[question]
            : undefined;
        if (answer?.type !== "choice") {
          if (outcome.status !== "ok") {
            this.warn(
              `Decision unavailable: ${outcome.reason}; falling back to ${fallback}`,
            );
            return admit(`decision unavailable: ${outcome.reason}`);
          }
          return admit(`no choice answer to ${question}`);
        }
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
        if (!busy && choice === "WAKE" && queuedReview)
          return { action: "STEER", delayMs: 0, ...model };
        if (!busy && choice === "WAKE" && latency?.type === "score")
          return {
            action: "STEER",
            delayMs: latencyMs(latency.score, anchors),
            ...model,
            latencyScore: latency.score,
          };
        return admit(`unusable answer ${choice} to ${question}`);
      };
      const result = verdict();
      // Waking for these very lines means they still follow them; otherwise
      // tuning out holds for that conversation, whatever the main answer.
      const wholly = bundle.every(
        (item) => formatSessionHeader(item.sessionKey) === quietIn,
      );
      return quietIn &&
        following?.type === "choice" &&
        following.choice === "TUNED_OUT" &&
        !(wholly && result.action === "STEER")
        ? { ...result, tunedOut: quietIn }
        : result;
    } catch (error) {
      this.assertCurrent(); // Disposal is cancellation, never a fallback brain turn.
      this.warn(error);
      return admit(String(error));
    } finally {
      clearTimeout(timer);
      if (onAbort) signal.removeEventListener("abort", onAbort);
    }
  }

  /**
   * How a character types or says what they are about to: how fast, and, when
   * someone else has the floor, how badly they want in. Their own impulse, not
   * a stimulus: asked outside the attention lock, and never recorded as
   * attention. Anything unusable is the next pause at an ordinary pace, never a
   * cut-in.
   */
  async judgeSpeech(
    agentId: string,
    facts: SpeechFacts,
  ): Promise<SpeechJudgment> {
    const decide = (
      judgment: SpeechJudgment,
      source: "model" | "fallback",
      note?: string,
    ): SpeechJudgment => {
      this.api?.logger.info(
        `Perception ${agentId}: speech -> ${facts.floor ? `${judgment.floor} ` : ""}pace=${judgment.pace.toFixed(2)} (${source})${note ? ` note=${JSON.stringify(note)}` : ""}`,
      );
      return judgment;
    };
    const ordinary: SpeechJudgment = { floor: "NEXT", pace: 1 };
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
    if (!assemble || !evaluate)
      return decide(ordinary, "fallback", "no decision runtime");
    const signal = AbortSignal.any([
      this.lifetime.signal,
      AbortSignal.timeout(this.config.decisionTimeoutMs),
    ]);
    try {
      const [state, task] = await Promise.all([
        this.store.lookup(agentId),
        this.taskStore.lookup(agentId),
      ]);
      const speech = this.speech?.current(agentId);
      const batch = await assemble(agentId, {
        activeTask: task,
        brainStatus: "busy_thinking",
        brainContext: state?.brainContext,
        ...(speech ? { currentSpeech: speech } : {}),
        incomingBundle: [],
        pendingQueue: [],
        speech: facts,
        signal,
      });
      const anchors = PACE_ANCHORS.safeParse(batch.questions.pace?.criteria);
      const outcome = await evaluate(batch, {
        agentId,
        purpose: "perception.speech",
        rubricVersion: RUBRIC_VERSION,
        timeoutMs: this.config.decisionTimeoutMs,
        signal,
      });
      if (outcome.status !== "ok")
        return decide(ordinary, "fallback", outcome.reason);
      const { floor, pace } = outcome.result.answers;
      const choice =
        floor?.type === "choice"
          ? FLOOR_CHOICES.find((option) => option === floor.choice)
          : undefined;
      const judgment: SpeechJudgment = {
        floor: choice ?? "NEXT",
        pace:
          pace?.type === "score" && anchors.success
            ? paceAt(
                pace.score,
                anchors.data.map((level) => level.pace),
              )
            : 1,
      };
      const usable =
        (!batch.questions.floor || choice !== undefined) &&
        (!batch.questions.pace || pace?.type === "score");
      return usable
        ? decide(judgment, "model")
        : decide(judgment, "fallback", "unusable answer");
    } catch (error) {
      this.assertCurrent();
      return decide(ordinary, "fallback", String(error));
    }
  }

  /** The unread item this message continues, if the sender is mid-burst. */
  private burstFor(
    state: PerceptionState,
    stimulus: Stimulus,
  ): PendingItem | undefined {
    if (!stimulus.sessionKey.includes(":chat:")) return undefined;
    const last = state.pending.findLast(
      (item) => item.sessionKey === stimulus.sessionKey,
    );
    if (
      !last ||
      last.sender !== stimulus.sender ||
      last.reviewAfterRun ||
      state.deliveries?.some((delivery) =>
        delivery.keys.includes(stimulusKey(last)),
      ) ||
      stimulus.timestamp - (last.burstAt ?? last.timestamp) > BURST_WINDOW_MS ||
      last.text.length + stimulus.text.length >= this.config.maxBatchChars
    )
      return undefined;
    return last;
  }

  /**
   * False when every brain slot is taken. What was admitted stays approved and
   * unreserved, so the turn built when their slot opens can include it.
   */
  private takeSlot(agentId: string, admitted: PendingItem[]): boolean {
    const limit = this.config.maxConcurrentBrains;
    const held = this.slots.acquire(agentId, limit, () => {
      inBackground(
        this.deps.api,
        async () => {
          try {
            await this.drain(agentId);
          } finally {
            // Nothing to hand over after all: stale, paused or sent offstage.
            if (!this.slots.isDispatching(agentId))
              this.slots.release(agentId, limit);
          }
        },
        (error) => {
          this.warn(error);
        },
      );
    });
    if (!held) for (const item of admitted) item.action ??= "QUEUE_NEXT";
    return held;
  }

  private async reserve(
    agentId: string,
    state: PerceptionState,
    bundle: PendingItem[],
    mode: PerceptionDelivery["mode"],
  ): Promise<PerceptionDelivery> {
    const keys = bundle.flatMap(keysOf);
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
      message: formatDeliveryMessage(
        bundle,
        this.deps.clock.time(),
        this.text("kazusa-deliveries#before-replying", {}, { agentId }),
      ),
    };
    if (mode === "followup") this.slots.dispatch(agentId);
    else steerCustody().set(delivery.id, new AbortController());
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
      // Only a steer has one; aborted once its turn ended without it (`ended`).
      const custody =
        delivery.mode === "steer" ? steerCustody().get(delivery.id) : undefined;
      const takenBack = (): boolean => custody?.signal.aborted === true;
      const fail = async (
        error: unknown,
        uncertain: boolean,
      ): Promise<void> => {
        if (takenBack()) {
          resolve();
          return;
        }
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
        ...(custody ? { abortSignal: custody.signal } : {}),
        onAdopted: async () => {
          let held = false;
          await this.change(
            delivery.agentId,
            (state) => {
              if (!state.deliveries?.some((item) => item.id === delivery.id))
                return;
              held = true;
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
          // Adopted just as it was taken back: its turn starts aborted, and
          // its items wait for the next one.
          if (!held && takenBack()) return;
          adopted = true;
          resolve();
          await this.notifyRead(delivery);
          // Inputs can arrive while this reservation waits for adoption. Let
          // Jev assess them now; do not leave urgent arrivals asleep until the
          // newly started brain turn ends. Do not await a second host dispatch
          // from inside the first host's adoption callback.
          inBackground(
            this.deps.api,
            () => this.drain(delivery.agentId),
            (error) => {
              this.warn(error);
            },
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
          steerCustody().delete(delivery.id);
          if (!adopted && !failed)
            reportFailure(
              new Error(`Brain handoff unconfirmed: ${delivery.id}`),
            );
        },
      };
      // Start outside the state lock, and observe the full dispatch promise even
      // after ingress has returned. Errors after adoption must never replay tools.
      inBackground(
        this.deps.api,
        async () => {
          try {
            this.assertCurrent();
            if (!this.deps.deliver)
              throw new Error("Perception requires a brain delivery adapter");
            // Its turn ended before it could even be sent.
            if (takenBack()) {
              steerCustody().delete(delivery.id);
              resolve();
              return;
            }
            await this.deps.deliver(delivery, lifecycle);
          } finally {
            if (delivery.mode === "followup")
              this.slots.release(
                delivery.agentId,
                this.config.maxConcurrentBrains,
              );
          }
          if (!adopted && !deferred && !failed) {
            reportFailure(
              new Error(
                `Brain dispatch returned without adoption: ${delivery.id}`,
              ),
            );
          }
        },
        (error) => {
          reportFailure(error);
        },
      );
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
      decision.tunedOut && `tunedOut=${decision.tunedOut}`,
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
    this.readListeners.clear();
    this.brainStateListeners.clear();
    for (const cancel of this.debounceTimers.values()) cancel();
    this.debounceTimers.clear();
    this.debounceReadyAt.clear();
    for (const timer of this.readinessTimers.values()) clearTimeout(timer);
    this.readinessTimers.clear();
  }
}
