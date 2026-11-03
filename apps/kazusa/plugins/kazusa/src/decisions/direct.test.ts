import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  DecisionBatch,
  DecisionProviderV1,
  ProviderDecisionOutcome,
} from "openclaw/plugin-sdk/decisions";
import { directDecisions, resetDecisionHealth } from "./direct.ts";

const batch: DecisionBatch = {
  state: "Airi sent a message.",
  questions: {
    wake: { type: "choice", criteria: { WAKE: "Look", IGNORE: "Don't" } },
    latency: { type: "score", criteria: ["Now", "Later"] },
  },
};

const answered: ProviderDecisionOutcome = {
  status: "ok",
  result: {
    model: "jev-1.14",
    answers: {
      wake: {
        type: "choice",
        choice: "WAKE",
        probabilities: { WAKE: 0.9, IGNORE: 0.1 },
      },
      latency: { type: "score", score: 0.5, probabilities: [0.5, 0.5] },
    },
  },
};

const options = () => ({
  agentId: "airi",
  purpose: "perception.wake_decision",
  rubricVersion: "7",
  timeoutMs: 1_000,
  signal: new AbortController().signal,
});

function provider(
  evaluate: DecisionProviderV1["evaluate"],
  ready = true,
): DecisionProviderV1 & { evaluate: ReturnType<typeof vi.fn> } {
  return {
    id: "kazusa",
    contractVersion: 1,
    isReady: () => ready,
    evaluate: vi.fn(evaluate),
  };
}

beforeEach(() => resetDecisionHealth());
afterEach(() => vi.useRealTimers());

describe("direct decisions", () => {
  it("runs any number of calls at once, where OpenClaw refused a fifth", async () => {
    const release = Promise.withResolvers<void>();
    const jev = provider(async () => {
      await release.promise;
      return answered;
    });
    const evaluate = directDecisions(jev);
    const calls = Array.from({ length: 12 }, () => evaluate(batch, options()));
    release.resolve();
    const outcomes = await Promise.all(calls);
    expect(outcomes.every(({ status }) => status === "ok")).toBe(true);
    expect(jev.evaluate).toHaveBeenCalledTimes(12);
    expect(jev.evaluate.mock.calls[0]?.[1]).toMatchObject({ agentId: "airi" });
  });

  it("refuses answers that don't fit the questions", async () => {
    const evaluate = directDecisions(
      provider(async () => ({
        status: "ok",
        result: {
          model: "jev",
          answers: {
            wake: { type: "choice", choice: "PANIC", probabilities: {} },
            latency: { type: "score", score: 0, probabilities: [1, 0] },
          },
        },
      })),
    );
    expect(await evaluate(batch, options())).toEqual({
      status: "unavailable",
      reason: "invalid-response",
    });
  });

  it("stops calling a failing provider for a while after three failures", async () => {
    const jev = provider(async () => ({
      status: "unavailable",
      reason: "transport",
    }));
    const evaluate = directDecisions(jev);
    for (let i = 0; i < 3; i++) await evaluate(batch, options());
    expect(await evaluate(batch, options())).toEqual({
      status: "unavailable",
      reason: "circuit-open",
    });
    expect(jev.evaluate).toHaveBeenCalledTimes(3);
  });

  it("waits out a rate limit before calling again", async () => {
    vi.useFakeTimers({ toFake: ["performance"] });
    const jev = provider(async () => ({
      status: "unavailable",
      reason: "rate-limited",
      retryAfterMs: 20_000,
    }));
    const evaluate = directDecisions(jev);
    await evaluate(batch, options());
    vi.advanceTimersByTime(19_000);
    expect((await evaluate(batch, options())).status).toBe("unavailable");
    expect(jev.evaluate).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1_001);
    jev.evaluate.mockResolvedValueOnce(answered);
    expect((await evaluate(batch, options())).status).toBe("ok");
  });

  it("calls a slow answer a missed deadline, not a sick provider", async () => {
    const jev = provider(
      (_batch, context) =>
        new Promise((_resolve, reject) => {
          context.signal.addEventListener("abort", () =>
            reject(new Error("aborted")),
          );
        }),
    );
    const evaluate = directDecisions(jev);
    for (let i = 0; i < 4; i++)
      expect(await evaluate(batch, { ...options(), timeoutMs: 1 })).toEqual({
        status: "unavailable",
        reason: "deadline",
      });
    expect(jev.evaluate).toHaveBeenCalledTimes(4);
  });

  it("sends nothing without a key", async () => {
    const jev = provider(async () => answered, false);
    expect(await directDecisions(jev)(batch, options())).toEqual({
      status: "unavailable",
      reason: "credentials-unavailable",
    });
    expect(jev.evaluate).not.toHaveBeenCalled();
  });

  it("rejects when the caller cancels", async () => {
    const controller = new AbortController();
    const jev = provider(async () => {
      controller.abort(new Error("Cancelled"));
      throw new Error("aborted");
    });
    await expect(
      directDecisions(jev)(batch, { ...options(), signal: controller.signal }),
    ).rejects.toThrow("Cancelled");
  });
});
