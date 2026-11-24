"use client";

import { parseAsString, useQueryStates } from "nuqs";
import { useCast } from "@/hooks/use-characters";
import { useLiveStore } from "@/lib/live/state";
import { statusOf, type Status } from "@/lib/state/grouping";

const SHOWN: readonly Status[] = ["thinking", "composing", "waiting"];

/**
 * How many of the cast are thinking, composing, or have messages waiting: the
 * same counts as Characters grouped by status, which it opens.
 */
export function ActivitySummaryItem() {
  const [{ "chars.show": show }, setParams] = useQueryStates({
    view: parseAsString,
    "chars.by": parseAsString,
    "chars.show": parseAsString,
  });
  const cast = useCast();
  const statuses = useLiveStore((state) => state.statuses);
  const counts = new Map<Status, number>();
  for (const character of cast) {
    const status = statusOf(statuses.get(character.id));
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }

  return (
    <button
      type="button"
      title="Characters by status"
      className="rounded-sm px-1 tabular-nums hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
      onClick={() =>
        void setParams({
          view: "characters",
          "chars.by": "status",
          // The busy are onstage: a list of the offstage would hide them all.
          "chars.show": show === "offstage" ? null : show,
        })
      }
    >
      {SHOWN.map((shown) => `${counts.get(shown) ?? 0} ${shown}`).join(" · ")}
    </button>
  );
}
