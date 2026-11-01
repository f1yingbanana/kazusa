"use client";

import { useState } from "react";
import useSWR from "swr";
import type { BrainTraceResponse, UsageResponse } from "@kazusa/client";
import { fetchBrainTrace, fetchUsage } from "@/lib/source/brain/http";
import { useSources } from "@/lib/source/provider";
import { useKazusaConfig } from "@/lib/state/config-store";

const THINKING_POLL_MS = 1500;
const IDLE_POLL_MS = 5000;
/** OpenClaw's Control UI checks incomplete totals on this same schedule. */
const PARTIAL_USAGE_POLLS_MS = [5000, 10_000, 20_000] as const;

/**
 * A character's brain turns. Only polled while something is showing them, so
 * they stay out of the stream that every client carries.
 */
export function useBrainTrace(id: string, limit: number, thinking: boolean) {
  const { resolved } = useSources();
  const { baseUrl, token } = useKazusaConfig();
  return useSWR<BrainTraceResponse, Error>(
    resolved.brain === "live"
      ? (["kazusa/brain/trace", baseUrl, id, limit] as const)
      : null,
    () => fetchBrainTrace(baseUrl, token, id, limit),
    {
      refreshInterval: thinking ? THINKING_POLL_MS : IDLE_POLL_MS,
      keepPreviousData: true,
    },
  );
}

/**
 * OpenClaw's usage report. Incomplete totals are checked again a few times,
 * then left for the viewer to refresh: a large world can stay partial
 * indefinitely.
 */
export function useUsage(days: number) {
  const { resolved } = useSources();
  const { baseUrl, token } = useKazusaConfig();
  const [checks, setChecks] = useState({ days, count: 0 });
  // Reads so far, counting the first load.
  const count = checks.days === days ? checks.count : 0;
  const swr = useSWR<UsageResponse, Error>(
    resolved.usage === "live"
      ? (["kazusa/usage", baseUrl, days] as const)
      : null,
    () => fetchUsage(baseUrl, token, days),
    {
      refreshInterval: (data) =>
        data?.partial ? (PARTIAL_USAGE_POLLS_MS[count - 1] ?? 0) : 0,
      keepPreviousData: true,
      onSuccess: () => setChecks({ days, count: count + 1 }),
    },
  );
  return {
    ...swr,
    /** Still checking on its own; otherwise only `refresh` asks again. */
    settling: count <= PARTIAL_USAGE_POLLS_MS.length,
    refresh: () => {
      setChecks({ days, count: 0 });
      return swr.mutate();
    },
  };
}
