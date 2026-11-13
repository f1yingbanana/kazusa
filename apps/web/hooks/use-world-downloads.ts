"use client";

import useSWR from "swr";
import type { WorldDownload } from "@/lib/setup/setup";

export interface WorldDownloads {
  readonly downloads: readonly WorldDownload[];
  /** The template the live world came from; null before setup. */
  readonly live: string | null;
}

async function fetchDownloads(): Promise<WorldDownloads | null> {
  const response = await fetch("/setup/world", { cache: "no-store" });
  return response.ok ? ((await response.json()) as WorldDownloads) : null;
}

/**
 * Templates downloading now (`GET /setup/world`), polled while `enabled`. Local
 * only, like setup and updates: elsewhere it answers nothing.
 */
export function useWorldDownloads(enabled = true, intervalMs = 1000) {
  const { data } = useSWR(
    enabled ? ["setup/world/downloads"] : null,
    fetchDownloads,
    { refreshInterval: intervalMs, revalidateOnFocus: true },
  );
  return data ?? undefined;
}
