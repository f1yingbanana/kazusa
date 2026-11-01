import type {
  DecisionAnswer,
  DecisionProviderV1,
  ProviderDecisionOutcome,
} from "openclaw/plugin-sdk/decisions";
import { fetchWithSsrFGuard } from "openclaw/plugin-sdk/ssrf-runtime";
import { z } from "zod";

export const JEV_PROVIDER_ID = "jev";

/**
 * Hosted Jev, reached with whichever key the world has. OpenRouter serves the
 * same System One API as TypeSafe. OpenClaw's `typesafe` plugin can't be
 * pointed at it: its endpoint is fixed, `baseUrl` only accepts loopback, and
 * its response check rejects OpenRouter's extra fields. A direct key wins
 * because it was set on purpose; most worlds only have the OpenRouter one.
 */
const ROUTES = [
  { env: "TYPESAFE_API_KEY", url: "https://api.typesafe.ai/v1/systemone" },
  { env: "OPENROUTER_API_KEY", url: "https://openrouter.ai/api/v1/systemone" },
] as const;

const DEFAULT_INSTRUCTIONS = "Judge this from the state.";

const Probabilities = z.record(z.string(), z.number());

/** Unknown fields (OpenRouter's `id`, `provider`, `usage.cost`) are dropped. */
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
    })
    .optional(),
});

interface JevResponse {
  readonly status: number;
  readonly retryAfter: string | null;
  readonly body: string;
}

export interface JevDeps {
  readonly env: () => Readonly<Record<string, string | undefined>>;
  readonly post: (request: {
    readonly url: string;
    readonly apiKey: string;
    readonly body: string;
    readonly signal: AbortSignal;
    readonly beforeRequest: () => void;
  }) => Promise<JevResponse>;
}

const defaultDeps: JevDeps = {
  env: () => process.env,
  post: async ({ url, apiKey, body, signal, beforeRequest }) => {
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
  },
};

function routeFor(
  env: Readonly<Record<string, string | undefined>>,
): { readonly url: string; readonly apiKey: string } | undefined {
  for (const { env: name, url } of ROUTES) {
    const apiKey = env[name]?.trim();
    if (apiKey) return { url, apiKey };
  }
  return undefined;
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

export function createJevProvider(
  deps: JevDeps = defaultDeps,
): DecisionProviderV1 {
  return {
    id: JEV_PROVIDER_ID,
    contractVersion: 1,
    isReady: () => routeFor(deps.env()) !== undefined,
    async evaluate(batch, context) {
      const route = routeFor(deps.env());
      if (!route)
        return { status: "unavailable", reason: "credentials-unavailable" };
      const remaining = context.deadlineMonotonicMs - performance.now();
      if (remaining <= 0) return { status: "unavailable", reason: "transport" };
      const questions = Object.fromEntries(
        Object.entries(batch.questions).map(([id, question]) => [
          id,
          // OpenRouter requires non-empty `instructions`; TypeSafe lets them be absent.
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
          ...route,
          body: JSON.stringify({
            model: context.model,
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
