import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import type {
  DecisionAnswer,
  DecisionProviderV1,
  ProviderDecisionOutcome,
} from "openclaw/plugin-sdk/decisions";
import { getPreparedPluginSecretInput } from "openclaw/plugin-sdk/secret-input-runtime";
import { fetchWithSsrFGuard } from "openclaw/plugin-sdk/ssrf-runtime";
import { z } from "zod";
import { modelSelection } from "../models/selection.ts";

/**
 * Jev, as the one decision model OpenClaw is configured with: `kazusa/jev`.
 * Which provider runs it is a Kazusa choice (`ModelSelection.decision`), read
 * per call, because changing OpenClaw's `decisionModel` reloads every plugin.
 * Both serve TypeSafe's System One API; OpenRouter's also needs non-empty
 * `instructions` and adds fields the check below ignores.
 */
export const DECISION_PROVIDER_ID = "kazusa";

export interface JevRoute {
  /** Whose key pays: a provider in the Providers catalog. */
  readonly provider: string;
  readonly model: string;
  readonly name: string;
  readonly url: string;
}

export const JEV_ROUTES: readonly JevRoute[] = [
  {
    provider: "openrouter",
    model: "jev-latest",
    name: "Jev",
    url: "https://openrouter.ai/api/v1/systemone",
  },
  {
    provider: "typesafe",
    model: "jev-latest",
    name: "Jev",
    url: "https://api.typesafe.ai/v1/systemone",
  },
];

export const routeRef = (route: JevRoute): string =>
  `${route.provider}/${route.model}`;

/**
 * TypeSafe's key: a secret reference in Kazusa's own config, declared in the
 * manifest's `secretInputs`, since TypeSafe is no model provider.
 */
export const TYPESAFE_KEY_PATH = "decisions.typesafeApiKey";

const DEFAULT_INSTRUCTIONS = "Judge this from the state.";

const Probabilities = z.record(z.string(), z.number());

/** Unknown fields (OpenRouter's `id`, `provider`) are dropped. */
const ResponseSchema = z.object({
  model: z.string(),
  answers: z.record(
    z.string(),
    z.discriminatedUnion("type", [
      z.object({ type: z.literal("noul"), noul: z.number() }),
      z.object({
        type: z.literal("choice"),
        choice: z.string(),
        confidence: z.number().optional(),
        probabilities: Probabilities,
      }),
      z.object({
        type: z.literal("score"),
        score: z.number(),
        confidence: z.number().optional(),
        probabilities: Probabilities,
      }),
    ]),
  ),
  usage: z
    .object({
      input_tokens: z.number().optional(),
      output_tokens: z.number().optional(),
      /** What OpenRouter charged, in US dollars: only its fee when BYOK. */
      cost: z.number().optional(),
      /** BYOK: what the upstream provider charged on its own bill. */
      cost_details: z
        .object({ upstream_inference_cost: z.number().nullish() })
        .nullish(),
    })
    .optional(),
});

/**
 * Best effort, from the response alone: a lookup per call would double the
 * requests. With a key of your own (BYOK) OpenRouter's `cost` is only its fee
 * and the provider bills the rest, which it reports as upstream when it does;
 * systemone has so far said only `cost: 0`.
 */
function billed(
  usage: z.infer<typeof ResponseSchema>["usage"],
): number | undefined {
  const upstream = usage?.cost_details?.upstream_inference_cost;
  if (typeof upstream === "number") return upstream + (usage?.cost ?? 0);
  return usage?.cost;
}

/** One answered call, as billed. */
export interface JevUsage {
  readonly agentId?: string;
  readonly route: JevRoute;
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** US dollars; absent when the provider did not say. */
  readonly cost?: number;
}

interface JevResponse {
  readonly status: number;
  readonly retryAfter: string | null;
  readonly body: string;
}

export interface JevDeps {
  /** The picked route, else the first. */
  readonly route: () => Promise<JevRoute>;
  /** Whether a provider has a key now; synchronous and offline. */
  readonly keyConfigured: (provider: string) => boolean;
  readonly resolveKey: (provider: string) => Promise<string | undefined>;
  readonly post: (request: {
    readonly url: string;
    readonly apiKey: string;
    readonly body: string;
    readonly signal: AbortSignal;
    readonly beforeRequest: () => void;
  }) => Promise<JevResponse>;
  /**
   * Every call that came back answered, whatever is made of it later: OpenClaw
   * keeps decision tokens in memory only, so nothing else counts what Jev
   * costs. Must not throw.
   */
  readonly onUsage?: (usage: JevUsage) => void;
}

const post: JevDeps["post"] = async ({
  url,
  apiKey,
  body,
  signal,
  beforeRequest,
}) => {
  const { response, release } = await fetchWithSsrFGuard({
    url,
    requireHttps: true,
    maxRedirects: 0,
    signal,
    beforeRequest,
    init: {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body,
    },
  });
  try {
    return {
      status: response.status,
      retryAfter: response.headers.get("retry-after"),
      body: await response.text(),
    };
  } finally {
    await release();
  }
};

/** Keys wherever OpenClaw keeps them; the route from Kazusa's selection. */
export function gatewayJevDeps(api: OpenClawPluginApi): JevDeps {
  const selection = modelSelection(api);
  const typesafeKey = (): string | undefined =>
    getPreparedPluginSecretInput(DECISION_PROVIDER_ID, TYPESAFE_KEY_PATH).value;
  return {
    route: async () => {
      const { decision } = await selection.read();
      return (
        JEV_ROUTES.find((route) => routeRef(route) === decision) ??
        JEV_ROUTES[0]
      );
    },
    keyConfigured: (provider) =>
      provider === "typesafe"
        ? Boolean(typesafeKey())
        : api.runtime.modelAuth.isProviderApiKeyConfigured({
            provider,
            cfg: api.runtime.config.current() as Parameters<
              typeof api.runtime.modelAuth.isProviderApiKeyConfigured
            >[0]["cfg"],
          }),
    resolveKey: async (provider) =>
      provider === "typesafe"
        ? typesafeKey()
        : (await api.runtime.modelAuth.resolveApiKeyForProvider({ provider }))
            .apiKey,
    post,
  };
}

async function apiKeyFor(
  deps: JevDeps,
  route: JevRoute,
): Promise<string | undefined> {
  if (!deps.keyConfigured(route.provider)) return undefined;
  return (await deps.resolveKey(route.provider))?.trim() || undefined;
}

/** Bodies can echo the request, so a failure carries only its status. */
function failure(response: JevResponse): ProviderDecisionOutcome {
  // 402 is OpenRouter out of credits: the owner has to act, as with a bad key.
  if ([401, 402, 403].includes(response.status))
    return { status: "unavailable", reason: "authentication" };
  if ([400, 413, 422].includes(response.status))
    return { status: "unavailable", reason: "unsupported-input" };
  if (response.status === 429) {
    const seconds = Number(response.retryAfter ?? NaN);
    return {
      status: "unavailable",
      reason: "rate-limited",
      ...(seconds >= 0 ? { retryAfterMs: seconds * 1000 } : {}),
    };
  }
  return { status: "unavailable", reason: "transport" };
}

function parseAnswers(
  body: string,
): z.infer<typeof ResponseSchema> | undefined {
  try {
    return ResponseSchema.parse(JSON.parse(body));
  } catch {
    return undefined;
  }
}

export function createJevProvider(deps: JevDeps): DecisionProviderV1 {
  return {
    id: DECISION_PROVIDER_ID,
    contractVersion: 1,
    // The pick needs a store read, so ready means any route could run.
    isReady: () =>
      JEV_ROUTES.some((route) => deps.keyConfigured(route.provider)),
    async evaluate(batch, context) {
      const route = await deps.route();
      const apiKey = await apiKeyFor(deps, route);
      if (!apiKey)
        return { status: "unavailable", reason: "credentials-unavailable" };
      const remaining = context.deadlineMonotonicMs - performance.now();
      if (remaining <= 0) return { status: "unavailable", reason: "transport" };
      const questions = Object.fromEntries(
        Object.entries(batch.questions).map(([id, question]) => [
          id,
          // OpenRouter requires non-empty `instructions`.
          {
            ...question,
            instructions: question.instructions ?? DEFAULT_INSTRUCTIONS,
            ...(question.type === "boolean" ? { type: "noul" } : {}),
          },
        ]),
      );
      let response: JevResponse;
      try {
        response = await deps.post({
          url: route.url,
          apiKey,
          body: JSON.stringify({
            model: route.model,
            state: batch.state,
            questions,
          }),
          signal: AbortSignal.any([
            context.signal,
            AbortSignal.timeout(Math.ceil(remaining)),
          ]),
          beforeRequest: () => {
            if (context.isAdmissible && !context.isAdmissible())
              throw new Error("No longer admitted.");
          },
        });
      } catch {
        context.signal.throwIfAborted();
        return { status: "unavailable", reason: "transport" };
      }
      context.signal.throwIfAborted();
      if (response.status < 200 || response.status >= 300)
        return failure(response);
      const parsed = parseAnswers(response.body);
      if (!parsed) return { status: "unavailable", reason: "invalid-response" };
      const cost = billed(parsed.usage);
      deps.onUsage?.({
        ...(context.agentId ? { agentId: context.agentId } : {}),
        route,
        inputTokens: parsed.usage?.input_tokens ?? 0,
        outputTokens: parsed.usage?.output_tokens ?? 0,
        ...(cost === undefined ? {} : { cost }),
      });

      const answers: Record<string, DecisionAnswer> = {};
      for (const [id, answer] of Object.entries(parsed.answers)) {
        const question = batch.questions[id];
        if (answer.type === "noul")
          answers[id] = { type: "boolean", probabilityTrue: answer.noul };
        else if (answer.type === "choice") answers[id] = answer;
        else if (question?.type === "score") {
          const probabilities = question.criteria.map(
            (_level, index) => answer.probabilities[String(index)] ?? NaN,
          );
          answers[id] = { ...answer, probabilities };
        } else return { status: "unavailable", reason: "invalid-response" };
      }
      return {
        status: "ok",
        result: {
          model: parsed.model,
          answers,
          ...(parsed.usage
            ? {
                usage: {
                  inputTokens: parsed.usage.input_tokens,
                  outputTokens: parsed.usage.output_tokens,
                },
              }
            : {}),
        },
      };
    },
  };
}
