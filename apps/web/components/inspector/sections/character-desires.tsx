"use client";

import { ArrowDownRightIcon, ArrowUpRightIcon, PauseIcon } from "lucide-react";
import type {
  DesireDefinition,
  DesireRecord,
  DesiresConfig,
} from "@kazusa/client";
import { Fact } from "@/components/entities/fact";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useCharacter, useCharacterStatus } from "@/hooks/use-characters";
import { useSimNow } from "@/hooks/use-clock";
import { useDesireConfig, useDesireRecord } from "@/hooks/use-desires";
import type { EntityRef } from "@/lib/state/entity-ref";
import { setSectionOpen, useSectionOpen } from "@/lib/state/preferences-store";
import {
  desireLabel,
  dropOf,
  isNotable,
  levelAt,
  stateIndex,
  trendOf,
  type DesireTrend,
} from "@/lib/time/desires";
import { formatSimDuration, formatSimTime } from "@/lib/time/sim";
import { cn } from "@/lib/utils";

/**
 * How the character feels, as the brain reads it, kept quiet: only desires
 * below the state everyone starts in, or ones the current task is moving, get a
 * row. The rest are one "Show all" away (remembered for every character). When
 * each will change is in the row's hover, not on screen.
 */
export function CharacterDesiresSection({ entity }: { entity: EntityRef }) {
  const character = useCharacter(entity.id);
  const isAgent = character?.kind === "agent";
  const config = useDesireConfig();
  const record = useDesireRecord(isAgent ? entity.id : undefined);
  const status = useCharacterStatus(isAgent ? entity.id : undefined);
  const now = useSimNow();
  const showAll = useSectionOpen(SHOW_ALL, false);
  // Offstage, their body waits: levels stand where they were when they left.
  const offstage = status?.onstage === false;

  if (!isAgent) {
    return (
      <p className="text-sm text-muted-foreground">
        Only simulated characters have desires.
      </p>
    );
  }
  if (!config || now <= 0) {
    return (
      <div className="flex flex-col gap-2" aria-hidden>
        {Array.from({ length: 2 }).map((_, index) => (
          <Skeleton key={index} className="h-4" />
        ))}
      </div>
    );
  }

  const at = Math.max(
    offstage ? (status.offstageSince ?? now) : now,
    record?.anchorAt ?? 0,
  );
  const notable = config.catalog.filter((desire) =>
    isNotable(config, record, desire, at, offstage),
  );
  const shown = showAll ? config.catalog : notable;
  const hidden = config.catalog.length - notable.length;

  return (
    <div className="flex flex-col gap-2">
      {offstage ? <Fact icon={PauseIcon}>Paused while offstage</Fact> : null}
      {shown.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {shown.map((desire) => (
            <DesireRow
              key={desire.name}
              config={config}
              record={record}
              desire={desire}
              at={at}
              paused={offstage}
            />
          ))}
        </ul>
      ) : null}
      <div className="flex items-center justify-between gap-2">
        {notable.length === 0 && !showAll ? (
          <p className="text-sm text-muted-foreground">{`Nothing pressing. All ${config.initial} or better.`}</p>
        ) : (
          <span />
        )}
        {hidden > 0 ? (
          <Button
            variant="ghost"
            size="xs"
            className="-mr-2 shrink-0 text-muted-foreground aria-expanded:bg-transparent aria-expanded:text-muted-foreground aria-expanded:hover:bg-muted"
            aria-expanded={showAll}
            onClick={() => setSectionOpen(SHOW_ALL, !showAll)}
          >
            {showAll
              ? "Show less"
              : notable.length
                ? `${hidden} more`
                : `Show all ${config.catalog.length}`}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/** The viewer's choice to see every desire, kept with the inspector folds. */
const SHOW_ALL = "character.desires.all";

function DesireRow({
  config,
  record,
  desire,
  at,
  paused,
}: {
  config: DesiresConfig;
  record: DesireRecord | undefined;
  desire: DesireDefinition;
  at: number;
  /** Offstage: nothing is moving, whatever the task planned. */
  paused: boolean;
}) {
  const level = levelAt(config, record, desire, at);
  const index = stateIndex(config, level);
  const state = config.states[index]?.name ?? "";
  const initialIndex = Math.max(
    0,
    config.states.findIndex(({ name }) => name === config.initial),
  );
  const trend = paused ? undefined : trendOf(config, record, desire, at);
  const drop = paused || trend ? undefined : dropOf(config, record, desire, at);
  const label = desireLabel(desire.name);
  const TrendIcon =
    trend?.direction === "down" ? ArrowDownRightIcon : ArrowUpRightIcon;
  const when = trend
    ? `${trend.direction === "up" ? "Rising" : "Falling"} to ${trend.targetState} by ${formatSimTime(trend.reachesAt)}`
    : drop
      ? `Turns ${drop.state} in ${formatSimDuration(drop.at - at)}`
      : undefined;

  return (
    <li className="flex items-center gap-3">
      <Tooltip>
        <TooltipTrigger
          render={<span />}
          className="w-22 shrink-0 cursor-default truncate text-sm"
        >
          {label}
        </TooltipTrigger>
        <TooltipContent className="flex max-w-64 flex-col gap-1">
          <span>{desire.description}</span>
          {when ? (
            <span className="font-mono text-[11px] tabular-nums opacity-80">
              {when}
            </span>
          ) : null}
        </TooltipContent>
      </Tooltip>
      <Meter
        config={config}
        level={level}
        trend={trend}
        label={label}
        state={state}
        pressing={index === 0}
      />
      <span
        className={cn(
          "flex w-18 shrink-0 items-center justify-end gap-1 font-mono text-xs",
          index === 0
            ? "font-medium text-foreground"
            : index < initialIndex
              ? "text-foreground"
              : "text-muted-foreground",
        )}
      >
        {trend ? (
          <TrendIcon aria-hidden className="size-3 shrink-0 text-primary" />
        ) : null}
        {state}
      </span>
    </li>
  );
}

function Meter({
  config,
  level,
  trend,
  label,
  state,
  pressing,
}: {
  config: DesiresConfig;
  level: number;
  trend: DesireTrend | undefined;
  label: string;
  state: string;
  pressing: boolean;
}) {
  const fill = trend
    ? "bg-primary"
    : pressing
      ? "bg-foreground"
      : "bg-muted-foreground";
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(level)}
      aria-valuetext={
        trend ? `${state}, moving to ${trend.targetState}` : state
      }
      className="relative flex min-w-0 flex-1 gap-0.5"
    >
      {config.states.map((segment, index) => {
        const low = segment.min;
        const high = config.states[index + 1]?.min ?? 100;
        const share = Math.min(
          1,
          Math.max(0, (level - low) / Math.max(high - low, 1)),
        );
        return (
          <div
            key={segment.name}
            className="h-1.5 basis-0 overflow-hidden rounded-[2px] bg-muted"
            style={{ flexGrow: Math.max(high - low, 1) }}
          >
            <div
              className={cn("h-full transition-[width] duration-700", fill)}
              style={{ width: `${share * 100}%` }}
            />
          </div>
        );
      })}
      {trend ? (
        <span
          aria-hidden
          className="absolute -inset-y-1 w-0.5 rounded-full bg-primary"
          style={{ left: `calc(${trend.target}% - 1px)` }}
        />
      ) : null}
    </div>
  );
}
