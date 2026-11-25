"use client";

import { useCallback, useMemo } from "react";
import useSWR, { useSWRConfig } from "swr";
import type {
  MemoryRunsResponse,
  WikiDeletePayload,
  WikiEditResult,
  WikiKind,
  WikiSavePayload,
  WikiSourceResponse,
  WikiLintResponse,
  WikiListResponse,
  WikiPageResponse,
} from "@kazusa/client";
import {
  deleteWikiPage,
  fetchMemoryRuns,
  fetchWikiLint,
  fetchWikiList,
  fetchWikiPage,
  fetchWikiSource,
  saveWikiSource,
  WIKI_KEY,
} from "@/lib/source/wiki/http";
import { useAccess } from "@/hooks/use-access";
import { useSources } from "@/lib/source/provider";

/** Wiki reads. Only live: Markdown on the server is the one truth. */
function useWikiKey(parts: readonly unknown[], ready = true) {
  const { resolved } = useSources();
  return resolved.wiki === "live" && ready
    ? ([WIKI_KEY, ...parts] as const)
    : null;
}

export function useWikiList(agent?: string) {
  return useSWR<WikiListResponse>(useWikiKey(["list", agent ?? ""]), () =>
    fetchWikiList(agent),
  );
}

/**
 * A page's name from how something refers to it: its id, name or an alias, as a
 * character's groups are written ("after_school_sweets_club" reads
 * "After-School Sweets Club"). Without the page, the words with their
 * separators as spaces.
 */
export function usePageName(): (ref: string) => string {
  const { data: list } = useWikiList();
  const names = useMemo(() => {
    const byRef = new Map<string, string>();
    for (const page of list?.pages ?? []) {
      for (const ref of [page.id, page.name, ...page.aliases])
        byRef.set(ref.toLowerCase(), page.name);
    }
    return byRef;
  }, [list]);
  return useCallback(
    (ref: string) => {
      const name = names.get(ref.toLowerCase());
      if (name) return name;
      const words = ref.replace(/[_-]+/g, " ").trim();
      return words.charAt(0).toUpperCase() + words.slice(1);
    },
    [names],
  );
}

export function useWikiPage(id: string | undefined, agent?: string) {
  return useSWR<WikiPageResponse>(
    useWikiKey(["page", id, agent ?? ""], Boolean(id)),
    () => fetchWikiPage(id ?? "", agent),
  );
}

/** Every wiki's problems, the characters' own included. */
export function useWikiLint() {
  return useSWR<WikiLintResponse>(useWikiKey(["lint"]), () => fetchWikiLint());
}

export function useMemoryRuns(agent: string | undefined) {
  return useSWR<MemoryRunsResponse>(
    useWikiKey(["runs", agent], Boolean(agent)),
    () => fetchMemoryRuns(agent ?? ""),
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
  return useSWR<WikiSourceResponse>(
    useWikiKey(["source", id, agent ?? "", kind ?? ""], Boolean(id)),
    () => fetchWikiSource(id ?? "", agent, kind),
    {
      revalidateOnMount: true,
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    },
  );
}

/** Every wiki read (pages, lists, problems) reloads after a write. */
function useWikiWrite<Payload, Result>(
  write: (payload: Payload) => Promise<Result>,
) {
  const { mutate } = useSWRConfig();
  const { canManage } = useAccess();

  return useCallback(
    async (payload: Payload): Promise<Result> => {
      if (!canManage) {
        throw new Error("You do not have permission to edit the wiki.");
      }
      const result = await write(payload);
      // Without data: even `undefined` would empty every list meanwhile.
      void mutate(
        (key) =>
          Array.isArray(key) && key[0] === WIKI_KEY && key[1] !== "source",
      );
      return result;
    },
    [canManage, mutate, write],
  );
}

export function useSaveWikiPage() {
  return useWikiWrite<WikiSavePayload, WikiSourceResponse>(saveWikiSource);
}

export function useDeleteWikiPage() {
  return useWikiWrite<WikiDeletePayload, WikiEditResult>(deleteWikiPage);
}
