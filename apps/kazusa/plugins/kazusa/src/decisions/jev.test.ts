import { describe, expect, it, vi } from "vitest";
import { MODELS_CONFIG } from "../models/config.ts";
import type { DecisionBatch } from "openclaw/plugin-sdk/decisions";
import {
  createJevProvider,
  JEV_ROUTES,
  type JevDeps,
  type JevRoute,
  jevRoute,
} from "./jev.ts";

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

/** The Gateway resolves each provider's key; here they are variables. */
function keys(
  env: Record<string, string>,
  picked: JevRoute = JEV_ROUTES[0],
): Omit<JevDeps, "post"> {
  const keyOf: Record<string, string | undefined> = {
    openrouter: env.OPENROUTER_API_KEY,
    typesafe: env.TYPESAFE_API_KEY,
    openrp: env.OPENRP_API_KEY,
  };
  return {
    route: async () => picked,
    keyConfigured: (provider) => Boolean(keyOf[provider]?.trim()),
    resolveKey: async (provider) => keyOf[provider],
  };
}

function provider(
  env: Record<string, string>,
  response: { status?: number; retryAfter?: string; body?: unknown } = {},
  picked?: JevRoute,
) {
  const post = vi.fn<JevDeps["post"]>(async () => ({
    status: response.status ?? 200,
    retryAfter: response.retryAfter ?? null,
    body: JSON.stringify(response.body ?? { model: "jev-1.14", answers }),
  }));
  return {
    post,
    jev: createJevProvider({ ...keys(env, picked), post }),
  };
}

describe("jevRoute", () => {
  const keys =
    (...providers: string[]) =>
    (provider: string) =>
      providers.includes(provider);
  const config = MODELS_CONFIG.parse({});

  it("follows the pick while its key works", () => {
    expect(
      jevRoute("typesafe/jev-latest", keys("openrouter", "typesafe"), config)
        .provider,
    ).toBe("typesafe");
  });

  it("otherwise takes the first route with a key", () => {
    expect(jevRoute(undefined, keys("typesafe"), config).provider).toBe(
      "typesafe",
    );
    expect(
      jevRoute("openrouter/jev-latest", keys("typesafe"), config).provider,
    ).toBe("typesafe");
  });

  it("takes the listed providers first, and nothing it wasn't asked for", () => {
    const both = keys("openrouter", "typesafe");
    expect(
      jevRoute(undefined, both, { ...config, providers: ["typesafe"] })
        .provider,
    ).toBe("typesafe");
    expect(
      jevRoute(undefined, both, { ...config, decision: ["Other"] }).provider,
    ).toBe("openrouter");
  });

  it("with no key anywhere, keeps the pick or the first route", () => {
    expect(jevRoute("typesafe/jev-latest", keys(), config).provider).toBe(
      "typesafe",
    );
    expect(jevRoute(undefined, keys(), config).provider).toBe("openrouter");
  });
});

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

  it("reaches Jev through TypeSafe when that's the pick", async () => {
    const { jev, post } = provider(
      { OPENROUTER_API_KEY: "or-key", TYPESAFE_API_KEY: "ts-key" },
      {},
      JEV_ROUTES.find((route) => route.provider === "typesafe"),
    );
    await jev.evaluate(batch, context());
    const request = post.mock.calls[0]?.[0];
    expect(request?.url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(request?.apiKey).toBe("ts-key");
  });

  it("reaches Jev through OpenRP, reading its Diamonds reply", async () => {
    const { jev, post } = provider(
      { OPENRP_API_KEY: "rp-key" },
      // As OpenRP answered on 2026-11-04.
      {
        body: {
          model: "jev-1.14.0",
          answers: { urgent: { type: "noul", noul: 0.56 } },
          usage: { input_tokens: 283, output_tokens: 21, diamonds: 0.012 },
        },
      },
      JEV_ROUTES.find((route) => route.provider === "openrp"),
    );
    const outcome = await jev.evaluate(
      { ...batch, questions: { urgent: batch.questions.urgent } },
      context(),
    );
    const request = post.mock.calls[0]?.[0];
    expect(request?.url).toBe("https://openrp.ai/api/v1/systemone");
    expect(request?.apiKey).toBe("rp-key");
    expect(JSON.parse(request?.body ?? "").model).toBe("typesafe/jev-1.14.0");
    expect(outcome).toEqual({
      status: "ok",
      result: {
        model: "jev-1.14.0",
        answers: { urgent: { type: "boolean", probabilityTrue: 0.56 } },
        usage: { inputTokens: 283, outputTokens: 21 },
      },
    });
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

  it("reports what each answered call cost, and whose it was", async () => {
    const onUsage = vi.fn();
    const post: JevDeps["post"] = async () => ({
      status: 200,
      retryAfter: null,
      body: JSON.stringify({
        model: "jev-1.14",
        answers,
        usage: { input_tokens: 275, output_tokens: 20, cost: 0.00003 },
      }),
    });
    const jev = createJevProvider({
      ...keys({ OPENROUTER_API_KEY: "or-key" }),
      post,
      onUsage,
    });
    await jev.evaluate(batch, context({ agentId: "airi" }));
    expect(onUsage).toHaveBeenCalledWith({
      agentId: "airi",
      route: JEV_ROUTES[0],
      inputTokens: 275,
      outputTokens: 20,
      cost: 0.00003,
    });
  });

  it.each([
    [
      "the upstream bill too, when BYOK",
      { cost: 0.25, cost_details: { upstream_inference_cost: 0.5 } },
      0.75,
    ],
    ["OpenRouter's own charge", { cost: 0.25 }, 0.25],
    ["no price when none is given", {}, undefined],
  ])("counts %s", async (_name, priced, cost) => {
    const onUsage = vi.fn();
    const post: JevDeps["post"] = async () => ({
      status: 200,
      retryAfter: null,
      body: JSON.stringify({
        model: "jev-1.14",
        answers,
        usage: { input_tokens: 305, output_tokens: 31, ...priced },
      }),
    });
    await createJevProvider({
      ...keys({ OPENROUTER_API_KEY: "or-key" }),
      post,
      onUsage,
    }).evaluate(batch, context());
    expect(onUsage.mock.calls[0]?.[0].cost).toBe(cost);
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
      ...keys({ OPENROUTER_API_KEY: "or-key" }),
      post,
    });
    await expect(
      jev.evaluate(batch, context({ signal: controller.signal })),
    ).rejects.toThrow("Cancelled");
  });
});
