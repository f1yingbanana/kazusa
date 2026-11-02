"use client";

import { useCallback } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import type {
  DecisionModelsResponse,
  EmbeddingModelsResponse,
} from "@kazusa/client";
import {
  DECISION_MODELS_KEY,
  EMBEDDING_MODELS_KEY,
  fetchDecisionModels,
  fetchEmbeddingModels,
  selectDecisionModel,
  selectEmbeddingModel,
} from "@/lib/source/models/http";
import { useSources } from "@/lib/source/provider";
import { useKazusaConfig } from "@/lib/state/config-store";

function describe(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/** Matches either role's cached read, so a new key can refresh both. */
export function isRoleModelsKey(key: unknown): boolean {
  return (
    Array.isArray(key) &&
    (key[0] === DECISION_MODELS_KEY || key[0] === EMBEDDING_MODELS_KEY)
  );
}

/**
 * One model role besides chat: its choices and the one in force. A pick waits
 * for the Gateway (it may refuse one without a key), then shows its answer.
 */
function useRole<T extends { readonly current?: string }>(
  key: string,
  fetcher: (baseUrl: string, token?: string) => Promise<T>,
  selecter: (baseUrl: string, ref: string | null, token?: string) => Promise<T>,
  failure: string,
) {
  const { resolved } = useSources();
  const config = useKazusaConfig();
  const enabled = resolved.models === "live";
  const resource = useSWR<T, Error>(
    enabled ? ([key, config.baseUrl, config.token ?? ""] as const) : null,
    () => fetcher(config.baseUrl, config.token),
    { revalidateOnFocus: false },
  );
  const { mutate } = resource;

  const select = useCallback(
    async (ref: string | null): Promise<boolean> => {
      try {
        await mutate(selecter(config.baseUrl, ref, config.token), {
          revalidate: false,
        });
        return true;
      } catch (error) {
        toast.error(failure, { description: describe(error) });
        return false;
      }
    },
    [config.baseUrl, config.token, failure, mutate, selecter],
  );

  return {
    enabled,
    data: resource.data,
    error: resource.error,
    select,
    refresh: () => mutate(),
  };
}

/** The decision model: which judge decides what reaches a character. */
export function useDecisionModels() {
  return useRole<DecisionModelsResponse>(
    DECISION_MODELS_KEY,
    fetchDecisionModels,
    selectDecisionModel,
    "Couldn't change the decision model",
  );
}

/** The memory search model, and how much of the wikis it has covered. */
export function useEmbeddingModels() {
  return useRole<EmbeddingModelsResponse>(
    EMBEDDING_MODELS_KEY,
    fetchEmbeddingModels,
    selectEmbeddingModel,
    "Couldn't change the memory search model",
  );
}
