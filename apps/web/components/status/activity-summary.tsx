"use client";

import { parseAsString, useQueryStates } from "nuqs";
import { useShallow } from "zustand/react/shallow";
import { useLiveStore } from "@/lib/live/state";

/**
 * How busy the world is right now, only the parts that aren't zero. Opens
 * Characters showing who is busy.
 */
export function ActivitySummaryItem() {
  const [, setParams] = useQueryStates({
    view: parseAsString,
    "chars.show": parseAsString,
  });
  const counts = useLiveStore(
    useShallow((state) => {
      let thinking = 0;
      let writing = 0;
      let waiting = 0;
      for (const status of state.statuses.values()) {
        if (status.brain === "thinking") thinking += 1;
        if (status.composingIn.length > 0) writing += 1;
        waiting += status.queued;
      }
      return { thinking, writing, waiting };
    }),
  );
  const parts = [
    counts.thinking ? `${counts.thinking} thinking` : null,
    counts.writing ? `${counts.writing} writing` : null,
    counts.waiting
      ? `${counts.waiting} ${counts.waiting === 1 ? "message" : "messages"} waiting`
      : null,
  ].filter(Boolean);

  return (
    <button
      type="button"
      title="Show who's busy"
      className="rounded-sm px-1 tabular-nums hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
      onClick={() =>
        void setParams({
          view: "characters",
          "chars.show": "busy",
        })
      }
    >
      {parts.length ? parts.join(" · ") : "All quiet"}
    </button>
  );
}
