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
export async function fetchModels(
  baseUrl: string,
  token?: string,
  { agentId, refresh = false }: ModelsScope & { refresh?: boolean } = {},
): Promise<ModelsResponse> {
  const data = await request<unknown>(
    buildUrl(baseUrl, "/kazusa/models", {
      agentId,
      refresh: refresh ? 1 : undefined,
    }),
    undefined,
    token,
  );
  return ModelsResponseSchema.parse(data);
}

/** `null` clears the scope's choice: a character inherits the world's again. */
export async function selectModel(
  baseUrl: string,
  ref: string | null,
  token?: string,
  { agentId }: ModelsScope = {},
): Promise<ModelSelectResponse> {
  const data = await postJson<unknown>(
    buildUrl(baseUrl, "/kazusa/model"),
    { ref, ...(agentId ? { agentId } : {}) },
    token,
  );
  return ModelSelectResponseSchema.parse(data);
}

/** `null` clears the scope's choice: world, then the model's own default. */
export async function selectThinking(
  baseUrl: string,
  level: ThinkingLevel | null,
  token?: string,
  { agentId }: ModelsScope = {},
): Promise<ThinkingSelectResponse> {
  const data = await postJson<unknown>(
    buildUrl(baseUrl, "/kazusa/thinking"),
    { level, ...(agentId ? { agentId } : {}) },
    token,
  );
  return ThinkingSelectResponseSchema.parse(data);
}

export async function fetchProviders(
  baseUrl: string,
  token?: string,
): Promise<ProvidersResponse> {
  const data = await request<unknown>(
    buildUrl(baseUrl, "/kazusa/providers"),
    undefined,
    token,
  );
  return ProvidersResponseSchema.parse(data);
}

/** Saves the key in OpenClaw's secret store; the provider uses it at once. */
export async function saveProviderKey(
  baseUrl: string,
  payload: ProviderKeyPayload,
  token?: string,
): Promise<ProviderSummary> {
  const data = await postJson<unknown>(
    buildUrl(baseUrl, "/kazusa/providers/key"),
    payload,
    token,
  );
  return ProviderSummarySchema.parse(data);
}

export async function removeProviderKey(
  baseUrl: string,
  provider: string,
  token?: string,
): Promise<ProviderSummary> {
  const data = await postJson<unknown>(
    buildUrl(baseUrl, "/kazusa/providers/remove"),
    { provider },
    token,
  );
  return ProviderSummarySchema.parse(data);
}

export async function fetchDecisionModels(
  baseUrl: string,
  token?: string,
): Promise<DecisionModelsResponse> {
  const data = await request<unknown>(
    buildUrl(baseUrl, "/kazusa/models/decision"),
    undefined,
    token,
  );
  return DecisionModelsResponseSchema.parse(data);
}

/** `null` turns decisions off. */
export async function selectDecisionModel(
  baseUrl: string,
  ref: string | null,
  token?: string,
): Promise<DecisionModelsResponse> {
  const data = await postJson<unknown>(
    buildUrl(baseUrl, "/kazusa/models/decision/select"),
    { ref },
    token,
  );
  return DecisionModelsResponseSchema.parse(data);
}

export async function fetchEmbeddingModels(
  baseUrl: string,
  token?: string,
): Promise<EmbeddingModelsResponse> {
  const data = await request<unknown>(
    buildUrl(baseUrl, "/kazusa/models/embedding"),
    undefined,
    token,
  );
  return EmbeddingModelsResponseSchema.parse(data);
}

/** `null` goes back to the model `openclaw.json` configures. */
export async function selectEmbeddingModel(
  baseUrl: string,
  ref: string | null,
  token?: string,
): Promise<EmbeddingModelsResponse> {
  const data = await postJson<unknown>(
    buildUrl(baseUrl, "/kazusa/models/embedding/select"),
    { ref },
    token,
  );
  return EmbeddingModelsResponseSchema.parse(data);
}
