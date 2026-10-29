"use client";

import { useCallback, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import type { ModelsResponse, ThinkingLevel } from "@kazusa/client";
import {
  MODELS_KEY,
  fetchModels,
  selectModel,
  selectThinking,
} from "@/lib/source/models/http";
import { useSources } from "@/lib/source/provider";
import { useKazusaConfig } from "@/lib/state/config-store";

/**
 * The Gateway's model catalog, and the model and reasoning level every
 * character runs on. Only live: there is no mock catalog, so `enabled` is false
 * without a Gateway.
 */
export function useModels() {
  const { resolved } = useSources();
  const config = useKazusaConfig();
  const enabled = resolved.models === "live";
  const [refreshing, setRefreshing] = useState(false);

  const resource = useSWR<ModelsResponse, Error>(
    enabled
      ? ([MODELS_KEY, config.baseUrl, config.token ?? ""] as const)
      : null,
    () => fetchModels(config.baseUrl, config.token),
    { revalidateOnFocus: false },
  );
  const { mutate } = resource;

  /**
   * Both picks are a write to Kazusa's own state, not `openclaw.json`, so they
   * show at once and roll back if the Gateway refuses. Returns whether it
   * took.
   */
  const pick = useCallback(
    async (
      patch: Pick<ModelsResponse, "current" | "thinking">,
      save: () => Promise<unknown>,
      failure: string,
    ): Promise<boolean> => {
      try {
        await mutate(
          async (data) => {
            await save();
            return data && { ...data, ...patch };
          },
          {
            optimisticData: (data) => ({
              models: [],
              providers: [],
              ...data,
              ...patch,
            }),
            rollbackOnError: true,
            populateCache: true,
            revalidate: false,
          },
        );
        return true;
      } catch (error) {
        toast.error(failure, {
          description: error instanceof Error ? error.message : String(error),
        });
        return false;
      }
    },
    [mutate],
  );

  const select = useCallback(
    (ref: string) =>
      pick(
        { current: ref },
        () => selectModel(config.baseUrl, ref, config.token),
        "Couldn't switch models",
      ),
    [config.baseUrl, config.token, pick],
  );

  const setThinking = useCallback(
    (level: ThinkingLevel | null) =>
      pick(
        { thinking: level ?? undefined },
        () => selectThinking(config.baseUrl, level, config.token),
        "Couldn't change reasoning",
      ),
    [config.baseUrl, config.token, pick],
  );

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await mutate(fetchModels(config.baseUrl, config.token, true), {
        revalidate: false,
      });
    } catch (error) {
      toast.error("Couldn't refresh models", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setRefreshing(false);
    }
  }, [config.baseUrl, config.token, mutate]);

  return {
    enabled,
    data: resource.data,
    error: resource.error,
    isLoading: resource.isLoading,
    refreshing,
    select,
    setThinking,
    refresh,
  };
}
