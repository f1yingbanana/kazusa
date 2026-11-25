"use client";

import {
  Meter,
  MeterIndicator,
  MeterLabel,
  MeterTrack,
} from "@ui-sdk/react/meter";
import type { ReactNode } from "react";
import { cx } from "./cx";

/**
 * A level on a pill-shaped track, 0 to 100: notches mark where its reading
 * changes, and a striped ghost shows where it's heading. `tone` colours the
 * fill: `fine`, `low` (the accent) or `pressing` (the accent's ink).
 */
export function Gauge({
  label,
  value,
  reading,
  readingText,
  tone = "fine",
  notches = [],
  heading,
}: {
  label: ReactNode;
  value: number;
  /** Shown beside the label, like "hungry". */
  reading?: ReactNode;
  /** What a screen reader hears for the value. */
  readingText: string;
  tone?: "fine" | "low" | "pressing";
  /** Where the reading changes, 0 to 100. */
  notches?: readonly number[];
  /** Where it's moving to, and whether it's rising. */
  heading?: { readonly to: number; readonly rising: boolean };
}) {
  const ghost = heading
    ? { from: Math.min(value, heading.to), span: Math.abs(heading.to - value) }
    : undefined;
  return (
    <Meter
      value={value}
      getValueLabel={() => readingText}
      data-tone={tone}
      className="group/gauge flex flex-col gap-1.5 [--tone:var(--ui-primary)] data-[tone=low]:[--tone:var(--ui-accent)] data-[tone=pressing]:[--tone:var(--ui-accent-ink)]"
    >
      <span className="flex min-w-0 items-baseline justify-between gap-2">
        <MeterLabel className="truncate text-[0.8125rem] font-extrabold">
          {label}
        </MeterLabel>
        {reading ? (
          <span
            aria-hidden="true"
            className="inline-flex shrink-0 items-center gap-0.5 text-xs font-bold text-ui-soft lowercase group-data-[tone=low]/gauge:text-ui-accent-ink group-data-[tone=pressing]/gauge:text-ui-accent-ink [&_svg]:size-3"
          >
            {reading}
          </span>
        ) : null}
      </span>
      <MeterTrack className="relative block h-2 overflow-hidden rounded-full bg-ui-tint">
        {ghost ? (
          <span
            aria-hidden="true"
            className={cx(
              "absolute inset-y-0 rounded-full bg-[repeating-linear-gradient(-45deg,color-mix(in_oklch,var(--tone),transparent_55%)_0_3px,transparent_3px_6px)]",
              heading?.rising && "motion-safe:animate-ui-drift",
            )}
            style={{
              insetInlineStart: `${ghost.from}%`,
              width: `${ghost.span}%`,
            }}
          />
        ) : null}
        <MeterIndicator className="absolute inset-y-0 inset-s-0 rounded-full bg-(--tone) transition-[width] duration-600 ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:transition-none" />
        {notches.map((at) => (
          <span
            key={at}
            aria-hidden="true"
            className="absolute inset-y-0 -ms-px w-0.5 bg-ui-surface opacity-85"
            style={{ insetInlineStart: `${at}%` }}
          />
        ))}
      </MeterTrack>
    </Meter>
  );
}
