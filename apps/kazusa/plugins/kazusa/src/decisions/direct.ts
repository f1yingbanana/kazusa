import type {
  DecisionBatch,
  DecisionBatchResult,
  DecisionProviderV1,
  DecisionRuntimeV1,
  ProviderFailureReason,
} from "openclaw/plugin-sdk/decisions";

/**
 * Jev, called directly rather than through `api.runtime.decisions`. OpenClaw's
 * decision host admits four calls per provider at once and refuses the rest,
 * which live sent 38% of attention to the fallback in bursts. Kazusa's callers
 * hold one call per character at a time (Perception's lock, under which
 * Location's `notice` also judges), so the onstage cast bounds concurrency.
 *
 * What this keeps from the host: a deadline, answers checked against the
 * questions, and a breaker that stops calling a failing provider for a while.
 * What it gives up: OpenClaw's decision counters (`inspect`) and reload
 * retirement, which each caller's own lifetime signal covers.
 */

/** OpenClaw's own limits, so the behaviour matches the host's. */
const MAX_BUDGET_MS = 30_000;
const FAILURES_TO_OPEN = 3;
const COOLDOWN_MS = 10_000;
const MAX_COOLDOWN_MS = 60_000;

/** Failures that say nothing about the provider's health. */
const NOT_THE_PROVIDER: readonly ProviderFailureReason[] = [
  "credentials-unavailable",
  "unsupported-input",
];

interface Health {
  failures: number;
  openUntil: number;
}

// Every registration in the process calls the same provider.
const HEALTH = Symbol.for("kazusa.decisions.health");
function sharedHealth(): Health {
  const scope = globalThis as { [HEALTH]?: Health };
  return (scope[HEALTH] ??= { failures: 0, openUntil: 0 });
}

export function resetDecisionHealth(): void {
  Object.assign(sharedHealth(), { failures: 0, openUntil: 0 });
}

function trip(health: Health, retryAfterMs?: number): void {
  health.failures += 1;
  if (health.failures < FAILURES_TO_OPEN && retryAfterMs === undefined) return;
  health.failures = 0;
  health.openUntil =
    performance.now() +
    Math.min(Math.max(COOLDOWN_MS, retryAfterMs ?? 0), MAX_COOLDOWN_MS);
}

/** Every question answered, in its own type and terms. */
function answersAll(
  batch: DecisionBatch,
  result: DecisionBatchResult,
): boolean {
  return Object.entries(batch.questions).every(([id, question]) => {
    const answer = result.answers[id];
    if (answer?.type !== question.type) return false;
    if (answer.type === "choice" && question.type === "choice")
      return Object.hasOwn(question.criteria, answer.choice);
    if (answer.type === "score" && question.type === "score")
      return (
        Number.isFinite(answer.score) &&
        answer.score >= 0 &&
        answer.score <= question.criteria.length - 1
      );
    return true;
  });
}

export function directDecisions(
  provider: DecisionProviderV1,
): DecisionRuntimeV1["evaluate"] {
  return async (batch, options) => {
    options.signal.throwIfAborted();
    const health = sharedHealth();
    if (health.openUntil > performance.now())
      return { status: "unavailable", reason: "circuit-open" };
    if (provider.isReady && !provider.isReady())
      return { status: "unavailable", reason: "credentials-unavailable" };
    const budget = Math.min(options.timeoutMs, MAX_BUDGET_MS);
    const deadlineAt = performance.now() + budget;
    const deadline = AbortSignal.timeout(budget);
    const late = () => deadline.aborted || performance.now() >= deadlineAt;
    let outcome: Awaited<ReturnType<DecisionProviderV1["evaluate"]>>;
    try {
      outcome = await provider.evaluate(batch, {
        // Jev reads its route per call; the host's model ref is not used.
        model: "jev",
        ...(options.agentId ? { agentId: options.agentId } : {}),
        signal: AbortSignal.any([options.signal, deadline]),
        deadlineMonotonicMs: deadlineAt,
      });
    } catch (error) {
      options.signal.throwIfAborted();
      if (late()) return { status: "unavailable", reason: "deadline" };
      throw error;
    }
    // A slow answer is not a sick provider: the host does not count it either.
    if (outcome.status === "unavailable" && late())
      return { status: "unavailable", reason: "deadline" };
    if (outcome.status === "unavailable") {
      if (!NOT_THE_PROVIDER.includes(outcome.reason))
        trip(health, outcome.retryAfterMs);
      return { status: "unavailable", reason: outcome.reason };
    }
    if (!answersAll(batch, outcome.result)) {
      trip(health);
      return { status: "unavailable", reason: "invalid-response" };
    }
    health.failures = 0;
    return {
      status: "ok",
      result: outcome.result,
      provenance: {
        providerId: provider.id,
        rubricVersion: options.rubricVersion,
        runtimeGeneration: "direct",
      },
    };
  };
}
