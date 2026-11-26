"use client";

import { PauseIcon, PlayIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useCast } from "@/hooks/use-characters";
import { useClockActions, useClockAnchor, useSimNow } from "@/hooks/use-clock";
import { useLiveStore } from "@/lib/live/state";
import {
  formatSimDate,
  formatSimDateLong,
  formatSimTime,
  simPhase,
} from "@/lib/time/sim";
import { Button, IconButton } from "@/ui/button";
import { TaskChip } from "../../entities/task-chip";
import { TimeField } from "@/ui/field";
import {
  Popover,
  PopoverContent,
  PopoverLabel,
  PopoverText,
  PopoverTitle,
  PopoverTrigger,
} from "@/ui/popover";
import { Segmented, SegmentedItem } from "@/ui/segmented";
import { SkipDialog } from "./skip-dialog";
import {
  formatSkip,
  isLargeSkip,
  landingOf,
  minutesTo,
  nextEvent,
  SKIP_PRESETS,
  SPEEDS,
  speedCaution,
  speedLine,
  wakersBetween,
  type Skip,
} from "./skip";

const OWNER_ONLY = "Only the world's owner can change the clock.";

/**
 * The clock is read constantly and changed rarely, so the reading is the
 * control: pause sits next to it, speed and skipping open from it.
 */
export function Clock() {
  const anchor = useClockAnchor();
  const now = useSimNow();
  const { apply, enabled } = useClockActions();
  const lastSpeed = useRef(1);
  const [open, setOpen] = useState(false);
  const [asking, setAsking] = useState<number | null>(null);
  const cast = useCast();
  const statuses = useLiveStore((state) => state.statuses);
  const speed = anchor?.clock.speed ?? 0;

  useEffect(() => {
    if (speed > 0) lastSpeed.current = speed;
  }, [speed]);

  if (!anchor || now === 0) {
    return <span className="text-sm text-ui-soft">Clock unavailable</span>;
  }
  const paused = speed === 0;

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <IconButton
        label={paused ? "Resume time" : "Pause time"}
        title={enabled ? undefined : OWNER_ONLY}
        tone="accent"
        className="rounded-full"
        disabled={!enabled}
        onClick={() =>
          apply({ action: "set_speed", speed: paused ? lastSpeed.current : 0 })
        }
      >
        {paused ? <PlayIcon aria-hidden /> : <PauseIcon aria-hidden />}
      </IconButton>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          className="flex h-10 min-w-0 items-center gap-2.5 rounded-full bg-ui-surface ps-3 pe-3.5 inset-ring inset-ring-ui-line hover:bg-ui-tint focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ui-primary data-open:bg-ui-tint"
          aria-label={`${formatSimDateLong(now)}, ${paused ? "paused" : `${speed}× speed`}. Clock options`}
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
              className="text-xs font-bold whitespace-nowrap text-ui-accent-ink data-paused:text-ui-soft"
              data-paused={paused ? "" : undefined}
            >
              {paused ? "Paused" : `${speed}× speed`}
            </span>
          </span>
        </PopoverTrigger>
        <PopoverContent className="w-[min(23rem,calc(100vw-1.5rem))] gap-3">
          <ClockPanel
            now={now}
            speed={speed}
            enabled={enabled}
            onSpeed={(next) => void apply({ action: "set_speed", speed: next })}
            onSkip={(minutes) => {
              setOpen(false);
              void apply({ action: "advance", minutes });
            }}
            onAskSkip={(landing) => {
              setOpen(false);
              setAsking(landing);
            }}
          />
        </PopoverContent>
      </Popover>
      {asking !== null ? (
        <SkipDialog
          open
          onOpenChange={(openNow) => !openNow && setAsking(null)}
          minutes={minutesTo(asking, now)}
          landing={asking}
          wakers={wakersBetween(cast, statuses, now, asking)}
          onSkip={() =>
            void apply({ action: "advance", minutes: minutesTo(asking, now) })
          }
        />
      ) : null}
    </div>
  );
}

function ClockPanel({
  now,
  speed,
  enabled,
  onSpeed,
  onSkip,
  onAskSkip,
}: {
  now: number;
  speed: number;
  enabled: boolean;
  onSpeed: (speed: number) => void;
  onSkip: (minutes: number) => void;
  onAskSkip: (landing: number) => void;
}) {
  const caution = speedCaution(speed);
  return (
    <>
      <div className="flex flex-col gap-0.5">
        <PopoverTitle>{formatSimDateLong(now)}</PopoverTitle>
        <PopoverText>
          {`${simPhase(now)}. Everyone in the world lives by this clock.`}
        </PopoverText>
      </div>
      <PopoverLabel>Speed</PopoverLabel>
      <Segmented
        aria-label="Simulation speed"
        stretch
        value={
          speed === 0
            ? "0"
            : (SPEEDS.map(String).find((s) => Number(s) === speed) ?? null)
        }
        disabled={!enabled}
        onValueChange={(value) => value && onSpeed(Number(value))}
      >
        <SegmentedItem
          value="0"
          aria-label="Paused"
          className="px-0 [&_svg]:mx-auto [&_svg]:size-4"
        >
          <PauseIcon aria-hidden />
        </SegmentedItem>
        {SPEEDS.map((s) => (
          <SegmentedItem key={s} value={String(s)} className="px-0">
            {`${s}×`}
          </SegmentedItem>
        ))}
      </Segmented>
      <PopoverText>{speedLine(speed)}</PopoverText>
      {caution ? <PopoverText>{caution}</PopoverText> : null}
      {enabled ? (
        <SkipAhead now={now} onSkip={onSkip} onAskSkip={onAskSkip} />
      ) : (
        <PopoverText>{OWNER_ONLY}</PopoverText>
      )}
    </>
  );
}

const DAY_WORDS = ["today", "tomorrow"] as const;

/**
 * Pick how far (a preset, the next time someone's plan ends, or a time of day),
 * see where it lands and who it wakes, then skip. A big skip asks first.
 */
function SkipAhead({
  now,
  onSkip,
  onAskSkip,
}: {
  now: number;
  onSkip: (minutes: number) => void;
  onAskSkip: (landing: number) => void;
}) {
  const cast = useCast();
  const statuses = useLiveStore((state) => state.statuses);
  const [skip, setSkip] = useState<Skip>({ by: "minutes", minutes: 60 });
  const next = nextEvent(cast, statuses, now);
  const landing = landingOf(skip, now, next);
  const minutes = landing === undefined ? 0 : minutesTo(landing, now);
  const wakers =
    landing === undefined ? [] : wakersBetween(cast, statuses, now, landing);
  const preset =
    skip.by === "next"
      ? "next"
      : skip.by === "minutes"
        ? String(skip.minutes)
        : null;
  const day =
    landing === undefined
      ? null
      : DAY_WORDS[
          Math.floor(landing / 86_400_000) - Math.floor(now / 86_400_000)
        ];

  const go = () => {
    if (!minutes || landing === undefined) return;
    if (isLargeSkip(minutes, wakers.length)) onAskSkip(landing);
    else onSkip(minutes);
  };

  return (
    <>
      <PopoverLabel>Skip ahead</PopoverLabel>
      <Segmented
        aria-label="How far to skip"
        stretch
        value={preset}
        onValueChange={(value) => {
          if (!value) return;
          setSkip(
            value === "next"
              ? { by: "next" }
              : { by: "minutes", minutes: Number(value) },
          );
        }}
      >
        {next ? (
          <SegmentedItem value="next" className="px-0">
            Next
          </SegmentedItem>
        ) : null}
        {SKIP_PRESETS.map((one) => (
          <SegmentedItem
            key={one.minutes}
            value={String(one.minutes)}
            className="px-0"
          >
            {one.label}
          </SegmentedItem>
        ))}
      </Segmented>
      <TimeField
        label="Skip to"
        value={landing === undefined ? null : formatSimTime(landing)}
        onValueChange={(time) => time && setSkip({ by: "time", time })}
        after={day ?? "later"}
      />
      <PopoverText>
        {skip.by === "next" && next ? (
          <>
            {`When ${next.name} finishes `}
            <TaskChip type={next.type} actor={next.id} />
            {" and decides what's next."}
            {wakers.length > 1
              ? ` ${wakers.length - 1} more ${wakers.length === 2 ? "wakes" : "wake"} then too.`
              : null}
          </>
        ) : wakers.length === 0 ? (
          "Nobody's plans end before then."
        ) : (
          `${wakers.length === 1 ? "1 person finishes" : `${wakers.length} people finish`} what they're doing and ${wakers.length === 1 ? "decides" : "decide"} what's next.`
        )}
      </PopoverText>
      <Button tone="primary" disabled={!minutes} onClick={go}>
        {minutes ? `Skip ${formatSkip(minutes)}` : "Skip"}
      </Button>
    </>
  );
}
