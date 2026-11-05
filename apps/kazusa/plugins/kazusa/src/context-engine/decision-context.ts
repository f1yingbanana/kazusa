import { estimateTokens } from "openclaw/plugin-sdk/agent-core";
import type {
  DecisionBatch,
  DecisionEntry,
  DecisionQuestion,
} from "openclaw/plugin-sdk/decisions";
import type { SessionCatalogTranscriptItem } from "openclaw/plugin-sdk/session-catalog";
import { z } from "zod";
import type { SpeechFacts } from "../messaging/floor.ts";
import type { ChatFacts } from "../messaging/messaging.ts";
import type { CurrentSpeech } from "../perception/types.ts";
import type { Stimulus } from "../stimulus.ts";
import type { ActiveTask } from "../taskman/types.ts";
import { CONTEXT_ENGINE_CONFIG, type ContextEngineConfig } from "./config.ts";
import { packLedgerRecords } from "./context-engine.ts";
import { formatSessionHeader, formatSimTime } from "./format.ts";
import {
  parseSkillMarkdown,
  type ParsedSkillDocument,
} from "./skill-loader.ts";

export interface DecisionContextRequest {
  readonly activeTask?: ActiveTask;
  readonly brainStatus: "idle" | "busy_thinking";
  readonly brainContext?: string;
  /** Speech still being delivered by send_message during a busy turn. */
  readonly currentSpeech?: CurrentSpeech;
  /** Previously queued input, reconsidered against the reply just delivered. */
  readonly queuedReview?: boolean;
  readonly incomingBundle: readonly Stimulus[];
  readonly pendingQueue: readonly Stimulus[];
  /**
   * Asks only how they type or say what they are about to: how fast, and, when
   * someone else has the floor, how badly they want in.
   */
  readonly speech?: SpeechFacts;
  readonly signal?: AbortSignal;
}

export type DecisionContextAssembler = (
  agentId: string,
  request: DecisionContextRequest,
) => Promise<DecisionBatch>;

export interface CharacterFiles {
  readonly identity: string | null;
  readonly soul: string | null;
  readonly memory: string | null;
}

export function textTokens(text: string): number {
  return estimateTokens({ role: "user", content: text, timestamp: 0 });
}

/** Count the truncation marker as well; never cut a UTF-16 surrogate in half. */
export function truncateText(text: string, budget: number): string {
  if (textTokens(text) <= budget) return text;
  const suffix = "\n[truncated]";
  if (textTokens(suffix) > budget) return "";
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (textTokens(text.slice(0, mid) + suffix) <= budget) lo = mid;
    else hi = mid - 1;
  }
  if (lo && /[\uD800-\uDBFF]/u.test(text[lo - 1])) lo--;
  return text.slice(0, lo).trimEnd() + suffix;
}

export function assembleDecisionContext(
  params: DecisionContextRequest & {
    readonly agentId: string;
    readonly simTime: number;
    readonly sessionsContext: Readonly<
      Record<string, readonly SessionCatalogTranscriptItem[]>
    >;
    readonly characterFiles?: CharacterFiles;
    readonly wiki?: readonly string[];
    /** Canonical facts for the chats in the incoming bundle. */
    readonly chats?: readonly ChatFacts[];
    /** The conversation asked about by `still_following`, if any. */
    readonly quietIn?: QuietConversation;
    readonly config?: ContextEngineConfig;
  },
): DecisionEntry {
  const config = params.config ?? CONTEXT_ENGINE_CONFIG.parse({});
  // Reserve space for the one question, criteria, and serialization overhead.
  const budget = config.decisionMaxTokens - 512;
  const { activeTask: task, incomingBundle, pendingQueue } = params;
  const profile = params.characterFiles;
  const evidence = [...incomingBundle, ...pendingQueue];
  const history = Object.fromEntries(
    Object.entries(params.sessionsContext).map(([key, items]) => [
      key,
      items.filter(
        (item) =>
          !evidence.some(
            (event) =>
              event.sessionKey === key &&
              // A burst holds several transcript items in one text.
              Boolean(item.text?.trim()) &&
              event.text.includes(item.text!.trim()) &&
              event.timestamp <= Date.parse(item.timestamp ?? "") &&
              event.sender === item.sender?.identity.id,
          ),
      ),
    ]),
  );
  const selected = packLedgerRecords({
    sessionsContext: history,
    simTime: params.simTime,
    cutoff: params.simTime - config.decisionShortTermHours * 3_600_000,
    tokenBudget: Math.min(config.decisionHistoryMaxTokens, budget / 5),
  });
  const minutesAgo = (time: number) =>
    Math.max(0, Math.round((params.simTime - time) / 60_000));
  const formatStimuli = (items: readonly Stimulus[]) =>
    items.map((item) => ({
      kind: item.deadline ? "task_deadline" : "message",
      sender: item.sender,
      channel: formatSessionHeader(item.sessionKey),
      time: formatSimTime(item.timestamp),
      text: truncateText(
        item.text,
        Math.min(
          config.decisionStimulusMaxTokens,
          Math.floor(budget / 4 / Math.max(1, incomingBundle.length)),
        ),
      ),
    }));
  const result = {
    character: {
      id: params.agentId,
      identity: truncateText(
        profile?.identity ?? "",
        Math.min(config.decisionIdentityMaxTokens, budget / 10),
      ),
      soul: truncateText(
        profile?.soul ?? "",
        Math.min(config.decisionSoulMaxTokens, budget / 6),
      ),
      memory: truncateText(
        profile?.memory ?? "",
        Math.min(config.decisionMemoryMaxTokens, budget / 6),
      ),
    },
    simulationTime: formatSimTime(params.simTime),
    currentActivity: task
      ? {
          type: truncateText(task.type, 64),
          description: truncateText(task.description, 256),
          elapsedMinutes: Math.round(
            (params.simTime - Date.parse(task.startedAt)) / 60_000,
          ),
          remainingMinutes: Math.round(
            (Date.parse(task.endAt) - params.simTime) / 60_000,
          ),
        }
      : null,
    brainStatus: params.brainStatus,
    queuedReview: params.queuedReview ?? false,
    currentAttention:
      params.brainStatus === "busy_thinking"
        ? truncateText(
            params.brainContext ?? "Current input unavailable",
            Math.min(config.decisionBrainMaxTokens, budget / 8),
          )
        : null,
    currentSpeech: params.currentSpeech
      ? {
          chat: params.currentSpeech.sessionKey
            ? formatSessionHeader(params.currentSpeech.sessionKey)
            : null,
          said: params.currentSpeech.said.map((text) =>
            truncateText(text, 256),
          ),
          unsaid: params.currentSpeech.unsaid.map((text) =>
            truncateText(text, 256),
          ),
        }
      : null,
    // What a person sees before deciding how soon to answer: a direct chat or
    // a crowd, whether they are already talking, and how long it has waited.
    conversations: (params.chats ?? []).map((chat) => ({
      channel: formatSessionHeader(chat.sessionKey),
      kind: chat.kind,
      title: chat.title ? truncateText(chat.title, 32) : null,
      members: chat.memberCount,
      youLastSpokeMinutesAgo:
        chat.lastSpokeAt === null ? null : minutesAgo(chat.lastSpokeAt),
      unansweredMessages: chat.unanswered,
      waitingMinutes:
        chat.waitingSince === null ? null : minutesAgo(chat.waitingSince),
    })),
    ...(params.quietIn
      ? {
          quietIn: {
            conversation: formatSessionHeader(params.quietIn.sessionKey),
            quietMinutes: params.quietIn.quietMinutes,
          },
        }
      : {}),
    recentChannelContext: [...selected].map(
      ([key, records]) =>
        `### ${formatSessionHeader(key)}${records.reverse().join("")}`,
    ),
    personalWiki: (params.wiki ?? []).map((article) =>
      truncateText(
        article,
        Math.floor(
          Math.min(config.decisionWikiMaxTokens, budget / 8) /
            Math.max(1, params.wiki?.length ?? 0),
        ),
      ),
    ),
    pendingQueue: formatStimuli(pendingQueue.slice(-16)),
    incomingBundle: formatStimuli(incomingBundle),
    speech: params.speech
      ? {
          conversation: formatSessionHeader(params.speech.sessionKey),
          medium: params.speech.medium,
          floor: params.speech.floor
            ? {
                speakingNow: params.speech.floor.speaking,
                whoseTurn: params.speech.floor.turn ?? null,
                othersWaitingToSpeak: params.speech.floor.waiting,
              }
            : null,
        }
      : null,
  };
  // Account for JSON wrappers too. Optional background yields to current input
  // and personality. If even those cannot fit, the caller admits attention.
  while (textTokens(JSON.stringify(result)) > budget) {
    if (result.recentChannelContext.length) result.recentChannelContext.pop();
    else if (result.pendingQueue.length) result.pendingQueue.shift();
    else if (result.personalWiki.length) result.personalWiki.pop();
    else if (result.currentAttention) result.currentAttention = null;
    else if (result.currentSpeech) result.currentSpeech = null;
    else
      throw new Error(
        "Decision evidence cannot fit the configured request budget",
      );
  }
  return result;
}

export const PerceptionRubricSchema = z.object({
  instructions: z.string().min(1),
  questions: z.object({
    wake_decision: z.object({
      description: z.string().optional(),
      criteria: z
        .record(z.string(), z.string())
        .refine(
          (c) => Object.keys(c).length > 0,
          "wake_decision criteria cannot be empty",
        ),
    }),
    attention_allocation: z.object({
      description: z.string().optional(),
      criteria: z
        .record(z.string(), z.string())
        .refine(
          (c) => Object.keys(c).length > 0,
          "attention_allocation criteria cannot be empty",
        ),
    }),
    /** Absent in a world's older override: nobody is asked, nobody drifts. */
    still_following: z
      .object({
        description: z.string().optional(),
        criteria: z.object({
          FOLLOWING: z.string().min(1),
          TUNED_OUT: z.string().min(1),
        }),
      })
      .optional(),
    /** Absent in a world's older override: the floor goes by the next pause. */
    floor: z
      .object({
        description: z.string().optional(),
        criteria: z.object({
          CUT_IN: z.string().min(1),
          NEXT: z.string().min(1),
          WAIT: z.string().min(1),
        }),
      })
      .optional(),
    /**
     * Absent in a world's older override: everyone types and talks at an
     * ordinary pace.
     */
    pace: z
      .object({
        description: z.string().optional(),
        criteria: z
          .array(
            z.strictObject({
              pace: z.number().positive(),
              description: z.string().min(1),
            }),
          )
          .min(2)
          .refine(
            (levels) =>
              levels.every(
                (level, index) =>
                  index === 0 || level.pace >= levels[index - 1].pace,
              ),
            "pace criteria must be ordered by pace",
          ),
      })
      .optional(),
    response_latency: z.object({
      description: z.string().optional(),
      criteria: z
        .array(
          z.strictObject({
            minutes: z.number().min(0),
            description: z.string().min(1),
          }),
        )
        .min(2)
        .refine(
          (levels) =>
            levels.every(
              (level, index) =>
                index === 0 || level.minutes >= levels[index - 1].minutes,
            ),
          "response_latency criteria must be ordered by minutes",
        ),
    }),
  }),
});

export type PerceptionSkillRubric = z.infer<typeof PerceptionRubricSchema>;

/**
 * Validates and extracts the Perception rubric schema directly from SKILL.md
 * YAML frontmatter (shared/skills/perception/SKILL.md or workspace override).
 */
export function parsePerceptionSkill(
  input: string | ParsedSkillDocument,
): PerceptionSkillRubric {
  const frontmatter =
    typeof input === "string"
      ? parseSkillMarkdown(input).frontmatter
      : input.frontmatter;
  const rawRubric = frontmatter?.rubric;
  return PerceptionRubricSchema.parse(rawRubric);
}

export function buildDecisionQuestions(
  brainStatus: "idle" | "busy_thinking",
  rubric: PerceptionSkillRubric,
  queuedReview = false,
  speech?: SpeechFacts,
  quiet = false,
): Record<string, DecisionQuestion> {
  if (speech) {
    const instructions = (description?: string) =>
      [rubric.instructions, description].filter(Boolean).join("\n\n");
    const { floor, pace } = rubric.questions;
    const questions: Record<string, DecisionQuestion> = {
      ...(pace
        ? {
            pace: {
              type: "score",
              instructions: instructions(pace.description),
              criteria: pace.criteria,
            },
          }
        : {}),
      ...(floor && speech.floor
        ? {
            floor: {
              type: "choice",
              instructions: instructions(floor.description),
              criteria: floor.criteria,
            },
          }
        : {}),
    };
    if (!Object.keys(questions).length)
      throw new Error("The perception rubric has no speech questions");
    return questions;
  }
  const busy = brainStatus === "busy_thinking";
  const questionKey = busy ? "attention_allocation" : "wake_decision";
  const target = busy
    ? rubric.questions.attention_allocation
    : rubric.questions.wake_decision;
  const instructions = [rubric.instructions, target.description]
    .filter(Boolean)
    .join("\n\n");
  const questions: Record<string, DecisionQuestion> = {
    [questionKey]: {
      type: "choice",
      instructions,
      criteria: target.criteria,
    },
  };
  // Asked in the same pass; Perception uses it only for an idle WAKE.
  if (!busy && !queuedReview)
    questions.response_latency = {
      type: "score",
      instructions: [
        rubric.instructions,
        rubric.questions.response_latency.description,
      ]
        .filter(Boolean)
        .join("\n\n"),
      criteria: rubric.questions.response_latency.criteria,
    };
  const following = rubric.questions.still_following;
  if (quiet && following)
    questions.still_following = {
      type: "choice",
      instructions: [rubric.instructions, following.description]
        .filter(Boolean)
        .join("\n\n"),
      criteria: following.criteria,
    };
  return questions;
}

/** A conversation in person someone has said nothing in for a while. */
export interface QuietConversation {
  readonly sessionKey: string;
  readonly quietMinutes: number;
}

/** A pair can't drift apart unnoticed: the other is talking to you. */
const DRIFT_MIN_MEMBERS = 3;

/**
 * The conversation in person the incoming lines come from, when it has three or
 * more people and the character has said nothing there for `quietMinutes`:
 * since their last line, or the first line they heard if they have none. They
 * are in at most one.
 */
export function quietConversation(
  chats: readonly ChatFacts[],
  incoming: readonly Stimulus[],
  simTime: number,
  quietMinutes: number,
): QuietConversation | undefined {
  for (const chat of chats) {
    if (chat.kind !== "huddle" || chat.memberCount < DRIFT_MIN_MEMBERS)
      continue;
    if (!incoming.some((item) => item.sessionKey === chat.sessionKey)) continue;
    // From their last line, or their joining if later (coming back resets
    // it); with neither known, the first line they heard.
    const since =
      chat.lastSpokeAt === null && !chat.joinedAt
        ? chat.waitingSince
        : Math.max(chat.lastSpokeAt ?? 0, chat.joinedAt ?? 0);
    if (since === null) continue;
    const quiet = Math.floor((simTime - since) / 60_000);
    if (quiet >= quietMinutes)
      return { sessionKey: chat.sessionKey, quietMinutes: quiet };
  }
  return undefined;
}

/** The conversation `still_following` asks about in a batch, as its address. */
export function quietConversationOf(batch: DecisionBatch): string | undefined {
  const state = batch.state as { quietIn?: { conversation?: unknown } };
  const conversation = state.quietIn?.conversation;
  return typeof conversation === "string" ? conversation : undefined;
}

export function assembleDecisionBatch(
  params: Parameters<typeof assembleDecisionContext>[0] & {
    readonly rubric: PerceptionSkillRubric | ParsedSkillDocument | string;
  },
): DecisionBatch {
  const rubric =
    typeof params.rubric === "object" && "instructions" in params.rubric
      ? params.rubric
      : parsePerceptionSkill(params.rubric);
  const config = params.config ?? CONTEXT_ENGINE_CONFIG.parse({});
  // Asked only while they hear it with nothing on their mind: a busy brain may
  // be answering that very conversation, or waiting for its turn to speak.
  const quietIn =
    rubric.questions.still_following &&
    !params.speech &&
    params.brainStatus === "idle"
      ? quietConversation(
          params.chats ?? [],
          params.incomingBundle,
          params.simTime,
          config.decisionQuietMinutes,
        )
      : undefined;
  const state = assembleDecisionContext({
    ...params,
    ...(quietIn ? { quietIn } : {}),
  });
  const questions = buildDecisionQuestions(
    params.brainStatus,
    rubric,
    params.queuedReview,
    params.speech,
    Boolean(quietIn),
  );
  return { state, questions };
}
