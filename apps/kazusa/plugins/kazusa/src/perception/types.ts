import { z } from "zod";
export { STIMULUS, type Stimulus } from "../stimulus.ts";

export const PERCEPTION_CONFIG = z.object({
  coalesceWindowMs: z.number().int().min(0).max(5000).default(500),
  maxBatchSize: z.number().int().min(1).max(100).default(16),
  maxBatchChars: z.number().int().min(32_000).max(256_000).default(48_000),
  decisionTimeoutMs: z.number().int().min(1).max(30_000).default(10_000),
  /** Longest real wait between readiness checks for delayed attention. */
  readinessPollMs: z.number().int().min(10).max(60_000).default(30_000),
});
export type PerceptionConfig = z.infer<typeof PERCEPTION_CONFIG>;
export type AttentionAction = "STEER" | "QUEUE_NEXT" | "DEFER" | "IGNORE";

/** A categorical decision plus, for an idle wake, its simulated reply delay. */
export interface AttentionDecision {
  readonly action: AttentionAction;
  readonly delayMs: number;
}

/**
 * How an attention decision was reached, retained for debugging. `automatic`
 * skips the model (the system console, or idle task check-ins); `fallback`
 * admits attention because the model was unavailable.
 */
export interface DecisionTrace {
  readonly source: "model" | "automatic" | "fallback";
  /** The model's categorical answer, when it gave one. */
  readonly choice?: string;
  /** The model's response-latency score, mapped to `delayMs`. */
  readonly latencyScore?: number;
  /** Why the fallback was taken. */
  readonly note?: string;
}

/** One retained attention decision for a stimulus batch. */
export interface PerceptionDecisionRecord
  extends AttentionDecision, DecisionTrace {
  /**
   * Simulation time of the decision. Delayed attention is ready at simTime +
   * delayMs.
   */
  readonly simTime: number;
  /** Wall-clock time of the decision, to correlate with Gateway logs. */
  readonly wallTime: number;
  readonly question: "wake_decision" | "attention_allocation";
  readonly stimulusIds: readonly string[];
  readonly taskId?: string;
}

/** What the character is in the middle of saying through send_message. */
export interface CurrentSpeech {
  readonly sessionKey?: string;
  readonly said: readonly string[];
  readonly unsaid: readonly string[];
}

/** Messaging's view of in-progress speech; Perception can cut it off. */
export interface SpeechSource {
  readonly current: (agentId: string) => CurrentSpeech | undefined;
  readonly interrupt: (agentId: string) => boolean;
}

/**
 * Map a `response_latency` score onto its rubric anchors in log(1 + minutes)
 * space, with ±20% jitter so equal scores do not reply in lockstep.
 */
export function latencyMs(
  score: number,
  anchors: readonly number[],
  random: () => number = Math.random,
): number {
  if (!anchors.length || !Number.isFinite(score)) return 0;
  const position = Math.min(Math.max(score, 0), anchors.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const from = Math.log1p(anchors[lower]);
  const to = Math.log1p(anchors[upper]);
  const minutes = Math.expm1(from + (to - from) * (position - lower));
  return Math.round(minutes * 60_000 * (0.8 + 0.4 * random()));
}
