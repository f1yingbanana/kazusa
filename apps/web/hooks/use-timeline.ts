"use client";

import { useMemo } from "react";
import useSWR from "swr";
import useSWRInfinite from "swr/infinite";
import type {
  JournalKind,
  TimelineQuery,
  TimelineResponse,
} from "@kazusa/client";
import { mergeNewestFirst } from "@/lib/live/journal";
import { useLiveStore } from "@/lib/live/state";
import { fetchTimeline } from "@/lib/source/timeline/http";
import {
  matchesTimelineQuery,
  TIMELINE_PAGE_SIZE,
} from "@/lib/source/timeline/query";
import { useSources } from "@/lib/source/provider";

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

function useTail(query: TimelineQuery) {
  const tail = useLiveStore((state) => state.journalTail);
  return useMemo(
    () => tail.filter((event) => matchesTimelineQuery(event, query)),
    [tail, query],
  );
}

/** History pages (`before`, newest-first) merged with the live tail. */
export function useTimeline(filters: TimelineFilters) {
  const { resolved } = useSources();
  const source = resolved.timeline;
  const query = useMemo(() => toQuery(filters), [filters]);

  const { data, error, isLoading, size, setSize, isValidating } =
    useSWRInfinite<TimelineResponse, Error>(
      (index: number, previous: TimelineResponse | null) => {
        if (source === "unavailable") return null;
        if (index === 0) return ["kazusa/timeline", query, null] as const;
        if (!previous?.hasMore || previous.nextCursor === undefined)
          return null;
        return ["kazusa/timeline", query, previous.nextCursor] as const;
      },
      ([, pageQuery, before]: readonly [
        string,
        TimelineQuery,
        number | null,
      ]) =>
        fetchTimeline({
          ...pageQuery,
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
  const lastPage = data?.[data.length - 1];
  const hasMore = Boolean(
    lastPage?.hasMore && lastPage.nextCursor !== undefined,
  );
  const isLoadingMore = isValidating && size > (data?.length ?? 0);

  return {
    events,
    error,
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
  const { resolved } = useSources();
  const source = resolved.timeline;
  const query = useMemo(
    () =>
      toQuery({
        actors: [actorId],
        kinds,
      }),
    [actorId, kinds],
  );
  const { data, isLoading } = useSWR(
    source === "unavailable"
      ? null
      : (["kazusa/timeline/recent", query, limit] as const),
    () => fetchTimeline({ ...query, limit }),
    { revalidateOnFocus: false },
  );
  const tail = useTail(query);
  const events = useMemo(
    () => mergeNewestFirst(tail, data?.events ?? []).slice(0, limit),
    [tail, data, limit],
  );
  return { events, isLoading, source };
}
