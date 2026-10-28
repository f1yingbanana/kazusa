"use client";

import { useMemo, useSyncExternalStore } from "react";
import useSWR from "swr";
import useSWRInfinite from "swr/infinite";
import type {
  JournalKind,
  TimelineQuery,
  TimelineResponse,
} from "@kazusa/client";
import { mergeNewestFirst } from "@/lib/live/journal";
import { journalTailStore } from "@/lib/live/state";
import {
  matchesTimelineQuery,
  queryJournal,
  TIMELINE_PAGE_SIZE,
} from "@/lib/source/mock/timeline";
import { fetchTimeline } from "@/lib/source/timeline/http";
import { useSources } from "@/lib/source/provider";
import { useKazusaConfig } from "@/lib/state/config-store";

export interface TimelineFilters {
  readonly actors?: readonly string[];
  readonly kinds?: readonly JournalKind[];
  readonly chats?: readonly string[];
}

function toQuery(filters: TimelineFilters): TimelineQuery {
  return {
    actors: filters.actors?.length ? [...filters.actors] : undefined,
    kinds: filters.kinds?.length ? [...filters.kinds] : undefined,
    chats: filters.chats?.length ? [...filters.chats] : undefined,
  };
}

function useTimelineFetcher() {
  const { resolved, world } = useSources();
  const config = useKazusaConfig();
  const source = resolved.timeline;
  const fetcher = (query: TimelineQuery): Promise<TimelineResponse> => {
    if (source === "mock" && world)
      return Promise.resolve(queryJournal(world.journal, query));
    return fetchTimeline(config.baseUrl, query, config.token);
  };
  return { source, worldId: world?.id ?? 0, fetcher };
}

function useTail(query: TimelineQuery) {
  const tail = useSyncExternalStore(
    (listener) => journalTailStore.subscribe(listener),
    () => journalTailStore.get(),
    () => [],
  );
  return useMemo(
    () => tail.filter((event) => matchesTimelineQuery(event, query)),
    [tail, query],
  );
}

/** History pages (`before`, newest-first) merged with the live tail. */
export function useTimeline(filters: TimelineFilters) {
  const { source, worldId, fetcher } = useTimelineFetcher();
  const query = useMemo(() => toQuery(filters), [filters]);
  const filterKey = JSON.stringify(query);

  const { data, error, isLoading, size, setSize, isValidating } =
    useSWRInfinite<TimelineResponse, Error>(
      (index: number, previous: TimelineResponse | null) => {
        if (source === "unavailable") return null;
        if (index === 0)
          return ["kazusa/timeline", source, worldId, filterKey, null] as const;
        if (!previous?.hasMore || previous.nextCursor === undefined)
          return null;
        return [
          "kazusa/timeline",
          source,
          worldId,
          filterKey,
          previous.nextCursor,
        ] as const;
      },
      ([, , , , before]: readonly [
        string,
        string,
        number,
        string,
        number | null,
      ]) =>
        fetcher({
          ...query,
          before: typeof before === "number" ? before : undefined,
          limit: TIMELINE_PAGE_SIZE,
        }),
      { revalidateOnFocus: false, revalidateFirstPage: false },
    );

  const tail = useTail(query);
  const history = useMemo(
    () => data?.flatMap((page) => page.events) ?? [],
    [data],
  );
  const events = useMemo(
    () => mergeNewestFirst(tail, history),
    [tail, history],
  );
  const hasMore = Boolean(data?.[data.length - 1]?.hasMore);
  const isLoadingMore = isValidating && size > (data?.length ?? 0);

  return {
    events,
    error: error,
    isLoading,
    hasMore,
    isLoadingMore,
    loadMore: () => setSize(size + 1),
    source,
  };
}

/** The few latest events for one actor (inspector "Recent"). */
export function useRecentEvents(
  actorId: string,
  limit: number,
  kinds: readonly JournalKind[],
) {
  const { source, worldId, fetcher } = useTimelineFetcher();
  const kindsKey = kinds.join(",");
  const query = useMemo(
    () =>
      toQuery({
        actors: [actorId],
        kinds: kindsKey.split(",") as JournalKind[],
      }),
    [actorId, kindsKey],
  );
  const { data, isLoading } = useSWR(
    source === "unavailable"
      ? null
      : ([
          "kazusa/timeline/recent",
          source,
          worldId,
          actorId,
          limit,
          kindsKey,
        ] as const),
    () => fetcher({ ...query, limit }),
    { revalidateOnFocus: false },
  );
  const tail = useTail(query);
  const events = useMemo(
    () => mergeNewestFirst(tail, data?.events ?? []).slice(0, limit),
    [tail, data, limit],
  );
  return { events, isLoading, source };
}
