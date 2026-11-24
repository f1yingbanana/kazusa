"use client";

import {
  SegmentedControl,
  SegmentedControlIndicator,
  SegmentedControlItem,
} from "@ui-sdk/react/segmented-control";
import {
  Timeline,
  TimelineConnector,
  TimelineDescription,
  TimelineItem,
  TimelineMarker,
  TimelineTime,
  TimelineTitle,
} from "@ui-sdk/react/timeline";
import { useState } from "react";
import { characterById, type EventKind, eventKinds, events } from "./data";
import { Portrait } from "./portrait";

const kindLabel: Record<EventKind, string> = {
  move: "Moved",
  talk: "Said",
  thought: "Thought",
  plan: "Planned",
};

export function TimelineTab() {
  const [kind, setKind] = useState<EventKind | "all">("all");
  const shown = kind === "all" ? events : events.filter((e) => e.kind === kind);

  return (
    <div className="lab-story">
      <div className="lab-story-head">
        <h2 className="lab-story-title">Today in Shirasagi</h2>
        <SegmentedControl
          aria-label="Show events"
          className="lab-seg"
          value={kind}
          onValueChange={(value) => value && setKind(value as EventKind | "all")}
        >
          <SegmentedControlIndicator />
          {eventKinds.map((k) => (
            <SegmentedControlItem key={k.value} value={k.value}>
              {k.label}
            </SegmentedControlItem>
          ))}
        </SegmentedControl>
      </div>

      {shown.length === 0 ? (
        <p className="lab-empty">Nothing like that has happened yet today.</p>
      ) : (
        <Timeline aria-label="Today's events" className="lab-timeline">
          {shown.map((event) => {
            const who = characterById[event.who];
            return (
              <TimelineItem key={event.id} status={event.status} data-kind={event.kind}>
                <TimelineMarker>
                  <Portrait character={who} size="sm" decorative />
                </TimelineMarker>
                <TimelineConnector />
                <div className="lab-event-meta">
                  <span className="lab-event-kind">{kindLabel[event.kind]}</span>
                  <TimelineTime dateTime={event.dateTime}>{event.time}</TimelineTime>
                </div>
                <TimelineTitle>{event.title}</TimelineTitle>
                <TimelineDescription>{event.detail}</TimelineDescription>
              </TimelineItem>
            );
          })}
        </Timeline>
      )}
    </div>
  );
}
