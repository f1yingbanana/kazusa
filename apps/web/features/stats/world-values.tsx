"use client";

import {
  statValue,
  statWord,
  type StatDefinition,
  type StatsResponse,
} from "@kazusa/client";
import { GlobeIcon } from "lucide-react";
import { useStats } from "@/hooks/use-stats";
import { Fold } from "@/ui/fold";
import {
  Popover,
  PopoverContent,
  PopoverText,
  PopoverTitle,
  PopoverTrigger,
} from "@/ui/popover";
import { StatControl, statLabel, statProvenance } from "./stat-control";

function worldStats(data: StatsResponse | undefined): StatDefinition[] {
  return data?.catalog.filter((stat) => stat.on === "world") ?? [];
}

function Rows() {
  const { data, canManage, set } = useStats();
  const world = worldStats(data);
  if (!data) return null;
  return (
    <ul className="flex flex-col gap-2.5">
      {world.map((stat) => {
        const entry = data.world[stat.name];
        const label = statLabel(stat.name);
        return (
          <li
            key={stat.name}
            className="flex min-h-8 items-center justify-between gap-3"
          >
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-bold">{label}</span>
              <span className="truncate text-xs text-ui-soft">
                {statProvenance(entry)}
              </span>
            </div>
            <StatControl
              stat={stat}
              entry={entry}
              label={label}
              onSet={
                canManage
                  ? (value) => set({ name: stat.name, value })
                  : undefined
              }
            />
          </li>
        );
      })}
    </ul>
  );
}

const ABOUT =
  "What is true for everyone right now. Characters read these each turn.";

/**
 * The world's own states beside the clock: what is true of the world right now,
 * like the time. The first reads in the bar; the rest, and what changes them,
 * open from it. Nothing while the world defines none.
 */
export function WorldValues() {
  const { data } = useStats();
  const world = worldStats(data);
  const [first] = world;
  if (!data || !first) return null;
  const more = world.length - 1;
  return (
    <Popover>
      <PopoverTrigger
        aria-label="The world's states"
        className="inline-flex h-10 max-w-56 min-w-0 items-center gap-1.5 rounded-full px-3 text-sm text-ui-soft hover:bg-ui-tint hover:text-ui-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ui-primary data-open:bg-ui-tint"
      >
        <span>{statLabel(first.name)}</span>
        <span className="truncate font-bold text-ui-ink">
          {statWord(first, statValue(first, data.world[first.name]))}
        </span>
        {more > 0 ? (
          <span className="text-xs font-bold tabular-nums">+{more}</span>
        ) : null}
      </PopoverTrigger>
      <PopoverContent className="w-[min(22rem,calc(100vw-2rem))]">
        <div className="flex flex-col gap-0.5">
          <PopoverTitle>The world</PopoverTitle>
          <PopoverText>{ABOUT}</PopoverText>
        </div>
        <div className="max-h-[60dvh] overflow-y-auto">
          <Rows />
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** The same states as a fold, for the phone's More sheet. */
export function WorldValuesFold() {
  const { data } = useStats();
  const world = worldStats(data);
  const [first] = world;
  if (!data || !first) return null;
  return (
    <Fold
      value="world"
      title="The world"
      summary={statWord(first, statValue(first, data.world[first.name]))}
      icon={<GlobeIcon />}
    >
      <p className="pb-2 text-xs text-ui-soft">{ABOUT}</p>
      <Rows />
    </Fold>
  );
}
