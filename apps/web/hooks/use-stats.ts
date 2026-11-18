"use client";

import { useCallback } from "react";
import useSWR, { useSWRConfig } from "swr";
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
  afterStatCatalog,
  afterStatSet,
  saveStatCatalog,
  setStat,
  type AfterStatWrite,
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

  const { cache } = useSWRConfig();
  /**
   * Puts a write's response into the snapshot. `before` is the snapshot as the
   * request went out: a response that arrives after the stream has changed the
   * same thing is left out, and everything is read again if the two differ.
   */
  const settle = useCallback(
    async <T>(
      request: () => Promise<T>,
      after: (
        before: StatsResponse | undefined,
        current: StatsResponse | undefined,
        response: T,
      ) => AfterStatWrite,
    ): Promise<void> => {
      const before = cache.get(STATS_KEY)?.data as StatsResponse | undefined;
      const response = await request();
      let reread = false;
      await mutate(
        (current) => {
          const result = after(before, current, response);
          reread = result.reread;
          return result.data;
        },
        { revalidate: false },
      );
      if (reread) void mutate();
    },
    [cache, mutate],
  );

  /**
   * Throws with the server's reason, so the control can stay as it was. Only
   * what the write changed is taken from its response: the stream may have
   * brought newer of everything else by the time it arrives.
   */
  const set = useCallback(
    (payload: StatSetPayload): Promise<void> =>
      settle(
        () => setStat(payload),
        (before, current, response) =>
          afterStatSet(before, current, response, payload),
      ),
    [settle],
  );
  /**
   * `base` is the `revision` of the snapshot the change was made from. When the
   * states have changed since, nothing is saved, they are read again, and this
   * throws saying so.
   */
  const saveCatalog = useCallback(
    async (catalog: StatCatalog, base: string | undefined): Promise<void> => {
      try {
        await settle(() => saveStatCatalog(catalog, base), afterStatCatalog);
      } catch (error) {
        if (!(error instanceof KazusaApiError) || error.status !== 409)
          throw error;
        await mutate();
        throw new Error(
          "The states changed somewhere else. They are up to date now: check them and save again.",
          { cause: error },
        );
      }
    },
    [mutate, settle],
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
