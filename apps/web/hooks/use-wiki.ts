"use client";

import { useCallback } from "react";
import useSWR, { useSWRConfig } from "swr";
import type {
  MemoryRunsResponse,
  WikiKind,
  WikiSavePayload,
  WikiSourceResponse,
  WikiLintResponse,
  WikiListResponse,
  WikiPageResponse,
} from "@kazusa/client";
import {
  fetchMemoryRuns,
  fetchWikiLint,
  fetchWikiList,
  fetchWikiPage,
  fetchWikiSource,
  saveWikiSource,
  WIKI_KEY,
} from "@/lib/source/wiki/http";
import { useSources } from "@/lib/source/provider";
import { useKazusaConfig } from "@/lib/state/config-store";

/** Wiki reads. Only live: Markdown on the server is the one truth. */
function useWikiKey(parts: readonly unknown[], ready = true) {
  const { resolved } = useSources();
  const { baseUrl } = useKazusaConfig();
  return resolved.wiki === "live" && ready
    ? ([WIKI_KEY, baseUrl, ...parts] as const)
    : null;
}

export function useWikiList(agent?: string) {
  const { baseUrl, token } = useKazusaConfig();
  return useSWR<WikiListResponse>(useWikiKey(["list", agent ?? ""]), () =>
    fetchWikiList(baseUrl, token, agent),
  );
}

export function useWikiPage(id: string | undefined, agent?: string) {
  const { baseUrl, token } = useKazusaConfig();
  return useSWR<WikiPageResponse>(
    useWikiKey(["page", id, agent ?? ""], Boolean(id)),
    () => fetchWikiPage(baseUrl, token, id ?? "", agent),
  );
}

export function useWikiLint(agent?: string) {
  const { baseUrl, token } = useKazusaConfig();
  return useSWR<WikiLintResponse>(useWikiKey(["lint", agent ?? ""]), () =>
    fetchWikiLint(baseUrl, token, agent),
  );
}

export function useMemoryRuns(agent: string | undefined) {
  const { baseUrl, token } = useKazusaConfig();
  return useSWR<MemoryRunsResponse>(
    useWikiKey(["runs", agent], Boolean(agent)),
    () => fetchMemoryRuns(baseUrl, token, agent ?? ""),
  );
}

/**
 * A page's Markdown for editing. Read once: refreshing under someone typing
 * would move the version their save is checked against.
 */
export function useWikiSource(
  id: string | undefined,
  agent?: string,
  kind?: WikiKind,
) {
  const { baseUrl, token } = useKazusaConfig();
  return useSWR<WikiSourceResponse>(
    useWikiKey(["source", id, agent ?? "", kind ?? ""], Boolean(id)),
    () => fetchWikiSource(baseUrl, token, id ?? "", agent, kind),
    { revalidateOnFocus: false, revalidateIfStale: false },
  );
}

/** Saves a page; every wiki read (pages, lists, problems) reloads after. */
export function useSaveWikiPage() {
  const { baseUrl, token } = useKazusaConfig();
  const { mutate } = useSWRConfig();
  return useCallback(
    async (payload: WikiSavePayload): Promise<WikiSourceResponse> => {
      const saved = await saveWikiSource(baseUrl, token, payload);
      void mutate(
        (key) => Array.isArray(key) && key[0] === WIKI_KEY,
        undefined,
        { revalidate: true },
      );
      return saved;
    },
    [baseUrl, token, mutate],
  );
}
