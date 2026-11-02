"use client";

import { useState } from "react";
import { LoaderCircleIcon } from "lucide-react";
import { BrainCallTrace } from "@/components/entities/brain-call";
import { Button } from "@/components/ui/button";
import { Trace, TraceIcon, TraceLine, TraceTitle } from "@/components/ui/trace";
import type { BrainActivity } from "@/lib/source/brain/activity";

/** A long job can make hundreds of calls; the chat should stay readable. */
const SHOWN_CALLS = 6;

/** What the system admin did between two messages, as the brain view shows it. */
export function BrainActivityRows({
  activity,
  running,
}: {
  activity: BrainActivity;
  running: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const hidden = expanded ? 0 : activity.calls.length - SHOWN_CALLS;
  const calls = hidden > 0 ? activity.calls.slice(hidden) : activity.calls;
  return (
    <div className="flex flex-col gap-1 pl-10">
      {hidden > 0 ? (
        <Button
          variant="link"
          size="xs"
          className="h-auto w-fit px-0"
          onClick={() => setExpanded(true)}
        >
          {`Show ${hidden} earlier model ${hidden === 1 ? "call" : "calls"}`}
        </Button>
      ) : null}
      <Trace>
        {calls.map((call) => (
          <BrainCallTrace
            key={call.id}
            call={call}
            running={running}
            thoughtsOpen
          />
        ))}
      </Trace>
    </div>
  );
}

/** The system admin is working: often for a long time before saying anything. */
export function BrainThinking() {
  return (
    <div className="pl-10">
      <Trace>
        <TraceLine status="running">
          <TraceIcon>
            <LoaderCircleIcon className="animate-spin" />
          </TraceIcon>
          <TraceTitle>Thinking</TraceTitle>
        </TraceLine>
      </Trace>
    </div>
  );
}
