"use client";

import { useCallback } from "react";
import useSWR, { useSWRConfig } from "swr";
import { toast } from "sonner";
import type { ContextOverrides, ContextSettingsResponse } from "@kazusa/client";
import {
  CONTEXT_SETTINGS_KEY,
  fetchContextSettings,
  saveContextSettings,
} from "@/lib/source/context/http";
import { useSources } from "@/lib/source/provider";
import { useKazusaConfig } from "@/lib/state/config-store";

function describe(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/** A character's cached read, which a world change can move. */
function isAgentContextKey(key: unknown): boolean {
  return Array.isArray(key) && key[0] === CONTEXT_SETTINGS_KEY && key[3] !== "";
}

/**
 * The world's context settings, or one character's (`agentId`). `save` replaces
 * the scope's choices and waits for the Gateway's answer, which may refuse a
 * value out of range.
 */
export function useContextSettings(agentId?: string) {
  const { resolved } = useSources();
  const config = useKazusaConfig();
  const { mutate: mutateMatching } = useSWRConfig();
  const enabled = resolved.context === "live";
  const resource = useSWR<ContextSettingsResponse, Error>(
    enabled
      ? ([
          CONTEXT_SETTINGS_KEY,
          config.baseUrl,
          config.token ?? "",
          agentId ?? "",
        ] as const)
      : null,
    () => fetchContextSettings(config.baseUrl, config.token, agentId),
    { revalidateOnFocus: false },
  );
  const { mutate } = resource;

  const save = useCallback(
    async (overrides: ContextOverrides): Promise<boolean> => {
      try {
        await mutate(
          saveContextSettings(config.baseUrl, overrides, config.token, agentId),
          {
            revalidate: false,
          },
        );
        // Characters who follow the world follow it to the new value.
        if (agentId === undefined) void mutateMatching(isAgentContextKey);
        return true;
      } catch (error) {
        toast.error("Couldn't save that setting", {
          description: describe(error),
        });
        return false;
      }
    },
    [agentId, config.baseUrl, config.token, mutate, mutateMatching],
  );

  return {
    enabled,
    data: resource.data,
    error: resource.error,
    save,
  };
}
