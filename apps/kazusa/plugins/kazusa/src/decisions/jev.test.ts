import { describe, expect, it, vi } from "vitest";
import type { DecisionBatch } from "openclaw/plugin-sdk/decisions";
import { createJevProvider, type JevDeps } from "./jev.ts";

const batch: DecisionBatch = {
  state: "Airi sent a message.",
  questions: {
    wake: { type: "choice", criteria: { WAKE: "Look", IGNORE: "Don't" } },
    latency: { type: "score", criteria: ["Now", "Later"] },
    urgent: { type: "boolean", instructions: "Is this urgent?" },
  },
};

const answers = {
  wake: {
    type: "choice",
    choice: "WAKE",
    confidence: 0.9,
    probabilities: { WAKE: 0.9, IGNORE: 0.1 },
  },
  latency: {
    type: "score",
    score: 0.25,
    confidence: 0.5,
    legend: { "0": "Now", "1": "Later" },
    probabilities: { "0": 0.75, "1": 0.25 },
  },
  urgent: { type: "noul", noul: 0.2 },
};

function context(overrides = {}) {
  return {
    model: "jev-latest",
    signal: new AbortController().signal,
    deadlineMonotonicMs: performance.now() + 5_000,
    ...overrides,
  };
}

function provider(
  env: Record<string, string>,
  response: { status?: number; retryAfter?: string; body?: unknown } = {},
) {
  const post = vi.fn<JevDeps["post"]>(async () => ({
    status: response.status ?? 200,
    retryAfter: response.retryAfter ?? null,
    body: JSON.stringify(response.body ?? { model: "jev-1.14", answers }),
  }));
  return { post, jev: createJevProvider({ env: () => env, post }) };
}

describe("Jev decision provider", () => {
  it("reaches Jev through OpenRouter with only an OpenRouter key", async () => {
    const { jev, post } = provider({ OPENROUTER_API_KEY: "or-key" });
    expect(jev.isReady?.()).toBe(true);
    await jev.evaluate(batch, context());
    const request = post.mock.calls[0]?.[0];
    expect(request?.url).toBe("https://openrouter.ai/api/v1/systemone");
    expect(request?.apiKey).toBe("or-key");
    expect(JSON.parse(request?.body ?? "").model).toBe("jev-latest");
  });

  it("prefers a direct TypeSafe key", async () => {
    const { jev, post } = provider({
      OPENROUTER_API_KEY: "or-key",
      TYPESAFE_API_KEY: "ts-key",
    });
    await jev.evaluate(batch, context());
    expect(post.mock.calls[0]?.[0].url).toBe(
      "https://api.typesafe.ai/v1/systemone",
    );
    expect(post.mock.calls[0]?.[0].apiKey).toBe("ts-key");
  });

  it("isn't ready and sends nothing without a key", async () => {
    const { jev, post } = provider({ OPENROUTER_API_KEY: "  " });
    expect(jev.isReady?.()).toBe(false);
    expect(await jev.evaluate(batch, context())).toEqual({
      status: "unavailable",
      reason: "credentials-unavailable",
    });
    expect(post).not.toHaveBeenCalled();
  });

  it("translates booleans to Noul and answers back to the host's types", async () => {
    const { jev, post } = provider(
      { OPENROUTER_API_KEY: "or-key" },
      {
        body: {
          id: "gen-1",
          provider: "TypeSafe",
          model: "typesafe/jev-1.14",
          answers,
          usage: { input_tokens: 275, output_tokens: 20, cost: 0.00003 },
        },
      },
    );
    const outcome = await jev.evaluate(batch, context());
    const sent = JSON.parse(post.mock.calls[0]?.[0].body ?? "");
    expect(sent.questions.urgent.type).toBe("noul");
    expect(sent.questions.wake.instructions).toBeTruthy();
    expect(sent.questions.urgent.instructions).toBe("Is this urgent?");
    expect(outcome).toEqual({
      status: "ok",
      result: {
        model: "typesafe/jev-1.14",
        answers: {
          wake: answers.wake,
          latency: {
            type: "score",
            score: 0.25,
            confidence: 0.5,
            probabilities: [0.75, 0.25],
          },
          urgent: { type: "boolean", probabilityTrue: 0.2 },
        },
        usage: { inputTokens: 275, outputTokens: 20 },
      },
    });
  });

  it.each([
    [401, "authentication"],
    [402, "authentication"],
    [422, "unsupported-input"],
    [500, "transport"],
  ])("reports HTTP %i as %s", async (status, reason) => {
    const { jev } = provider(
      { OPENROUTER_API_KEY: "or-key" },
      { status, body: { error: "secret evidence" } },
    );
    expect(await jev.evaluate(batch, context())).toEqual({
      status: "unavailable",
      reason,
    });
  });

  it("passes on how long a rate limit lasts", async () => {
    const { jev } = provider(
      { OPENROUTER_API_KEY: "or-key" },
      { status: 429, retryAfter: "3" },
    );
    expect(await jev.evaluate(batch, context())).toEqual({
      status: "unavailable",
      reason: "rate-limited",
      retryAfterMs: 3000,
    });
  });

  it("calls a response it can't read invalid", async () => {
    const { jev } = provider(
      { OPENROUTER_API_KEY: "or-key" },
      { body: { nope: true } },
    );
    expect(await jev.evaluate(batch, context())).toEqual({
      status: "unavailable",
      reason: "invalid-response",
    });
  });

  it("rejects on caller cancellation instead of reporting a failure", async () => {
    const controller = new AbortController();
    const post: JevDeps["post"] = async () => {
      controller.abort(new Error("Cancelled"));
      throw new Error("aborted");
    };
    const jev = createJevProvider({
      env: () => ({ OPENROUTER_API_KEY: "or-key" }),
      post,
    });
    await expect(
      jev.evaluate(batch, context({ signal: controller.signal })),
    ).rejects.toThrow("Cancelled");
  });
});
