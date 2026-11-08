"use client";

import { useCallback } from "react";
import useSWR, { useSWRConfig } from "swr";
import type {
  MemoryRunsResponse,
  WikiDeletePayload,
  WikiEditResult,
  WikiRenamePayload,
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
  renameWikiPage,
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

export function useWikiPage(id: string | undefined, agent?: string) {
  return useSWR<WikiPageResponse>(
    useWikiKey(["page", id, agent ?? ""], Boolean(id)),
    () => fetchWikiPage(id ?? "", agent),
  );
}

export function useWikiLint(agent?: string) {
  return useSWR<WikiLintResponse>(useWikiKey(["lint", agent ?? ""]), () =>
    fetchWikiLint(agent),
  );
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
      void mutate(
        (key) =>
          Array.isArray(key) && key[0] === WIKI_KEY && key[1] !== "source",
        undefined,
        { revalidate: true },
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

export function useRenameWikiPage() {
  return useWikiWrite<WikiRenamePayload, WikiEditResult>(renameWikiPage);
}
