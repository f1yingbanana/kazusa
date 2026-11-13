"use client";

import { useState } from "react";
import useSWR from "swr";
import type { WorldDownload } from "@/lib/setup/setup";
import { useSources } from "@/lib/source/provider";

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
 * only, like setup and updates: elsewhere it answers nothing, and polling
 * stops.
 */
export function useWorldDownloads(enabled = true, intervalMs = 1000) {
  const { data } = useSWR(
    enabled ? ["setup/world/downloads"] : null,
    fetchDownloads,
    {
      refreshInterval: (latest) => (latest === null ? 0 : intervalMs),
      revalidateOnFocus: true,
    },
  );
  return data ?? undefined;
}

/**
 * The live world's template downloading now, if it is. When the download ends,
 * the world's metadata is fetched again, so the version it brought shows
 * without a reload.
 */
export function useLiveTemplateDownload(
  enabled = true,
  intervalMs = 1000,
): WorldDownload | undefined {
  const { worldResource } = useSources();
  const progress = useWorldDownloads(enabled, intervalMs);
  const download = progress?.downloads.find(({ id }) => id === progress.live);
  const downloading = Boolean(download);
  const [wasDownloading, setWasDownloading] = useState(downloading);
  if (wasDownloading !== downloading) {
    setWasDownloading(downloading);
    if (!downloading) void worldResource.mutate();
  }
  return download;
}
