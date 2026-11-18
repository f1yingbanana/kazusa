"use client";

import useSWR from "swr";
import type {
  WikiBackdropsResponse,
  WikiCharacterResponse,
  WikiKind,
  WikiPageForm,
  WikiReachResponse,
} from "@kazusa/client";
import {
  WIKI_BACKDROPS_KEY,
  fetchWikiBackdrops,
  fetchWikiCharacter,
  fetchWikiForm,
  fetchWikiReach,
  wikiCharacterKey,
  wikiFormKey,
  wikiReachKey,
} from "@/lib/source/wiki/editor";

/*
 * Reads for what the Wiki edits. None revalidates on focus: a reload under
 * someone's typing would only confuse; saves refresh them themselves.
 */
const QUIET = { revalidateOnFocus: false } as const;

/** A character's memory, looks and stickers. */
export function useWikiCharacter(id: string | undefined) {
  return useSWR<WikiCharacterResponse, Error>(
    id ? wikiCharacterKey(id) : null,
    () => fetchWikiCharacter(id ?? ""),
    QUIET,
  );
}

export function useWikiBackdrops(enabled = true) {
  return useSWR<WikiBackdropsResponse, Error>(
    enabled ? WIKI_BACKDROPS_KEY : null,
    fetchWikiBackdrops,
    QUIET,
  );
}

/** A page split for the form; read once, as the raw editor's source is. */
export function useWikiForm(
  id: string | undefined,
  agent?: string,
  kind?: WikiKind,
) {
  return useSWR<WikiPageForm, Error>(
    id ? wikiFormKey(id, agent, kind) : null,
    () => fetchWikiForm(id ?? "", agent, kind),
    { ...QUIET, revalidateOnReconnect: false },
  );
}

/** Who in the cast knows a page how well; `kazusa/wiki` writes refresh it. */
export function useWikiReach(id: string | undefined) {
  return useSWR<WikiReachResponse, Error>(
    id ? wikiReachKey(id) : null,
    () => fetchWikiReach(id ?? ""),
    QUIET,
  );
}
