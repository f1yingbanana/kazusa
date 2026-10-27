'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowUpIcon, FilterIcon, StarIcon, XIcon } from 'lucide-react'
import type { JournalEvent, JournalKind } from '@kazusa/client'
import { CharacterChip } from '@/components/entities/chips'
import { MockTag } from '@/components/entities/source-state'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { useTimeline } from '@/hooks/use-timeline'
import { useListParam, useNavigate, useParam } from '@/hooks/use-url-state'
import { TIMELINE_KIND_LIST } from '@/lib/registry/timeline-kinds'
import { useWatchlist } from '@/lib/state/watchlist'
import { formatSimDateLong, simDayStart } from '@/lib/time/sim'
import { cn } from '@/lib/utils'
import { TimelineRow } from './timeline-row'

type Row =
  | { readonly type: 'day'; readonly key: string; readonly start: number }
  | { readonly type: 'event'; readonly key: string; readonly event: JournalEvent }

function buildRows(events: readonly JournalEvent[]): Row[] {
  const rows: Row[] = []
  let day: number | null = null
  for (const event of events) {
    const start = simDayStart(event.simTime)
    if (start !== day) {
      day = start
      rows.push({ type: 'day', key: `day-${start}`, start })
    }
    rows.push({ type: 'event', key: `e-${event.seq}`, event })
  }
  return rows
}

export function TimelineView() {
  const navigate = useNavigate()
  const actorParam = useListParam('tl.actors')
  const kindParam = useListParam('tl.kinds') as JournalKind[]
  const watchOnly = useParam('tl.watch') === '1'
  const watchlist = useWatchlist()

  const actors = watchOnly ? watchlist : actorParam
  const filters = useMemo(() => ({ actors, kinds: kindParam }), [actors, kindParam])
  const timeline = useTimeline(filters)
  const hasFilters = actorParam.length > 0 || kindParam.length > 0 || watchOnly

  const scrollRef = useRef<HTMLDivElement>(null)
  const [atTop, setAtTop] = useState(true)
  const [seenSeq, setSeenSeq] = useState(0)
  const newest = timeline.events[0]?.seq ?? 0

  // While scrolled away, newer events are held back so the viewport doesn't jump.
  const visible = useMemo(
    () => (atTop ? timeline.events : timeline.events.filter((e) => e.seq <= seenSeq)),
    [atTop, timeline.events, seenSeq],
  )
  const pending = atTop ? 0 : timeline.events.length - visible.length
  const rows = useMemo(() => buildRows(visible), [visible])

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => (rows[index]?.type === 'day' ? 36 : 56),
    getItemKey: (index) => rows[index]?.key ?? index,
    overscan: 8,
  })
  const items = virtualizer.getVirtualItems()
  const lastIndex = items.at(-1)?.index ?? 0

  useEffect(() => {
    if (lastIndex >= rows.length - 12 && timeline.hasMore && !timeline.isLoadingMore) {
      void timeline.loadMore()
    }
  }, [lastIndex, rows.length, timeline])

  function onScroll(event: React.UIEvent<HTMLDivElement>) {
    const top = event.currentTarget.scrollTop <= 8
    if (top === atTop) return
    if (!top) setSeenSeq(newest)
    setAtTop(top)
  }

  function setKinds(next: JournalKind[]) {
    navigate({ 'tl.kinds': next.join(',') || null }, 'replace')
  }

  return (
    <section aria-label="Timeline" className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2">
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
            <FilterIcon data-icon="inline-start" />
            Kinds
            {kindParam.length ? (
              <span className="font-mono text-xs text-muted-foreground tabular-nums">{kindParam.length}</span>
            ) : null}
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-56">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Event kinds</DropdownMenuLabel>
              {TIMELINE_KIND_LIST.map((kind) => (
                <DropdownMenuCheckboxItem
                  key={kind.kind}
                  checked={kindParam.includes(kind.kind)}
                  onCheckedChange={(checked) =>
                    setKinds(
                      checked ? [...kindParam, kind.kind] : kindParam.filter((k) => k !== kind.kind),
                    )
                  }
                >
                  <kind.icon />
                  {kind.label}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          variant={watchOnly ? 'secondary' : 'outline'}
          size="sm"
          aria-pressed={watchOnly}
          onClick={() => navigate({ 'tl.watch': watchOnly ? null : '1' }, 'replace')}
        >
          <StarIcon data-icon="inline-start" className={cn(watchOnly && 'fill-current')} />
          Watchlist only
        </Button>

        {!watchOnly
          ? actorParam.map((id) => (
              <span key={id} className="inline-flex items-center rounded-md border pr-0.5">
                <CharacterChip id={id} />
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() =>
                    navigate({ 'tl.actors': actorParam.filter((a) => a !== id).join(',') || null }, 'replace')
                  }
                >
                  <XIcon />
                  <span className="sr-only">Remove filter</span>
                </Button>
              </span>
            ))
          : null}

        {hasFilters ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate({ 'tl.actors': null, 'tl.kinds': null, 'tl.watch': null }, 'replace')}
          >
            Clear
          </Button>
        ) : null}
        <MockTag requires={['timeline']} className="ml-auto" />
      </div>

      <div className="relative min-h-0 flex-1">
        {timeline.isLoading ? (
          <TimelineSkeleton />
        ) : timeline.error ? (
          <Empty className="border-none">
            <EmptyHeader>
              <EmptyTitle>{"Couldn't load the timeline"}</EmptyTitle>
              <EmptyDescription>{timeline.error.message}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : rows.length === 0 ? (
          <Empty className="border-none">
            <EmptyHeader>
              <EmptyTitle>No events match these filters</EmptyTitle>
              <EmptyDescription>
                {watchOnly && watchlist.length === 0
                  ? 'Your watchlist is empty. Star characters in the roster to follow them here.'
                  : 'Try fewer kinds or characters.'}
              </EmptyDescription>
            </EmptyHeader>
            {hasFilters ? (
              <EmptyContent>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => navigate({ 'tl.actors': null, 'tl.kinds': null, 'tl.watch': null }, 'replace')}
                >
                  Reset filters
                </Button>
              </EmptyContent>
            ) : null}
          </Empty>
        ) : (
          <div ref={scrollRef} onScroll={onScroll} className="h-full overflow-y-auto">
            <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
              {items.map((item) => {
                const row = rows[item.index]
                return (
                  <div
                    key={item.key}
                    data-index={item.index}
                    ref={virtualizer.measureElement}
                    className="absolute inset-x-0 top-0"
                    style={{ transform: `translateY(${item.start}px)` }}
                  >
                    {row.type === 'day' ? (
                      <h3 className="flex h-9 items-center border-b bg-background px-3 font-mono text-xs font-medium text-muted-foreground">
                        {formatSimDateLong(row.start)}
                      </h3>
                    ) : (
                      <TimelineRow event={row.event} className="animate-in fade-in-0 slide-in-from-top-1 duration-300 motion-reduce:animate-none" />
                    )}
                  </div>
                )
              })}
            </div>
            {timeline.isLoadingMore ? (
              <div className="flex justify-center py-3">
                <Spinner />
              </div>
            ) : null}
          </div>
        )}

        {pending > 0 ? (
          <Button
            size="sm"
            className="absolute top-3 left-1/2 -translate-x-1/2 shadow-md"
            onClick={() => scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
          >
            <ArrowUpIcon data-icon="inline-start" />
            {pending === 1 ? '1 new event' : `${pending} new events`}
          </Button>
        ) : null}
      </div>
    </section>
  )
}

function TimelineSkeleton() {
  return (
    <div className="flex flex-col gap-1 p-3" aria-hidden>
      {Array.from({ length: 10 }).map((_, index) => (
        <div key={index} className="flex h-12 items-center gap-3">
          <Skeleton className="h-3 w-10" />
          <Skeleton className="size-4 rounded-full" />
          <Skeleton className="h-3.5 flex-1" />
        </div>
      ))}
    </div>
  )
}
