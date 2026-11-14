"use client";

import useSWR from "swr";
import type { WorldDownload } from "@/lib/run-script";

async function fetchProgress(): Promise<WorldDownload | null> {
  const response = await fetch("/setup/world", { cache: "no-store" });
  if (!response.ok) return null;
  const body = (await response.json()) as { progress?: WorldDownload | null };
  return body.progress ?? null;
}

/**
 * How far the setup guide's download of the picked world has got, polled while
 * `enabled`. Git reports it; the server keeps it in memory.
 */
export function useSetupDownload(
  enabled: boolean,
  intervalMs = 1000,
): WorldDownload | undefined {
  const { data } = useSWR(
    enabled ? ["setup/world/progress"] : null,
    fetchProgress,
    { refreshInterval: intervalMs },
  );
  return data ?? undefined;
}
