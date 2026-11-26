"use client";

import type { CharacterSummary } from "@kazusa/client";
import { useMemo, useState } from "react";
import { useSimNow } from "@/hooks/use-clock";
import { useTimeline } from "@/hooks/use-timeline";
import { firstName, formatDayLabel } from "@/lib/format";
import {
  buildChronicle,
  kindsForPreset,
  type TimelinePreset,
} from "@/lib/timeline/chronicle";
import { Button } from "@/ui/button";
import { Note } from "@/ui/note";
import { Segmented, SegmentedItem } from "@/ui/segmented";
import { Chronicle, ChronicleDay, ChroniclePhase } from "@/ui/timeline";
import { BurstRow, EventRow } from "../timeline/event-row";
import { PHASE_ICON } from "../timeline/timeline-stage";

/**
 * What has happened to them, newest first: the Timeline narrowed to one person,
 * starting from the moments that mattered.
 */
export function StoryTab({ character }: { character: CharacterSummary }) {
  const [preset, setPreset] = useState<TimelinePreset>("highlights");
  const filters = useMemo(
    () => ({ actors: [character.id], kinds: kindsForPreset(preset) }),
    [character.id, preset],
  );
  const timeline = useTimeline(filters);
  const now = useSimNow();
  const rows = useMemo(
    () => buildChronicle(timeline.events),
    [timeline.events],
  );
  const called = firstName(character.name);

  return (
    <div className="flex flex-col gap-4">
      <Segmented<TimelinePreset>
        aria-label="Detail level"
        className="self-start"
        value={preset}
        onValueChange={(next) => next && setPreset(next)}
      >
        <SegmentedItem value="highlights">Highlights</SegmentedItem>
        <SegmentedItem value="activity">Activity</SegmentedItem>
        <SegmentedItem value="everything">Everything</SegmentedItem>
      </Segmented>
      {timeline.isLoading ? (
        <Note>{`Reading ${called}'s story…`}</Note>
      ) : timeline.error ? (
        <Note>{"Couldn't read their story."}</Note>
      ) : rows.length === 0 ? (
        <Note>
          {preset === "highlights"
            ? `Nothing stands out for ${called} yet. Activity shows the everyday.`
            : `Nothing has happened to ${called} yet.`}
        </Note>
      ) : (
        <>
          <Chronicle label={`${called}'s story`} busy={timeline.isLoadingMore}>
            {rows.map((row) => {
              if (row.type === "day")
                return (
                  <ChronicleDay
                    key={row.key}
                    id={`story-day-${row.start}`}
                    label={formatDayLabel(row.start, now)}
                  />
                );
              if (row.type === "phase")
                return (
                  <ChroniclePhase
                    key={row.key}
                    icon={PHASE_ICON[row.phase]}
                    label={row.phase}
                  />
                );
              if (row.type === "burst")
                return (
                  <BurstRow
                    key={row.key}
                    category={row.category}
                    label={row.label}
                    chatId={row.chatId}
                    events={row.events}
                  />
                );
              return <EventRow key={row.key} event={row.event} />;
            })}
          </Chronicle>
          <footer className="flex justify-center">
            {timeline.hasMore ? (
              <Button
                tone="soft"
                size="sm"
                pending={timeline.isLoadingMore}
                onClick={() => void timeline.loadMore()}
              >
                Earlier
              </Button>
            ) : (
              <p className="text-xs font-semibold text-ui-soft">
                {`The start of ${called}'s story`}
              </p>
            )}
          </footer>
        </>
      )}
    </div>
  );
}
