"use client";

import useSWR from "swr";
import type {
  MemoryRunsResponse,
  WikiLintResponse,
  WikiListResponse,
  WikiPageResponse,
} from "@kazusa/client";
import {
  fetchMemoryRuns,
  fetchWikiLint,
  fetchWikiList,
  fetchWikiPage,
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
