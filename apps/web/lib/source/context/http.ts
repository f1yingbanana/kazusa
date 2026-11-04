import {
  ContextSettingsResponseSchema,
  type ContextOverrides,
  type ContextSettingsResponse,
} from "@kazusa/client";
import { buildUrl, postJson, request } from "../http";

export const CONTEXT_SETTINGS_KEY = "kazusa/context/settings";

/** Omit `agentId` for the world's settings, or pass a character's for theirs. */
export async function fetchContextSettings(
  baseUrl: string,
  token?: string,
  agentId?: string,
): Promise<ContextSettingsResponse> {
  const data = await request<unknown>(
    buildUrl(baseUrl, "/kazusa/context/settings", { agentId }),
    undefined,
    token,
  );
  return ContextSettingsResponseSchema.parse(data);
}

/** Replaces the scope's choices; a field left out follows its default again. */
export async function saveContextSettings(
  baseUrl: string,
  overrides: ContextOverrides,
  token?: string,
  agentId?: string,
): Promise<ContextSettingsResponse> {
  const data = await postJson<unknown>(
    buildUrl(baseUrl, "/kazusa/context/settings/save"),
    { overrides, ...(agentId ? { agentId } : {}) },
    token,
  );
  return ContextSettingsResponseSchema.parse(data);
}
