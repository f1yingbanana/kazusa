"use client";

import type { JournalKind } from "@kazusa/client";
import {
  ArrowUpIcon,
  BanIcon,
  ClockIcon,
  EyeIcon,
  HistoryIcon,
  ListFilterIcon,
  MessageSquareDashedIcon,
  MessageSquareTextIcon,
  MoonIcon,
  PencilLineIcon,
  PlayIcon,
  SunriseIcon,
  SunIcon,
  SunsetIcon,
  TimerResetIcon,
  UserCogIcon,
  UsersRoundIcon,
  type LucideIcon,
} from "lucide-react";
import { useQueryStates } from "nuqs";
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { useCharacters } from "@/hooks/use-characters";
import { useChats } from "@/hooks/use-chats";
import { useClockAnchor, useSimNow } from "@/hooks/use-clock";
import { usePlaces } from "@/hooks/use-location";
import { useObservedChats } from "@/hooks/use-observed-chats";
import { useTimeline } from "@/hooks/use-timeline";
import { usePageName } from "@/hooks/use-wiki";
import { formatDayLabel } from "@/lib/format";
import { groupByNearest } from "@/lib/state/grouping";
import { useWatchlist } from "@/lib/state/preferences-store";
import {
  buildChronicle,
  effectiveTimelineKinds,
  KIND_LABEL,
  kindsForPreset,
  matchesEventQuery,
  presetOfKinds,
  TIMELINE_FACETS,
  timelineKindsParam,
  type EventNameLookup,
  type TimelineFacetSpec,
  type TimelinePreset,
} from "@/lib/timeline/chronicle";
import type { DayPhase } from "@/lib/time/sim";
import { Button, IconButton } from "@/ui/button";
import { CheckList, CheckRow } from "@/ui/checkbox";
import { cx } from "@/ui/cx";
import { EmptySeats } from "@/ui/empty-seats";
import { SearchInput } from "@/ui/input";
import { Note } from "@/ui/note";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/popover";
import { createScrollAreaController, ScrollFeed } from "@/ui/scroll-log";
import { Segmented, SegmentedItem } from "@/ui/segmented";
import { Chronicle, ChronicleDay, ChroniclePhase } from "@/ui/timeline";
import { NO_FAVORITES } from "../characters/favorites";
import { BurstRow, EventRow } from "./event-row";
import { timelineFilterParsers } from "./search-params";

const PHASE_ICON: Record<DayPhase, ReactNode> = {
  Night: <MoonIcon aria-hidden />,
  Morning: <SunriseIcon aria-hidden />,
  Afternoon: <SunIcon aria-hidden />,
  Evening: <SunsetIcon aria-hidden />,
};

const KIND_ICONS: Record<JournalKind, LucideIcon> = {
  "task.started": PlayIcon,
  "task.delayed": TimerResetIcon,
  "task.stopped": BanIcon,
  "message.sent": MessageSquareTextIcon,
  "chat.created": UsersRoundIcon,
  "chat.renamed": PencilLineIcon,
  "chat.members_changed": UserCogIcon,
  "clock.changed": ClockIcon,
  "attention.decided": MessageSquareDashedIcon,
  "location.noticed": EyeIcon,
  "memory.consolidated": MoonIcon,
};

export function TimelineStage() {
  const [params, setParams] = useQueryStates(timelineFilterParsers, {
    history: "replace",
  });
  const actorParam = params["tl.actors"];
  const kindParam = params["tl.kinds"];
  const watchOnly = params["tl.watch"];
  const query = params["tl.q"];

  const watchlist = useWatchlist();
  const { characters, byId } = useCharacters();
  const pageName = usePageName();
  const places = usePlaces();
  const { chats } = useChats();
  const observed = useObservedChats();
  const now = useSimNow();
  const anchor = useClockAnchor();
  const running = Boolean(anchor && anchor.clock.speed > 0);

  const actors = watchOnly ? watchlist : actorParam;
  const kinds = effectiveTimelineKinds(kindParam);
  const preset = presetOfKinds(kinds);
  const filters = useMemo(() => ({ actors, kinds }), [actors, kinds]);
  const timeline = useTimeline(filters);

  const hasFilters =
    actorParam.length > 0 ||
    kindParam.length > 0 ||
    watchOnly ||
    query.trim().length > 0;

  const [scrollController] = useState(createScrollAreaController);
  const [atTop, setAtTop] = useState(true);
  const [seenSeq, setSeenSeq] = useState(0);

  const openedSeqRef = useRef<number | null>(null);
  if (openedSeqRef.current === null && !timeline.isLoading) {
    openedSeqRef.current = timeline.events[0]?.seq ?? 0;
  }
  const openedSeq = openedSeqRef.current;

  const newest = timeline.events[0]?.seq ?? 0;
  const unpaused = useMemo(
    () =>
      atTop
        ? timeline.events
        : timeline.events.filter((event) => event.seq <= seenSeq),
    [atTop, timeline.events, seenSeq],
  );
  const pending = atTop ? 0 : timeline.events.length - unpaused.length;

  const chatTitleMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of observed.chats) map.set(c.id, c.name);
    for (const c of chats) map.set(c.id, c.name);
    return map;
  }, [chats, observed.chats]);

  const names = useMemo<EventNameLookup>(
    () => ({
      characterName: (id) => byId.get(id)?.name ?? id,
      placeName: (id) => places?.byId.get(id)?.name ?? id,
      chatTitle: (id) => chatTitleMap.get(id) ?? id,
    }),
    [byId, places, chatTitleMap],
  );

  const filtered = useMemo(
    () =>
      query.trim()
        ? unpaused.filter((event) => matchesEventQuery(event, query, names))
        : unpaused,
    [unpaused, query, names],
  );

  const rows = useMemo(() => buildChronicle(filtered), [filtered]);

  const handleScroll = useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      const el = event.currentTarget;
      const top = el.scrollTop <= 12;
      if (top !== atTop) {
        if (!top) setSeenSeq(newest);
        setAtTop(top);
      }
      const remaining = el.scrollHeight - el.scrollTop - el.clientHeight;
      if (remaining < 320 && timeline.hasMore && !timeline.isLoadingMore) {
        void timeline.loadMore();
      }
    },
    [atTop, newest, timeline],
  );

  function setKinds(next: readonly JournalKind[]) {
    if (next.length === 0) return false;
    void setParams({ "tl.kinds": timelineKindsParam(next) });
    return true;
  }

  const matchedGroup = useMemo(() => {
    if (watchOnly || actorParam.length <= 1) return null;
    const set = new Set(actorParam);
    const groups = groupByNearest(characters, pageName);
    return (
      groups.find(
        (g) =>
          g.members.length === actorParam.length &&
          g.members.every((m) => set.has(m.id)),
      )?.label ?? null
    );
  }, [watchOnly, actorParam, characters, pageName]);

  const following = watchOnly
    ? "Favorites"
    : matchedGroup
      ? matchedGroup
      : actorParam.length === 1
        ? (byId.get(actorParam[0])?.name ?? actorParam[0])
        : actorParam.length > 1
          ? `${byId.get(actorParam[0])?.name ?? actorParam[0]} +${actorParam.length - 1}`
          : null;

  return (
    <section
      aria-label="Timeline"
      className="@container/stage flex min-h-0 min-w-0 flex-1 flex-col"
    >
      <header className="flex flex-col gap-2.5 border-b border-ui-line px-5 py-3 max-md:px-3.5 @[48rem]/stage:flex-row @[48rem]/stage:items-center @[48rem]/stage:justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="shrink-0 text-[0.9375rem] leading-tight font-extrabold">
            Timeline
          </h2>
          {running ? (
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-ui-accent-tint px-2 py-0.5 text-[0.6875rem] font-extrabold text-ui-accent-ink">
              <span className="relative flex size-1.5">
                <span className="absolute inset-0 rounded-full bg-ui-accent motion-safe:animate-ui-ping" />
                <span className="relative size-1.5 rounded-full bg-ui-accent-ink" />
              </span>
              Live
            </span>
          ) : anchor ? (
            <span className="inline-flex shrink-0 items-center rounded-full bg-ui-tint px-2 py-0.5 text-[0.6875rem] font-bold text-ui-soft">
              Paused
            </span>
          ) : null}
          {following ? (
            <span className="min-w-0 truncate rounded-full bg-ui-tint px-2.5 py-0.5 text-xs font-bold text-ui-ink">
              {following}
            </span>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <SearchInput
            aria-label="Search events"
            placeholder="Search events"
            value={query}
            onChange={(event) =>
              void setParams({ "tl.q": event.target.value || null })
            }
            className="h-9 min-w-36 flex-1 bg-ui-ground @[48rem]/stage:w-44 @[48rem]/stage:flex-none"
          />
          <Segmented<TimelinePreset>
            aria-label="Detail level"
            value={preset}
            onValueChange={(next) => {
              if (next) {
                void setParams({
                  "tl.kinds": timelineKindsParam(kindsForPreset(next)),
                });
              }
            }}
          >
            <SegmentedItem value="highlights">Highlights</SegmentedItem>
            <SegmentedItem value="activity">Activity</SegmentedItem>
            <SegmentedItem value="everything">Everything</SegmentedItem>
          </Segmented>
          <KindFilterPopover
            effectiveKinds={kinds}
            isCustom={preset === null}
            onToggleSingle={(kind, checked) => {
              const next = checked
                ? [...new Set([...kinds, kind])]
                : kinds.filter((k) => k !== kind);
              return setKinds(next);
            }}
            onReplaceFacet={(facet, nextInFacet) => {
              const outside = kinds.filter((k) => !facet.kinds.includes(k));
              return setKinds([...outside, ...nextInFacet]);
            }}
          />
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1 flex-col">
        {timeline.isLoading ? (
          <TimelineSkeleton />
        ) : timeline.error ? (
          <div className="m-auto max-w-96 p-6">
            <Note>
              {`Couldn't load the timeline: ${timeline.error.message}`}
            </Note>
          </div>
        ) : rows.length === 0 ? (
          timeline.isSwitching ? null : (
            <EmptyChronicle
              hasFilters={hasFilters}
              query={query}
              watchOnly={watchOnly}
              watchlistCount={watchlist.length}
              hasMore={timeline.hasMore}
              isLoadingMore={timeline.isLoadingMore}
              onLoadMore={() => void timeline.loadMore()}
              onReset={() =>
                void setParams({
                  "tl.actors": null,
                  "tl.kinds": null,
                  "tl.watch": null,
                  "tl.q": null,
                })
              }
            />
          )
        ) : (
          <ScrollFeed
            label="Events"
            controller={scrollController}
            onScroll={handleScroll}
            overlay={
              pending > 0 ? (
                <div className="pointer-events-none absolute inset-x-0 top-3 z-20 flex justify-center">
                  <Button
                    tone="soft"
                    size="sm"
                    icon={<ArrowUpIcon aria-hidden />}
                    className="pointer-events-auto ui-raised bg-ui-surface text-ui-ink shadow-ui hover:bg-ui-tint motion-safe:animate-ui-pop"
                    onClick={() => {
                      setSeenSeq(newest);
                      setAtTop(true);
                      scrollController.scrollToStart();
                    }}
                  >
                    {pending === 1 ? "1 new event" : `${pending} new events`}
                  </Button>
                </div>
              ) : null
            }
          >
            <Chronicle
              label="World events"
              busy={timeline.isLoadingMore}
              className="mx-auto w-full max-w-4xl pt-2"
            >
              {rows.map((row) => {
                if (row.type === "day") {
                  return (
                    <ChronicleDay
                      key={row.key}
                      id={`timeline-day-${row.start}`}
                      label={formatDayLabel(row.start, now)}
                    />
                  );
                }
                if (row.type === "phase") {
                  return (
                    <ChroniclePhase
                      key={row.key}
                      icon={PHASE_ICON[row.phase]}
                      label={row.phase}
                    />
                  );
                }
                if (row.type === "burst") {
                  const isNew =
                    openedSeq !== null && row.events[0].seq > openedSeq;
                  return (
                    <BurstRow
                      key={row.key}
                      category={row.category}
                      label={row.label}
                      chatId={row.chatId}
                      events={row.events}
                      enter={isNew}
                    />
                  );
                }
                const isNew = openedSeq !== null && row.event.seq > openedSeq;
                return (
                  <EventRow
                    key={row.key}
                    event={row.event}
                    enter={isNew}
                    live={isNew && running}
                  />
                );
              })}
            </Chronicle>

            <footer className="flex flex-col items-center gap-2 px-5 pt-6 text-center">
              {timeline.hasMore ? (
                <Button
                  tone="soft"
                  size="sm"
                  disabled={timeline.isLoadingMore}
                  onClick={() => void timeline.loadMore()}
                >
                  {timeline.isLoadingMore
                    ? "Loading earlier events…"
                    : "Load earlier events"}
                </Button>
              ) : (
                <p className="text-xs font-semibold text-ui-soft">
                  Beginning of the world
                </p>
              )}
            </footer>
          </ScrollFeed>
        )}
      </div>
    </section>
  );
}

function KindFilterPopover({
  effectiveKinds,
  isCustom,
  onToggleSingle,
  onReplaceFacet,
}: {
  effectiveKinds: readonly JournalKind[];
  isCustom: boolean;
  onToggleSingle: (kind: JournalKind, checked: boolean) => boolean;
  onReplaceFacet: (
    facet: TimelineFacetSpec,
    nextInFacet: readonly JournalKind[],
  ) => boolean;
}) {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <IconButton
            label="Event types"
            title="Filter event types"
            tone={isCustom ? "primary" : "soft"}
            size="md"
            className={cx(isCustom && "inset-ring-2 inset-ring-ui-primary")}
          />
        }
      >
        <ListFilterIcon aria-hidden />
      </PopoverTrigger>
      <PopoverContent
        aria-label="Event types"
        className="w-[min(17rem,calc(100vw-2rem))] gap-1 p-2.5"
      >
        <div className="flex flex-col">
          {TIMELINE_FACETS.map((facet) => {
            if (facet.kinds.length === 1) {
              const kind = facet.kinds[0];
              const Icon = KIND_ICONS[kind];
              const checked = effectiveKinds.includes(kind);
              return (
                <CheckRow
                  key={facet.id}
                  checked={checked}
                  disabled={checked && effectiveKinds.length === 1}
                  icon={<Icon />}
                  label={facet.label}
                  className="min-h-8 py-1"
                  onCheckedChange={(next, details) => {
                    if (!onToggleSingle(kind, next === true)) {
                      details.cancel();
                    }
                  }}
                />
              );
            }

            const inFacet = facet.kinds.filter((k) =>
              effectiveKinds.includes(k),
            );

            return (
              <CheckList<JournalKind>
                key={facet.id}
                label={facet.label}
                allValues={[...facet.kinds]}
                value={[...inFacet]}
                className="gap-0"
                onValueChange={(next, details) => {
                  if (!onReplaceFacet(facet, next)) {
                    details.cancel();
                  }
                }}
              >
                <CheckRow
                  parent
                  disabled={
                    inFacet.length > 0 && inFacet.length === effectiveKinds.length
                  }
                  label={facet.label}
                  className="min-h-8 py-1"
                />
                <div className="flex flex-col ps-5">
                  {facet.kinds.map((kind) => {
                    const Icon = KIND_ICONS[kind];
                    const checked = effectiveKinds.includes(kind);
                    return (
                      <CheckRow
                        key={kind}
                        value={kind}
                        disabled={checked && effectiveKinds.length === 1}
                        icon={<Icon />}
                        label={KIND_LABEL[kind]}
                        className="min-h-7.5 py-0.5 text-[0.8125rem]"
                      />
                    );
                  })}
                </div>
              </CheckList>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function EmptyChronicle({
  hasFilters,
  query,
  watchOnly,
  watchlistCount,
  hasMore,
  isLoadingMore,
  onLoadMore,
  onReset,
}: {
  hasFilters: boolean;
  query: string;
  watchOnly: boolean;
  watchlistCount: number;
  hasMore: boolean;
  isLoadingMore: boolean;
  onLoadMore: () => void;
  onReset: () => void;
}) {
  if (watchOnly && watchlistCount === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <EmptySeats title="No favorites yet">{NO_FAVORITES}</EmptySeats>
      </div>
    );
  }
  if (query.trim()) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <EmptySeats
          title={`Nothing matches “${query.trim()}”`}
          action={
            <div className="flex flex-wrap justify-center gap-2 pt-1">
              {hasMore ? (
                <Button
                  tone="soft"
                  size="sm"
                  disabled={isLoadingMore}
                  onClick={onLoadMore}
                >
                  {isLoadingMore ? "Loading…" : "Search earlier events"}
                </Button>
              ) : null}
              <Button tone="primary" size="sm" onClick={onReset}>
                Show everything
              </Button>
            </div>
          }
        >
          Search checks loaded events. Try another word or load earlier history.
        </EmptySeats>
      </div>
    );
  }
  if (hasFilters) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <EmptySeats
          title="No events match these filters"
          action={
            <Button tone="soft" size="sm" onClick={onReset}>
              Show everything
            </Button>
          }
        >
          Try widening the detail level or picking another person.
        </EmptySeats>
      </div>
    );
  }
  return (
    <div className="m-auto flex max-w-84 flex-col items-center gap-3 p-8 text-center">
      <span className="grid size-14 place-items-center rounded-[1.25rem] bg-ui-tint text-ui-primary motion-safe:animate-ui-bob [&_svg]:size-6">
        <HistoryIcon aria-hidden />
      </span>
      <h2 className="text-lg font-extrabold">Nothing recorded yet</h2>
      <p className="text-sm text-pretty text-ui-soft">
        Events appear here as characters act, travel, meet, and dream.
      </p>
    </div>
  );
}

function TimelineSkeleton() {
  return (
    <div
      className="mx-auto flex w-full max-w-4xl flex-col gap-3 p-5"
      aria-busy="true"
    >
      {Array.from({ length: 8 }).map((_, index) => (
        <div key={index} className="flex items-center gap-3">
          <span className="h-3 w-10 rounded-full bg-ui-tint motion-safe:animate-ui-pulse" />
          <span className="size-6 shrink-0 rounded-full bg-ui-tint motion-safe:animate-ui-pulse" />
          <span className="h-4 flex-1 rounded-full bg-ui-tint motion-safe:animate-ui-pulse" />
        </div>
      ))}
    </div>
  );
}
