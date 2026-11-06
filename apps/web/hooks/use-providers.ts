"use client";

import { useCallback } from "react";
import useSWR, { useSWRConfig } from "swr";
import type {
  ProviderKeyPayload,
  ProviderSummary,
  ProvidersResponse,
} from "@kazusa/client";
import {
  PROVIDERS_KEY,
  fetchProviders,
  removeProviderKey,
  saveProviderKey,
} from "@/lib/source/models/http";
import { useSources } from "@/lib/source/provider";
import { isRoleModelsKey } from "./use-model-roles";
import { useModels } from "./use-models";

function useProvidersResource() {
  const { resolved } = useSources();
  const enabled = resolved.models === "live";
  const resource = useSWR<ProvidersResponse, Error>(
    enabled ? ([PROVIDERS_KEY] as const) : null,
    () => fetchProviders(),
    { revalidateOnFocus: false },
  );
  return { enabled, resource };
}

/**
 * Every provider the Gateway can use and where its key comes from. Saving or
 * removing a key changes which models exist, so each write also asks the
 * providers for their catalogs again; the promise settles once the new models
 * are in, and rejects with the Gateway's reason.
 */
export function useProviders() {
  const { enabled, resource } = useProvidersResource();
  const { refresh } = useModels();
  const { mutate: mutateMatching } = useSWRConfig();
  const { mutate } = resource;

  const settle = useCallback(
    async (write: Promise<ProviderSummary>): Promise<ProviderSummary> => {
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
      // A key decides which decision and memory search models can run too.
      await Promise.all([refresh(), mutateMatching(isRoleModelsKey)]);
      return summary;
    },
    [mutate, mutateMatching, refresh],
  );

  const saveKey = useCallback(
    (payload: ProviderKeyPayload) => settle(saveProviderKey(payload)),
    [settle],
  );

  const removeKey = useCallback(
    (provider: string) => settle(removeProviderKey(provider)),
    [settle],
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
