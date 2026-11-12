"use client";

import { useQueryStates, parseAsString } from "nuqs";
import { timelineParsers } from "@/components/views/timeline/search-params";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { TimelineRow } from "@/components/views/timeline/timeline-row";
import { useRecentEvents } from "@/hooks/use-timeline";
import { RECENT_KINDS, TIMELINE_KINDS } from "@/lib/registry/timeline-kinds";
import type { EntityRef } from "@/lib/state/entity-ref";
import { formatSimTime } from "@/lib/time/sim";

/**
 * The Timeline stream component, filtered to one actor and a few rows: what
 * they did, without messages (already in Chats) or attention bookkeeping.
 */
export function CharacterRecentSection({ entity }: { entity: EntityRef }) {
  const { events, isLoading } = useRecentEvents(entity.id, 3, RECENT_KINDS);
  const [, setParams] = useQueryStates({
    view: parseAsString,
    "tl.actors": timelineParsers["tl.actors"],
    "tl.watch": timelineParsers["tl.watch"],
  });

  if (isLoading) {
    return (
      <div className="flex flex-col gap-2" aria-hidden>
        {Array.from({ length: 3 }).map((_, index) => (
          <Skeleton key={index} className="h-8" />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      {events.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing recorded yet.</p>
      ) : (
        <div className="-mx-3 flex flex-col">
          {events.map((event) => (
            <TimelineRow
              key={event.seq}
              event={event}
              compact
              omitActor={entity.id}
              className="py-1.5"
            />
          ))}
        </div>
      )}
      <Button
        variant="link"
        size="sm"
        className="self-start px-0"
        onClick={() =>
          void setParams({
            view: "timeline",
            "tl.actors": [entity.id],
            "tl.watch": null,
          })
        }
      >
        Open in Timeline
      </Button>
    </div>
  );
}

/** Folded: what they did last, and when. Shares the section's request. */
export function CharacterRecentSummary({ entity }: { entity: EntityRef }) {
  const { events } = useRecentEvents(entity.id, 3, RECENT_KINDS);
  const latest = events[0];
  if (!latest) return null;
  return (
    <>{`${TIMELINE_KINDS[latest.kind].label} at ${formatSimTime(latest.simTime)}`}</>
  );
}
