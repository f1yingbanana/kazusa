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
import { useSources } from "@/lib/source/provider";
import {
  STATS_KEY,
  fetchStats,
  saveStatCatalog,
  setStat,
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

  /** Throws with the server's reason, so the control can stay as it was. */
  const set = useCallback(
    async (payload: StatSetPayload): Promise<void> => {
      await mutate(await setStat(payload), { revalidate: false });
    },
    [mutate],
  );
  const saveCatalog = useCallback(
    async (catalog: StatCatalog): Promise<void> => {
      await mutate(await saveStatCatalog(catalog), { revalidate: false });
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
