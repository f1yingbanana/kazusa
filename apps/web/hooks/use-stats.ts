"use client";

import { useCallback } from "react";
import useSWR from "swr";
import {
  wornOutfit,
  type StatCatalog,
  type StatSetPayload,
  type StatsResponse,
} from "@kazusa/client";
import { useAccess } from "@/hooks/use-access";
import { KazusaApiError } from "@/lib/source/http";
import { useSources } from "@/lib/source/provider";
import {
  STATS_KEY,
  fetchStats,
  saveStatCatalog,
  setStat,
  withStatCatalog,
  withStatSet,
} from "@/lib/source/stats/http";

/**
 * The world's states and what each stands at. One snapshot, kept current by SSE
 * `stats`; changing anything needs `manage`.
 */
export function useStats() {
  const { resolved } = useSources();
  const { canManage } = useAccess();
  const enabled = resolved.stats === "live";
  const { data, error, mutate } = useSWR<StatsResponse, Error>(
    enabled ? STATS_KEY : null,
    fetchStats,
    { revalidateOnFocus: false },
  );

  /**
   * Throws with the server's reason, so the control can stay as it was. Only
   * what the write changed is taken from its response: the stream may have
   * brought newer of everything else by the time it arrives.
   */
  const set = useCallback(
    async (payload: StatSetPayload): Promise<void> => {
      const response = await setStat(payload);
      await mutate((current) => withStatSet(current, response, payload), {
        revalidate: false,
      });
    },
    [mutate],
  );
  /**
   * `base` is the `revision` of the snapshot the change was made from. When the
   * states have changed since, nothing is saved, they are read again, and this
   * throws saying so.
   */
  const saveCatalog = useCallback(
    async (catalog: StatCatalog, base: string): Promise<void> => {
      let response: StatsResponse;
      try {
        response = await saveStatCatalog(catalog, base);
      } catch (error) {
        if (!(error instanceof KazusaApiError) || error.status !== 409)
          throw error;
        await mutate();
        throw new Error(
          "The states changed somewhere else. They are up to date now: check them and save again.",
          { cause: error },
        );
      }
      await mutate((current) => withStatCatalog(current, response), {
        revalidate: false,
      });
    },
    [mutate],
  );

  return { enabled, canManage, data, error, set, saveCatalog };
}

/** The outfit word a character wears, or nothing in their usual clothes. */
export function useWornOutfit(characterId: string): string | undefined {
  const { data } = useStats();
  return data
    ? wornOutfit(data.outfits[characterId], data.records[characterId])
    : undefined;
}
