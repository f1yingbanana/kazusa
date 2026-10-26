import { estimateTokens } from "openclaw/plugin-sdk/agent-core";
import type {
  DecisionBatch,
  DecisionEntry,
  DecisionQuestion,
} from "openclaw/plugin-sdk/decisions";
import type { SessionCatalogTranscriptItem } from "openclaw/plugin-sdk/session-catalog";
import { z } from "zod";
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
  readonly incomingBundle: readonly Stimulus[];
  readonly pendingQueue: readonly Stimulus[];
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
              event.text.trim() === item.text?.trim() &&
              event.timestamp === Date.parse(item.timestamp ?? "") &&
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
          remainingMinutes: Math.round(
            (Date.parse(task.endAt) - params.simTime) / 60_000,
          ),
        }
      : null,
    brainStatus: params.brainStatus,
    currentAttention:
      params.brainStatus === "busy_thinking"
        ? truncateText(
            params.brainContext ?? "Current input unavailable",
            Math.min(config.decisionBrainMaxTokens, budget / 8),
          )
        : null,
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
  };
  // Account for JSON wrappers too. Optional background yields to current input
  // and personality. If even those cannot fit, the caller admits attention.
  while (textTokens(JSON.stringify(result)) > budget) {
    if (result.recentChannelContext.length) result.recentChannelContext.pop();
    else if (result.pendingQueue.length) result.pendingQueue.shift();
    else if (result.personalWiki.length) result.personalWiki.pop();
    else if (result.currentAttention) result.currentAttention = null;
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
): Record<string, DecisionQuestion> {
  const busy = brainStatus === "busy_thinking";
  const questionKey = busy ? "attention_allocation" : "wake_decision";
  const target = busy
    ? rubric.questions.attention_allocation
    : rubric.questions.wake_decision;
  const instructions = [rubric.instructions, target.description]
    .filter(Boolean)
    .join("\n\n");
  return {
    [questionKey]: {
      type: "choice",
      instructions,
      criteria: target.criteria,
    },
  };
}

export function assembleDecisionBatch(
  params: Parameters<typeof assembleDecisionContext>[0] & {
    readonly rubric: PerceptionSkillRubric | ParsedSkillDocument | string;
  },
): DecisionBatch {
  const state = assembleDecisionContext(params);
  const rubric =
    typeof params.rubric === "object" && "instructions" in params.rubric
      ? params.rubric
      : parsePerceptionSkill(params.rubric);
  const questions = buildDecisionQuestions(params.brainStatus, rubric);
  return { state, questions };
}
