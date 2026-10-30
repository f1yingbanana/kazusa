import {
  ModelSelectResponseSchema,
  ModelsResponseSchema,
  ThinkingSelectResponseSchema,
  type ModelSelectResponse,
  type ModelsResponse,
  type ThinkingLevel,
  type ThinkingSelectResponse,
} from "@kazusa/client";
import { buildUrl, postJson, request } from "../http";

export const MODELS_KEY = "kazusa/models";

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
