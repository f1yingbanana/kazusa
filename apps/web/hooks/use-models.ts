"use client";

import { useCallback, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
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
import { useCharacter } from "./use-characters";

const EMPTY: ModelsResponse = { models: [], providers: [] };

function isAgentModelsKey(key: unknown): boolean {
  return Array.isArray(key) && key[0] === MODELS_KEY && key[3] !== "";
}

function describe(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The Gateway's model catalog and one scope's model and reasoning level.
 * Without `agentId` that scope is the world default every character inherits;
 * with one, it is that character's effective choice (`overrides` says which
 * fields are its own). Only live: there is no mock catalog, so `enabled` is
 * false without a Gateway.
 */
export function useModels(agentId?: string) {
  const { resolved } = useSources();
  const config = useKazusaConfig();
  const { mutate: mutateMatching } = useSWRConfig();
  const enabled = resolved.models === "live";
  const [refreshing, setRefreshing] = useState(false);

  const resource = useSWR<ModelsResponse, Error>(
    enabled
      ? ([
          MODELS_KEY,
          config.baseUrl,
          config.token ?? "",
          agentId ?? "",
        ] as const)
      : null,
    () => fetchModels(config.baseUrl, config.token, { agentId }),
    { revalidateOnFocus: false },
  );
  const { mutate } = resource;

  /**
   * Both choices are a write to Kazusa's own state, not `openclaw.json`, so
   * they show at once and roll back if the Gateway refuses. A world change
   * moves every character that inherits it, so their cached reads refetch.
   * Returns whether it took.
   */
  const write = useCallback(
    async (
      optimistic: (data: ModelsResponse) => ModelsResponse,
      save: () => Promise<Partial<ModelsResponse>>,
      failure: string,
    ): Promise<boolean> => {
      try {
        await mutate(
          async (data) => {
            const saved = await save();
            return data && { ...optimistic(data), ...saved };
          },
          {
            optimisticData: (data) => optimistic(data ?? EMPTY),
            rollbackOnError: true,
            populateCache: true,
            revalidate: false,
          },
        );
        if (agentId === undefined) void mutateMatching(isAgentModelsKey);
        return true;
      } catch (error) {
        toast.error(failure, { description: describe(error) });
        return false;
      }
    },
    [agentId, mutate, mutateMatching],
  );

  /** `null` clears this scope's choice (a character follows the world again). */
  const select = useCallback(
    (ref: string | null) =>
      write(
        (data) => ({
          ...data,
          ...(ref ? { current: ref } : {}),
          ...(agentId
            ? { overrides: { ...data.overrides, model: ref ?? undefined } }
            : {}),
        }),
        async () => {
          const { current } = await selectModel(
            config.baseUrl,
            ref,
            config.token,
            { agentId },
          );
          return { current };
        },
        "Couldn't switch models",
      ),
    [agentId, config.baseUrl, config.token, write],
  );

  const setThinking = useCallback(
    (level: ThinkingLevel | null) =>
      write(
        (data) => ({
          ...data,
          // An agent that stops choosing inherits a level only the server knows.
          ...(level || !agentId ? { thinking: level ?? undefined } : {}),
          ...(agentId
            ? { overrides: { ...data.overrides, thinking: level ?? undefined } }
            : {}),
        }),
        async () => {
          const { thinking } = await selectThinking(
            config.baseUrl,
            level,
            config.token,
            { agentId },
          );
          return { thinking };
        },
        "Couldn't change reasoning",
      ),
    [agentId, config.baseUrl, config.token, write],
  );

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await mutate(
        fetchModels(config.baseUrl, config.token, { agentId, refresh: true }),
        { revalidate: false },
      );
      if (agentId === undefined) void mutateMatching(isAgentModelsKey);
    } catch (error) {
      toast.error("Couldn't refresh models", { description: describe(error) });
    } finally {
      setRefreshing(false);
    }
  }, [agentId, config.baseUrl, config.token, mutate, mutateMatching]);

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

/**
 * Whether a character has a model of its own to choose: a live agent. Players
 * and NPCs never take a model turn, and mock agents are unknown to the
 * Gateway.
 */
export function useRunsOnModel(entity: { readonly id: string }): boolean {
  const { resolved } = useSources();
  const character = useCharacter(entity.id);
  return (
    resolved.models === "live" &&
    resolved.characters === "live" &&
    character?.kind === "agent"
  );
}
