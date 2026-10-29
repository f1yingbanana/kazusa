import { createHash } from "node:crypto";
import type {
  DecisionEntry,
  DecisionRuntimeV1,
} from "openclaw/plugin-sdk/decisions";
import { z } from "zod";
import type { ParsedSkillDocument } from "../context-engine/skill-loader.ts";

/** Ordered likelihood words; the model never sees or gives a number. */
export const LIKELIHOODS = [
  "certain",
  "likely",
  "even",
  "unlikely",
  "no chance",
] as const;

export type Likelihood = (typeof LIKELIHOODS)[number];

/** `shared/skills/location-judgment/SKILL.md` frontmatter. */
const RUBRIC = z.object({
  metadata: z.object({ rubricVersion: z.string() }),
  rubric: z.object({
    instructions: z.string().min(1),
    likelihood: z.record(z.enum(LIKELIHOODS), z.string().min(1)),
    questions: z.record(
      z.string(),
      z.object({ description: z.string().min(1) }),
    ),
  }),
});

export interface Judgment {
  readonly word: Likelihood;
  readonly probability: number;
  /** Seeded uniform draw in [0, 1); it happens when below `probability`. */
  readonly roll: number;
  readonly happens: boolean;
  readonly source: "model" | "fallback";
  readonly note?: string;
}

/** A replayable draw in [0, 1) from the judgment's identity. */
export function seededRoll(parts: readonly (string | number)[]): number {
  const digest = createHash("sha256").update(JSON.stringify(parts)).digest();
  return digest.readUInt32BE(0) / 2 ** 32;
}

export interface JudgeDeps {
  readonly evaluate?: DecisionRuntimeV1["evaluate"];
  readonly rubric: () => Promise<ParsedSkillDocument>;
  readonly probabilities: Readonly<Record<Likelihood, number>>;
  readonly fallback: Likelihood;
  readonly timeoutMs: number;
}

/**
 * Asks the decision model how likely something physical is, from context, and
 * rolls for it. An unavailable model or unusable answer uses the fallback
 * word.
 */
export async function judge(
  deps: JudgeDeps,
  params: {
    readonly agentId: string;
    readonly question: string;
    readonly state: DecisionEntry;
    readonly seed: readonly (string | number)[];
  },
): Promise<Judgment> {
  const decide = (
    word: Likelihood,
    source: Judgment["source"],
    note?: string,
  ): Judgment => {
    const probability = deps.probabilities[word];
    const roll = seededRoll(params.seed);
    return {
      word,
      probability,
      roll,
      happens: roll < probability,
      source,
      ...(note === undefined ? {} : { note }),
    };
  };
  if (!deps.evaluate)
    return decide(deps.fallback, "fallback", "no decision runtime");
  let parsed: z.infer<typeof RUBRIC>;
  try {
    parsed = RUBRIC.parse((await deps.rubric()).frontmatter);
  } catch (error: unknown) {
    return decide(deps.fallback, "fallback", `rubric: ${String(error)}`);
  }
  const { rubric, metadata } = parsed;
  const question = rubric.questions[params.question];
  if (!question) {
    return decide(
      deps.fallback,
      "fallback",
      `no rubric for ${params.question}`,
    );
  }
  const timeout = AbortSignal.timeout(deps.timeoutMs);
  try {
    const outcome = await deps.evaluate(
      {
        state: params.state,
        questions: {
          [params.question]: {
            type: "choice",
            instructions: `${rubric.instructions}\n\n${question.description}`,
            criteria: rubric.likelihood,
          },
        },
      },
      {
        agentId: params.agentId,
        purpose: `location.${params.question}`,
        rubricVersion: metadata.rubricVersion,
        timeoutMs: deps.timeoutMs,
        signal: timeout,
      },
    );
    if (outcome.status !== "ok") {
      return decide(deps.fallback, "fallback", outcome.reason);
    }
    const answer = outcome.result.answers[params.question];
    const word = LIKELIHOODS.find(
      (likelihood) => answer?.type === "choice" && answer.choice === likelihood,
    );
    return word
      ? decide(word, "model")
      : decide(deps.fallback, "fallback", "unusable answer");
  } catch (error: unknown) {
    return decide(deps.fallback, "fallback", String(error));
  }
}
