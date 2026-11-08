"use client";

import { useShallow } from "zustand/react/shallow";
import { useLiveStore } from "@/lib/live/state";

export function ActivitySummaryItem() {
  const counts = useLiveStore(
    useShallow((state) => {
      let thinking = 0;
      let composing = 0;
      let queued = 0;
      for (const status of state.statuses.values()) {
        if (status.brain === "thinking") thinking += 1;
        if (status.composingIn.length > 0) composing += 1;
        queued += status.queued;
      }
      return { thinking, composing, queued };
    }),
  );

  return (
    <span className="tabular-nums">
      {`${counts.thinking} thinking · ${counts.composing} composing · ${counts.queued} queued`}
    </span>
  );
}
