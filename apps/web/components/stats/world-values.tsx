"use client";

import { statValue, statWord } from "@kazusa/client";
import {
  StatControl,
  statLabel,
  statProvenance,
} from "@/components/stats/stat-control";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useStats } from "@/hooks/use-stats";

/**
 * The world's own states beside the clock: what is true of the world right now,
 * like the time. The first one reads in the bar; the rest, and the controls
 * that change them, are a click away. Nothing while the world defines none.
 */
export function WorldValues() {
  const { data, canManage, set } = useStats();
  const world = data?.catalog.filter((stat) => stat.on === "world") ?? [];
  const [first] = world;
  if (!data || !first) return null;
  const more = world.length - 1;

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className="max-w-56 gap-1.5 font-normal"
            aria-label="The world's states"
          />
        }
      >
        <span className="hidden text-muted-foreground sm:inline">
          {statLabel(first.name)}
        </span>
        <span className="truncate font-medium">
          {statWord(first, statValue(first, data.world[first.name]))}
        </span>
        {more > 0 ? (
          <span className="font-mono text-xs text-muted-foreground tabular-nums">
            +{more}
          </span>
        ) : null}
      </PopoverTrigger>
      <PopoverContent className="w-80">
        <PopoverHeader>
          <PopoverTitle>The world</PopoverTitle>
          <PopoverDescription>
            {canManage
              ? "What is true for everyone right now. Characters read these each turn."
              : "What is true for everyone right now."}
          </PopoverDescription>
        </PopoverHeader>
        <ul className="flex flex-col gap-2">
          {world.map((stat) => {
            const entry = data.world[stat.name];
            const label = statLabel(stat.name);
            return (
              <li
                key={stat.name}
                className="flex min-h-7 items-center justify-between gap-3"
              >
                <div className="flex min-w-0 flex-col">
                  <span className="truncate">{label}</span>
                  <span className="truncate text-xs text-muted-foreground">
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
      </PopoverContent>
    </Popover>
  );
}
