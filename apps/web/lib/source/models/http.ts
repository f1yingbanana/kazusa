import {
  DecisionModelsResponseSchema,
  EmbeddingModelsResponseSchema,
  ModelSelectResponseSchema,
  ModelsResponseSchema,
  ProviderSummarySchema,
  ProvidersResponseSchema,
  type ProviderKeyPayload,
  type ProviderSummary,
  type ProvidersResponse,
  ThinkingSelectResponseSchema,
  type DecisionModelsResponse,
  type EmbeddingModelsResponse,
  type ModelSelectResponse,
  type ModelsResponse,
  type ThinkingLevel,
  type ThinkingSelectResponse,
} from "@kazusa/client";
import { buildUrl, postJson, request } from "../http";

export const MODELS_KEY = "kazusa/models";
export const PROVIDERS_KEY = "kazusa/providers";
export const DECISION_MODELS_KEY = "kazusa/models/decision";
export const EMBEDDING_MODELS_KEY = "kazusa/models/embedding";

/**
 * Every read and write takes a scope: omit `agentId` for the world defaults, or
 * pass a character's id for that character's own choices.
 */
export interface ModelsScope {
  readonly agentId?: string;
}

/** `refresh` asks every provider for its catalog again (slow). */
export async function fetchModels({
  agentId,
  refresh = false,
}: ModelsScope & { refresh?: boolean } = {}): Promise<ModelsResponse> {
  const data = await request<unknown>(
    buildUrl("/kazusa/models", {
      agentId,
      refresh: refresh ? 1 : undefined,
    }),
  );
  return ModelsResponseSchema.parse(data);
}

/** `null` clears the scope's choice: a character inherits the world's again. */
export async function selectModel(
  ref: string | null,
  { agentId }: ModelsScope = {},
): Promise<ModelSelectResponse> {
  const data = await postJson<unknown>(buildUrl("/kazusa/model"), {
    ref,
    ...(agentId ? { agentId } : {}),
  });
  return ModelSelectResponseSchema.parse(data);
}

/** `null` clears the scope's choice: world, then the model's own default. */
export async function selectThinking(
  level: ThinkingLevel | null,
  { agentId }: ModelsScope = {},
): Promise<ThinkingSelectResponse> {
  const data = await postJson<unknown>(buildUrl("/kazusa/thinking"), {
    level,
    ...(agentId ? { agentId } : {}),
  });
  return ThinkingSelectResponseSchema.parse(data);
}

export async function fetchProviders(): Promise<ProvidersResponse> {
  const data = await request<unknown>(buildUrl("/kazusa/providers"));
  return ProvidersResponseSchema.parse(data);
}

/** Saves the key as an OpenClaw auth profile; the provider uses it at once. */
export async function saveProviderKey(
  payload: ProviderKeyPayload,
): Promise<ProviderSummary> {
  const data = await postJson<unknown>(
    buildUrl("/kazusa/providers/key"),
    payload,
  );
  return ProviderSummarySchema.parse(data);
}

export async function removeProviderKey(
  provider: string,
): Promise<ProviderSummary> {
  const data = await postJson<unknown>(buildUrl("/kazusa/providers/remove"), {
    provider,
  });
  return ProviderSummarySchema.parse(data);
}

export async function fetchDecisionModels(): Promise<DecisionModelsResponse> {
  const data = await request<unknown>(buildUrl("/kazusa/models/decision"));
  return DecisionModelsResponseSchema.parse(data);
}

/** `null` turns decisions off. */
export async function selectDecisionModel(
  ref: string | null,
): Promise<DecisionModelsResponse> {
  const data = await postJson<unknown>(
    buildUrl("/kazusa/models/decision/select"),
    { ref },
  );
  return DecisionModelsResponseSchema.parse(data);
}

export async function fetchEmbeddingModels(): Promise<EmbeddingModelsResponse> {
  const data = await request<unknown>(buildUrl("/kazusa/models/embedding"));
  return EmbeddingModelsResponseSchema.parse(data);
}

/** `null` goes back to the model `openclaw.json` configures. */
export async function selectEmbeddingModel(
  ref: string | null,
): Promise<EmbeddingModelsResponse> {
  const data = await postJson<unknown>(
    buildUrl("/kazusa/models/embedding/select"),
    { ref },
  );
  return EmbeddingModelsResponseSchema.parse(data);
}
