import {
  ContextSettingsResponseSchema,
  type ContextOverrides,
  type ContextSettingsResponse,
} from "@kazusa/client";
import { buildUrl, postJson, request } from "../http";

export const CONTEXT_SETTINGS_KEY = "kazusa/context/settings";

/** Omit `agentId` for the world's settings, or pass a character's for theirs. */
export async function fetchContextSettings(
  agentId?: string,
): Promise<ContextSettingsResponse> {
  const data = await request<unknown>(
    buildUrl("/kazusa/context/settings", { agentId }),
  );
  return ContextSettingsResponseSchema.parse(data);
}

/** Replaces the scope's choices; a field left out follows its default again. */
export async function saveContextSettings(
  overrides: ContextOverrides,
  agentId?: string,
): Promise<ContextSettingsResponse> {
  const data = await postJson<unknown>(
    buildUrl("/kazusa/context/settings/save"),
    { overrides, ...(agentId ? { agentId } : {}) },
  );
  return ContextSettingsResponseSchema.parse(data);
}
