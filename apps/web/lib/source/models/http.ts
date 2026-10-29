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

/** `refresh` asks every provider for its catalog again (slow). */
export async function fetchModels(
  baseUrl: string,
  token?: string,
  refresh = false,
): Promise<ModelsResponse> {
  const data = await request<unknown>(
    buildUrl(baseUrl, "/kazusa/models", { refresh: refresh ? 1 : undefined }),
    undefined,
    token,
  );
  return ModelsResponseSchema.parse(data);
}

export async function selectModel(
  baseUrl: string,
  ref: string,
  token?: string,
): Promise<ModelSelectResponse> {
  const data = await postJson<unknown>(
    buildUrl(baseUrl, "/kazusa/model"),
    { ref },
    token,
  );
  return ModelSelectResponseSchema.parse(data);
}

/** `null` lets each model run at its own default level. */
export async function selectThinking(
  baseUrl: string,
  level: ThinkingLevel | null,
  token?: string,
): Promise<ThinkingSelectResponse> {
  const data = await postJson<unknown>(
    buildUrl(baseUrl, "/kazusa/thinking"),
    { level },
    token,
  );
  return ThinkingSelectResponseSchema.parse(data);
}
