"use client";

import type {
  DesireDefinition,
  DesireRecord,
  DesiresConfig,
} from "@kazusa/client";
import { ArrowDownIcon, ArrowUpIcon, PauseIcon } from "lucide-react";
import type { CSSProperties } from "react";
import { useSimNow } from "@/hooks/use-clock";
import { useDesireConfig, useDesireRecord } from "@/hooks/use-desires";
import { setSectionOpen, useSectionOpen } from "@/lib/state/preferences-store";
import {
  desireLabel,
  dropOf,
  isNotable,
  levelAt,
  stateIndex,
  trendOf,
} from "@/lib/time/desires";
import { formatSimDuration, formatSimTime } from "@/lib/time/sim";
import { Button } from "@/ui/button";
import { cx } from "@/ui/cx";
import { Gauge } from "@/ui/meter";
import { Tooltip } from "@/ui/tooltip";
import { usePresence } from "./presence";

const QUIET_TILES = 4;
const SHOW_ALL = "character.desires.all";
const GRID = "grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-2";

/**
 * How they feel, as tiles: the ones that stand out (low, or being moved by what
 * they're doing) first, the rest one press away. A tile's tooltip says what the
 * desire is and when it next changes.
 */
export function Desires({ id }: { id: string }) {
  const config = useDesireConfig();
  const record = useDesireRecord(id);
  const { status } = usePresence({ id, kind: "agent" });
  const now = useSimNow();
  const showAll = useSectionOpen(SHOW_ALL, false);
  const offstage = status?.onstage === false;

  if (!config || now <= 0) {
    return (
      <section aria-label="How they feel" aria-busy="true">
        <ul className={GRID} aria-hidden="true">
          {[0, 1].map((n) => (
            <li
              key={n}
              className="h-13 rounded-[0.875rem] bg-ui-tint motion-safe:animate-ui-pulse"
            />
          ))}
        </ul>
      </section>
    );
  }

  // Offstage, their body waits: levels stand where they were when they left.
  const at = Math.max(
    offstage ? (status.offstageSince ?? now) : now,
    record?.anchorAt ?? 0,
  );
  const notable = config.catalog.filter((d) =>
    isNotable(config, record, d, at, offstage),
  );
  const lead = notable.length
    ? notable
    : config.catalog
        .toSorted(
          (a, b) =>
            levelAt(config, record, a, at) - levelAt(config, record, b, at),
        )
        .slice(0, QUIET_TILES);
  const shown = showAll ? config.catalog : lead;
  const hidden = config.catalog.length - lead.length;

  return (
    <section
      className="flex flex-col gap-2.5 text-sm"
      aria-labelledby={`desires-${id}`}
    >
      <div className="flex items-center gap-2">
        <h3
          id={`desires-${id}`}
          className="text-[0.8125rem] font-extrabold text-ui-soft"
        >
          How they feel
        </h3>
        {offstage ? (
          <Tooltip label="Desires stop changing while a character is offstage.">
            <span
              tabIndex={0}
              className="inline-flex items-center gap-1 rounded-full bg-ui-tint px-2 py-px text-xs font-bold text-ui-soft outline-none focus-visible:outline-2 focus-visible:outline-ui-primary"
            >
              <PauseIcon aria-hidden className="size-3" />
              Paused
            </span>
          </Tooltip>
        ) : null}
        {hidden > 0 ? (
          <Button
            tone="link"
            size="sm"
            className="ms-auto"
            aria-expanded={showAll}
            onClick={() => setSectionOpen(SHOW_ALL, !showAll)}
          >
            {showAll ? "Fewer" : `All ${config.catalog.length}`}
          </Button>
        ) : null}
      </div>
      <ul className={GRID}>
        {shown.map((desire, index) => (
          <DesireTile
            key={desire.name}
            config={config}
            record={record}
            desire={desire}
            at={at}
            paused={offstage}
            order={index}
          />
        ))}
      </ul>
    </section>
  );
}

function DesireTile({
  config,
  record,
  desire,
  at,
  paused,
  order,
}: {
  config: DesiresConfig;
  record: DesireRecord | undefined;
  desire: DesireDefinition;
  at: number;
  paused: boolean;
  order: number;
}) {
  const level = levelAt(config, record, desire, at);
  const index = stateIndex(config, level);
  const state = config.states[index]?.name ?? "";
  const initial = Math.max(
    0,
    config.states.findIndex(({ name }) => name === config.initial),
  );
  const trend = paused ? undefined : trendOf(config, record, desire, at);
  const drop = paused || trend ? undefined : dropOf(config, record, desire, at);
  const tone = index === 0 ? "pressing" : index < initial ? "low" : "fine";
  const when = trend
    ? `${trend.direction === "up" ? "Rising" : "Falling"} to ${trend.targetState} by ${formatSimTime(trend.reachesAt)}`
    : drop
      ? `Turns ${drop.state} in ${formatSimDuration(drop.at - at)}`
      : paused
        ? "Holding while offstage"
        : undefined;
  const TrendIcon = trend?.direction === "down" ? ArrowDownIcon : ArrowUpIcon;

  return (
    <li
      className="[animation-delay:calc(var(--i)*40ms)] motion-safe:animate-ui-enter"
      style={{ "--i": order } as CSSProperties}
    >
      <Tooltip
        label={
          <span className="flex flex-col gap-0.5">
            <span>{desire.description}</span>
            {when ? (
              <span className="font-semibold opacity-75">{when}</span>
            ) : null}
          </span>
        }
      >
        <div
          tabIndex={0}
          className={cx(
            "block rounded-[0.875rem] px-2.5 pt-2 pb-2.5 inset-ring inset-ring-ui-line outline-none transition-shadow duration-150 focus-visible:outline-2 focus-visible:outline-ui-primary",
            tone === "pressing"
              ? "bg-ui-accent-tint inset-ring-[color-mix(in_oklch,var(--ui-accent),transparent_55%)] hover:inset-ring-ui-accent-ink"
              : cx(
                  "bg-ui-surface",
                  tone === "low"
                    ? "hover:inset-ring-ui-accent"
                    : "hover:inset-ring-ui-primary",
                ),
          )}
        >
          <Gauge
            label={desireLabel(desire.name)}
            value={level}
            tone={tone}
            reading={
              <>
                {trend ? <TrendIcon /> : null}
                {state}
              </>
            }
            readingText={
              trend ? `${state}, moving to ${trend.targetState}` : state
            }
            notches={config.states.slice(1).map((s) => s.min)}
            heading={
              trend
                ? { to: trend.target, rising: trend.direction === "up" }
                : undefined
            }
          />
        </div>
      </Tooltip>
    </li>
  );
}
