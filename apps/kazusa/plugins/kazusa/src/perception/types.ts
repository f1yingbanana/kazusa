import { z } from "zod";
export { STIMULUS, type Stimulus } from "../stimulus.ts";

export const PERCEPTION_CONFIG = z.object({
  maxModelCalls: z.number().int().min(1).max(100).default(6),
  maxToolCalls: z.number().int().min(1).max(100).default(12),
  /** Time in model calls; waiting on a tool (typing, the floor) is not. */
  maxThinkingSeconds: z.number().int().min(1).max(3600).default(180),
  /** The system agent's jobs are projects, not one character's reaction. */
  systemAgent: z
    .object({
      maxModelCalls: z.number().int().min(1).max(2000).default(500),
      maxToolCalls: z.number().int().min(1).max(4000).default(1000),
      maxThinkingSeconds: z.number().int().min(1).max(14_400).default(7200),
      /** Fresh runs `continue_work` may ask for before a person must speak. */
      maxContinuations: z.number().int().min(0).max(500).default(40),
    })
    .prefault({}),
  /**
   * Brains starting to think at once, across the cast. Others wait for a slot,
   * and what reaches them meanwhile joins the one turn they then take.
   */
  maxConcurrentBrains: z.number().int().min(1).max(200).default(16),
  coalesceWindowMs: z.number().int().min(0).max(60_000).default(10_000),
  maxBatchSize: z.number().int().min(1).max(100).default(16),
  maxBatchChars: z.number().int().min(32_000).max(256_000).default(48_000),
  decisionTimeoutMs: z.number().int().min(1).max(30_000).default(10_000),
  /**
   * Sim time after which an unread line of an in-person conversation is moot:
   * the talk has moved on, as it would for anyone who wasn't listening. The
   * newest line of each conversation always stays. 0 keeps every line.
   */
  staleChatterMs: z.number().int().min(0).max(86_400_000).default(120_000),
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
 * How an attention decision was reached, logged for debugging. `automatic`
 * skips the model (the system console, or idle task check-ins); `fallback` is
 * taken when the model was unavailable: it defers a group chat and queues
 * everything else for the next turn, never interrupting one.
 */
export interface DecisionTrace {
  readonly source: "model" | "automatic" | "fallback";
  /** The model's categorical answer, when it gave one. */
  readonly choice?: string;
  /** The model's response-latency score, mapped to `delayMs`. */
  readonly latencyScore?: number;
  /** Why the fallback was taken. */
  readonly note?: string;
  /**
   * The conversation in person (its address) they stopped following: its lines
   * in this batch went unheard, and they left it.
   */
  readonly tunedOut?: string;
}

/** A text, or something the player said in person, that a character let pass. */
export interface PassedLine {
  readonly messageId: string;
  /** The chat it was said in. */
  readonly chatId: string;
  readonly sender: string;
  /** The start of it, as the character would have read it. */
  readonly excerpt: string;
}

/**
 * An attention decision the player would want to see: a text left unread or set
 * aside, the player unheard in person, a conversation stopped following. Kept
 * for the timeline. Every other decision (nine in ten are lines overheard in
 * person, and most of the rest are acted on at once) is only logged.
 */
export interface PerceptionDecisionRecord {
  /** Simulation time of the decision. */
  readonly simTime: number;
  /** Wall-clock time of the decision, to correlate with Gateway logs. */
  readonly wallTime: number;
  /**
   * What became of `lines`: `ignored`, left unread (or unheard, in person);
   * `deferred`, set aside until the current activity ends.
   */
  readonly outcome?: "ignored" | "deferred";
  /** Oldest first; empty when the decision only `tunedOut`. */
  readonly lines: readonly PassedLine[];
  /** The conversation in person (its chat) they stopped following. */
  readonly tunedOut?: string;
  /** What they were doing. */
  readonly activity?: {
    readonly type: string;
    readonly description: string;
    /** Sim ms. */
    readonly endAt: number;
  };
}

/** What the character is in the middle of saying through send_message. */
export interface CurrentSpeech {
  readonly sessionKey?: string;
  readonly said: readonly string[];
  readonly unsaid: readonly string[];
}

/** What stops a speech and comes back with its result. */
export interface SpeechHandoff {
  /** What reached them, as a delivery reads. */
  readonly message: string;
  /** Face to face, finish the line being said first. */
  readonly atPause?: boolean;
}

/**
 * Messaging's view of in-progress speech; Perception can cut it off. With a
 * handoff, `interrupt` returns whether a send was under way to carry it back.
 */
export interface SpeechSource {
  readonly current: (agentId: string) => CurrentSpeech | undefined;
  readonly interrupt: (agentId: string, handoff?: SpeechHandoff) => boolean;
}

/** Conversations attention can take someone out of. */
export interface ConversationSource {
  /**
   * Stop following a conversation in person: out of it, without a word. Whether
   * they left (not when no longer in it, or one of a pair).
   */
  readonly tuneOut: (agentId: string, conversation: string) => Promise<boolean>;
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
