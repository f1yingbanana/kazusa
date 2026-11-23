"use client";

import { useCallback } from "react";
import useSWR, { useSWRConfig } from "swr";
import type {
  ProviderKeyPayload,
  ProviderSummary,
  ProvidersResponse,
} from "@kazusa/client";
import {
  MODELS_KEY,
  PROVIDERS_KEY,
  fetchProviders,
  removeProviderKey,
  saveProviderKey,
} from "@/lib/source/models/http";
import { useAccess } from "@/hooks/use-access";
import { useSources } from "@/lib/source/provider";
import { isRoleModelsKey } from "./use-model-roles";
import { useModels } from "./use-models";

function useProvidersResource() {
  const { resolved } = useSources();
  const { canManage } = useAccess();
  const enabled = canManage && resolved.models === "live";
  const resource = useSWR<ProvidersResponse, Error>(
    enabled ? ([PROVIDERS_KEY] as const) : null,
    () => fetchProviders(),
    { revalidateOnFocus: false },
  );
  return { enabled, resource, canManage };
}

const isModelsKey = (key: unknown): boolean =>
  Array.isArray(key) && key[0] === MODELS_KEY;

/**
 * Every provider the Gateway can use and where its key comes from. Saving or
 * removing a key changes which models exist, so the promise settles once the
 * new models are in. A save the provider fails rejects with the Gateway's
 * reason, and the Gateway has already put the key it had before back.
 */
export function useProviders() {
  const { enabled, resource, canManage } = useProvidersResource();
  const { refresh } = useModels();
  const { mutate: mutateMatching } = useSWRConfig();
  const { mutate } = resource;

  const settle = useCallback(
    async (
      write: Promise<ProviderSummary>,
      // A save has asked every provider again itself; a removal hasn't.
      refreshed: boolean,
    ): Promise<ProviderSummary> => {
      try {
        const summary = await write;
        await mutate(
          (data) =>
            data && {
              providers: data.providers.map((entry) =>
                entry.id === summary.id ? summary : entry,
              ),
            },
          { revalidate: false },
        );
        return summary;
      } finally {
        // A key decides which decision and memory search models can run too.
        await Promise.all([
          refreshed ? mutateMatching(isModelsKey) : refresh(),
          mutateMatching(isRoleModelsKey),
        ]);
      }
    },
    [mutate, mutateMatching, refresh],
  );

  const saveKey = useCallback(
    (payload: ProviderKeyPayload) => {
      if (!canManage) {
        throw new Error("You do not have permission to manage provider keys.");
      }
      return settle(saveProviderKey(payload), true);
    },
    [canManage, settle],
  );

  const removeKey = useCallback(
    (provider: string) => {
      if (!canManage) {
        throw new Error("You do not have permission to manage provider keys.");
      }
      return settle(removeProviderKey(provider), false);
    },
    [canManage, settle],
  );

  return {
    enabled,
    data: resource.data,
    error: resource.error,
    saveKey,
    removeKey,
  };
}

/** A provider's name as the Gateway's catalog gives it, else its id. */
export function useProviderLabel(): (provider: string) => string {
  const { data } = useProvidersResource().resource;
  return useCallback(
    (provider: string) =>
      data?.providers.find((entry) => entry.id === provider)?.label ?? provider,
    [data],
  );
}
