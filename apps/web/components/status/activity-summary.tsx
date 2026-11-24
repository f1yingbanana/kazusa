"use client";

import { parseAsString, useQueryStates } from "nuqs";
import { useCast } from "@/hooks/use-characters";
import { useLiveStore } from "@/lib/live/state";
import { activityOf, type Activity } from "@/lib/state/grouping";

const SHOWN: readonly Activity[] = ["thinking", "composing", "waiting"];

/**
 * How many of the cast are thinking, composing, or have messages waiting: the
 * same counts as Characters grouped by activity, which it opens.
 */
export function ActivitySummaryItem() {
  const [, setParams] = useQueryStates({
    view: parseAsString,
    "chars.by": parseAsString,
  });
  const cast = useCast();
  const statuses = useLiveStore((state) => state.statuses);
  const counts = new Map<Activity, number>();
  for (const character of cast) {
    const activity = activityOf(statuses.get(character.id));
    counts.set(activity, (counts.get(activity) ?? 0) + 1);
  }

  return (
    <button
      type="button"
      title="Characters by activity"
      className="rounded-sm px-1 tabular-nums hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
      onClick={() =>
        void setParams({ view: "characters", "chars.by": "activity" })
      }
    >
      {SHOWN.map((activity) => `${counts.get(activity) ?? 0} ${activity}`).join(
        " · ",
      )}
    </button>
  );
}
