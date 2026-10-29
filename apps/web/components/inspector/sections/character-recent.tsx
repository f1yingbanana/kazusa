'use client'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { TimelineRow } from '@/components/views/timeline/timeline-row'
import { useRecentEvents } from '@/hooks/use-timeline'
import { useNavigate } from '@/hooks/use-url-state'
import { RECENT_KINDS } from '@/lib/registry/timeline-kinds'
import type { EntityRef } from '@/lib/state/entity-ref'

/**
 * The Timeline stream component, filtered to one actor and a few rows: what
 * they did, without messages (already in Chats) or attention bookkeeping.
 */
export function CharacterRecentSection({ entity }: { entity: EntityRef }) {
  const { events, isLoading } = useRecentEvents(entity.id, 5, RECENT_KINDS)
  const navigate = useNavigate()

  if (isLoading) {
    return (
      <div className="flex flex-col gap-2" aria-hidden>
        {Array.from({ length: 3 }).map((_, index) => (
          <Skeleton key={index} className="h-8" />
        ))}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1">
      {events.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing recorded yet.</p>
      ) : (
        <div className="-mx-3 flex flex-col">
          {events.map((event) => (
            <TimelineRow key={event.seq} event={event} compact omitActor={entity.id} className="py-1.5" />
          ))}
        </div>
      )}
      <Button
        variant="link"
        size="sm"
        className="self-start px-0"
        onClick={() => navigate({ view: 'timeline', 'tl.actors': entity.id, 'tl.watch': null })}
      >
        Open in Timeline
      </Button>
    </div>
  )
}
