"use client";

import { PauseIcon, PlayIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { useClockActions, useClockAnchor, useSimNow } from "@/hooks/use-clock";
import {
  formatSimDate,
  formatSimDateLong,
  formatSimTime,
  simPhase,
} from "@/lib/time/sim";
import { Button, IconButton } from "@/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverLabel,
  PopoverText,
  PopoverTitle,
  PopoverTrigger,
} from "@/ui/popover";
import { Segmented, SegmentedItem } from "@/ui/segmented";

const SPEEDS = ["1", "10", "60"] as const;

const SKIPS = [
  { minutes: 15, label: "+15 min" },
  { minutes: 60, label: "+1 hour" },
  { minutes: 360, label: "+6 hours" },
] as const;

/**
 * The clock is read constantly and changed rarely, so the reading is the
 * control: pause sits next to it, everything else opens from it.
 */
export function Clock() {
  const anchor = useClockAnchor();
  const now = useSimNow();
  const { apply, enabled } = useClockActions();
  const lastSpeed = useRef(1);
  const speed = anchor?.clock.speed ?? 0;

  useEffect(() => {
    if (speed > 0) lastSpeed.current = speed;
  }, [speed]);

  if (!anchor || now === 0) {
    return <span className="text-sm text-ui-soft">Clock unavailable</span>;
  }
  const paused = speed === 0;
  const ownerOnly = "Only the world's owner can change the clock.";

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <IconButton
        label={paused ? "Resume time" : "Pause time"}
        title={enabled ? undefined : ownerOnly}
        tone="accent"
        className="rounded-full"
        disabled={!enabled}
        onClick={() =>
          apply({ action: "set_speed", speed: paused ? lastSpeed.current : 0 })
        }
      >
        {paused ? <PlayIcon aria-hidden /> : <PauseIcon aria-hidden />}
      </IconButton>
      <Popover>
        <PopoverTrigger
          className="flex h-10 min-w-0 items-center gap-2.5 rounded-full bg-ui-surface ps-3 pe-3.5 inset-ring inset-ring-ui-line hover:bg-ui-tint focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ui-primary"
          aria-label={`${formatSimDateLong(now)}, clock options`}
        >
          <time
            className="text-lg font-extrabold text-ui-primary tabular-nums"
            dateTime={new Date(now).toISOString()}
          >
            {formatSimTime(now)}
          </time>
          <span className="flex min-w-0 flex-col text-start leading-[1.15]">
            <span className="text-xs whitespace-nowrap text-ui-soft max-md:hidden">
              {formatSimDate(now)} · {simPhase(now)}
            </span>
            <span
              className="text-xs font-bold text-ui-accent-ink data-paused:text-ui-soft"
              data-paused={paused ? "" : undefined}
            >
              {paused ? "Paused" : `${speed}× speed`}
            </span>
          </span>
        </PopoverTrigger>
        <PopoverContent>
          <PopoverTitle>{formatSimDateLong(now)}</PopoverTitle>
          <PopoverText>
            Simulation time. Everyone in the world lives by this clock.
          </PopoverText>
          <PopoverLabel>Speed</PopoverLabel>
          <Segmented
            aria-label="Simulation speed"
            value={SPEEDS.find((s) => Number(s) === speed) ?? null}
            disabled={!enabled}
            onValueChange={(value) =>
              value && apply({ action: "set_speed", speed: Number(value) })
            }
          >
            {SPEEDS.map((s) => (
              <SegmentedItem key={s} value={s}>
                {`${s}×`}
              </SegmentedItem>
            ))}
          </Segmented>
          <PopoverLabel>Skip ahead</PopoverLabel>
          <div className="flex flex-wrap gap-2">
            {SKIPS.map((skip) => (
              <Button
                key={skip.minutes}
                disabled={!enabled}
                onClick={() =>
                  apply({ action: "advance", minutes: skip.minutes })
                }
              >
                {skip.label}
              </Button>
            ))}
          </div>
          {enabled ? null : <PopoverText>{ownerOnly}</PopoverText>}
        </PopoverContent>
      </Popover>
    </div>
  );
}
