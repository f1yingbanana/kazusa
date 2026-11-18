import { lookup } from "node:dns/promises";
import {
  buildOpenAICompatibleLiveModels,
  getCachedLiveProviderModelRows,
  type LiveModel,
  type LiveProvider,
} from "openclaw/plugin-sdk/provider-catalog-live-runtime";
import { ssrfPolicyFromHttpBaseUrlAllowedHostname } from "openclaw/plugin-sdk/ssrf-runtime";

export const NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";

/**
 * NVIDIA's own list of the models it features, with their context and output
 * limits. `/models` gives ids alone, so this is where those limits come from;
 * it never decides which models exist.
 */
export const FEATURED_URL =
  "https://assets.ngc.nvidia.com/products/api-catalog/featured-models.json";

const DAY_MS = 86_400_000;

/** NVIDIA's API takes message content as a plain string, never parts. */
const COMPAT = { requiresStringContent: true };

const FREE = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

/**
 * Models `/models` lists that can't hold a conversation: embeddings, rerankers,
 * retrievers, image-text matching and detectors. OpenClaw's own check already
 * drops most of them; these are the ones it lets through. Everything else
 * stays, safety classifiers and translators included: they chat.
 */
const CANT_CHAT = /embed|rerank|retriev|clip|detector/i;

/**
 * Nemotron 3 Ultra thinks unless told not to and can answer with empty content,
 * which OpenClaw counts as no reply. OpenClaw's own NVIDIA plugin sends these
 * for it; so does this one. A model setting overrides them.
 */
const ULTRA_ID = "nvidia/nemotron-3-ultra-550b-a55b";
const ULTRA_TEMPLATE = { enable_thinking: false, force_nonempty_content: true };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const list = (value: unknown): readonly unknown[] =>
  Array.isArray(value) ? value : [];

const positive = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : undefined;

/** One featured row as a model, or nothing when it lacks what a model needs. */
export function featuredModel(row: unknown): LiveModel | undefined {
  if (!isRecord(row)) return undefined;
  const id = typeof row.model === "string" ? row.model.trim() : "";
  const name =
    typeof row["model-name"] === "string" ? row["model-name"].trim() : "";
  const contextWindow = positive(row.context);
  const maxTokens = positive(row["max-output"]);
  if (!id || !name || !contextWindow || !maxTokens || /\s/.test(id))
    return undefined;
  return {
    id: id.includes("/") ? id : `nvidia/${id}`,
    name,
    input: ["text"],
    contextWindow,
    maxTokens,
    cost: FREE,
    compat: COMPAT,
  };
}

/** The featured models; none when the list can't be read. */
async function featuredModels(): Promise<LiveModel[]> {
  try {
    const rows = await getCachedLiveProviderModelRows({
      providerId: "nvidia",
      endpoint: FEATURED_URL,
      timeoutMs: 10_000,
      ttlMs: DAY_MS,
      requireHttps: true,
      policy: ssrfPolicyFromHttpBaseUrlAllowedHostname(FEATURED_URL),
      // As OpenClaw's NVIDIA plugin asks it: over IPv4.
      lookupFn: (hostname: string, options?: object) =>
        lookup(hostname, { ...options, family: 4 }),
      auditContext: "nvidia-featured-models",
      readRows: (payload) =>
        isRecord(payload) ? list(payload["featured-models"]) : [],
    });
    return rows.flatMap((row) => featuredModel(row) ?? []);
  } catch {
    return [];
  }
}

function withDefaults(model: LiveModel): LiveModel {
  const compat = { ...COMPAT, ...model.compat };
  if (model.id !== ULTRA_ID) return { ...model, compat };
  const own = isRecord(model.params?.chat_template_kwargs)
    ? model.params.chat_template_kwargs
    : {};
  return {
    ...model,
    compat,
    params: {
      ...model.params,
      chat_template_kwargs: { ...ULTRA_TEMPLATE, ...own },
    },
  };
}

const provider = (models: readonly LiveModel[]): LiveProvider => ({
  baseUrl: NVIDIA_BASE_URL,
  api: "openai-completions",
  models,
});

/**
 * What the live listing is read against: the featured models, for their limits.
 * A model they don't cover gets OpenClaw's defaults.
 */
export const buildProvider = async (): Promise<LiveProvider> =>
  provider(await featuredModels());

/** Without a listing there is nothing to offer: NVIDIA's list changes often. */
export const buildStaticProvider = (): LiveProvider => provider([]);

/**
 * Every chat model in NVIDIA's `/models`, whether OpenClaw knows it or not. A
 * featured model's limits apply to that model alone: OpenClaw's reader, given
 * them, lends a model it doesn't know the limits of the one whose id shares the
 * longest prefix, so every `nvidia/…` model took Nemotron Ultra's million
 * tokens, small ones included. Without them it uses its defaults (128k).
 */
export function projectModels(
  rows: readonly unknown[],
  fallback: LiveProvider,
): LiveModel[] {
  const chat = rows.filter(
    (row) =>
      !(isRecord(row) && typeof row.id === "string" && CANT_CHAT.test(row.id)),
  );
  const known = new Map(fallback.models.map((model) => [model.id, model]));
  return buildOpenAICompatibleLiveModels(chat, { ...fallback, models: [] })
    .map((model) => {
      const featured = known.get(model.id);
      return featured
        ? {
            ...model,
            name: featured.name,
            contextWindow: featured.contextWindow,
            maxTokens: featured.maxTokens,
          }
        : model;
    })
    .map(withDefaults);
}
