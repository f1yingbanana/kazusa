"use client";

import type { JournalEvent, JournalKind } from "@kazusa/client";
import { parseAsString, useQueryStates } from "nuqs";
import { useRecentEvents } from "@/hooks/use-timeline";
import { DEFAULT_TIMELINE_KINDS, KIND_LABEL } from "@/lib/timeline/chronicle";
import type { EntityRef } from "@/lib/state/entity-ref";
import { formatSimTime } from "@/lib/time/sim";
import { Button } from "@/ui/button";
import { ClampText } from "@/ui/clamp-text";
import { Note } from "@/ui/note";
import { timelineParsers, timelinePatch } from "../timeline/search-params";

/** What they did: no messages (Chats has them) and no nights' sleep. */
const RECENT_KINDS: readonly JournalKind[] = DEFAULT_TIMELINE_KINDS.filter(
  (kind) => kind !== "memory.consolidated",
);

const SHOWN = 3;

/** The words that say what happened, where the event has some of its own. */
function whatOf(event: JournalEvent): string | undefined {
  switch (event.kind) {
    case "task.started":
    case "task.stopped":
      return event.payload.description;
    case "task.delayed":
      return event.payload.reason;
    default:
      return undefined;
  }
}

/** Their last few events, the Timeline's own rows, and the way into it. */
export function CharacterRecentSection({ entity }: { entity: EntityRef }) {
  const { events, isLoading } = useRecentEvents(entity.id, SHOWN, RECENT_KINDS);
  const [, setParams] = useQueryStates({
    view: parseAsString,
    "tl.actors": timelineParsers["tl.actors"],
    "tl.watch": timelineParsers["tl.watch"],
  });
  if (isLoading) return <Note>Loading…</Note>;
  return (
    <div className="flex flex-col gap-2">
      {events.length === 0 ? (
        <Note>Nothing recorded yet.</Note>
      ) : (
        <ol className="flex flex-col gap-1.5">
          {events.map((event) => (
            <li
              key={event.seq}
              className="flex min-w-0 gap-2.5 text-[0.8125rem]"
            >
              <time
                className="w-10 shrink-0 text-xs leading-5 text-ui-soft tabular-nums"
                dateTime={new Date(event.simTime).toISOString()}
              >
                {formatSimTime(event.simTime)}
              </time>
              <div className="flex min-w-0 flex-col">
                <span className="font-bold">{KIND_LABEL[event.kind]}</span>
                {whatOf(event) ? (
                  <ClampText lines={2} className="text-ui-soft">
                    {whatOf(event)}
                  </ClampText>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      )}
      <Button
        tone="soft"
        size="sm"
        className="self-start"
        onClick={() => void setParams(timelinePatch([entity.id]))}
      >
        Open in Timeline
      </Button>
    </div>
  );
}

/** Folded: what they did last, and when. Shares the section's request. */
export function CharacterRecentSummary({ entity }: { entity: EntityRef }) {
  const { events } = useRecentEvents(entity.id, SHOWN, RECENT_KINDS);
  const latest = events[0];
  if (!latest) return null;
  return (
    <>{`${KIND_LABEL[latest.kind]} at ${formatSimTime(latest.simTime)}`}</>
  );
}
