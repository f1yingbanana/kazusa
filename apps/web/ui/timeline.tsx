"use client";

import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "@ui-sdk/react/collapsible";
import {
  Timeline,
  TimelineConnector,
  TimelineDescription,
  TimelineItem,
  TimelineMarker,
  TimelineTime,
  TimelineTitle,
} from "@ui-sdk/react/timeline";
import { ChevronRightIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cx } from "./cx";

export { createTimelineController } from "@ui-sdk/react/timeline";

export type ChronicleTone = "neutral" | "primary" | "accent";
export type ChronicleVariant = "quiet" | "card";

const MARKER_TONE: Record<ChronicleTone, string> = {
  neutral: "bg-ui-tint text-ui-soft",
  primary: "bg-ui-tint text-ui-primary",
  accent: "bg-ui-accent-tint text-ui-accent-ink",
};

const CARD_SURFACE: Record<ChronicleTone, string> = {
  neutral: "bg-ui-tint/55",
  primary: "bg-ui-tint/65",
  accent: "bg-ui-accent-tint/55",
};

export function Chronicle({
  label,
  busy = false,
  className,
  children,
  ...props
}: {
  label: string;
  busy?: boolean;
  className?: string;
  children?: ReactNode;
} & Omit<
  React.ComponentProps<typeof Timeline>,
  "aria-label" | "feed" | "busy" | "className" | "children"
>) {
  return (
    <Timeline
      feed
      busy={busy}
      aria-label={label}
      className={cx("flex flex-col", className)}
      {...props}
    >
      {children}
    </Timeline>
  );
}

export function ChronicleDay({
  label,
  meta,
  id,
}: {
  label: string;
  meta?: ReactNode;
  id?: string;
}) {
  return (
    <div
      id={id}
      data-chronicle-day
      className="sticky top-0 z-10 flex items-center gap-3 bg-[color-mix(in_oklch,var(--ui-surface),transparent_8%)] px-5 py-2.5 backdrop-blur-xs max-md:px-3.5"
    >
      <h3 className="shrink-0 text-xs font-extrabold tracking-wide text-ui-ink uppercase">
        {label}
      </h3>
      <span aria-hidden="true" className="h-px flex-1 bg-ui-line" />
      {meta ? (
        <span className="shrink-0 text-xs font-semibold text-ui-soft tabular-nums">
          {meta}
        </span>
      ) : null}
    </div>
  );
}

export function ChroniclePhase({
  icon,
  label,
}: {
  icon: ReactNode;
  label: string;
}) {
  return (
    <div
      role="presentation"
      data-chronicle-phase=""
      className="flex items-center gap-3 px-5 pt-4 pb-1.5 text-xs font-bold text-ui-soft max-md:px-3.5"
    >
      <span className="w-10 shrink-0" />
      <span className="grid w-6 shrink-0 place-items-center text-ui-soft [&_svg]:size-3.5">
        {icon}
      </span>
      <span>{label}</span>
    </div>
  );
}

const SPINE_TOP =
  "mb-1 h-2 w-0.5 shrink-0 rounded-full bg-ui-line group-data-first/item:invisible [[data-chronicle-phase]+_&]:invisible [[data-chronicle-day]+_&]:invisible";

const SPINE_BOTTOM =
  "mt-1 w-0.5 flex-1 rounded-full bg-ui-line group-data-last/item:invisible";

export function ChronicleEntry({
  value,
  time,
  dateTime,
  icon,
  tone = "neutral",
  variant = "quiet",
  live = false,
  enter = false,
  title,
  meta,
  description,
  trailing,
  className,
}: {
  value: string;
  time: string;
  dateTime?: string;
  icon: ReactNode;
  tone?: ChronicleTone;
  variant?: ChronicleVariant;
  live?: boolean;
  enter?: boolean;
  title: ReactNode;
  /** Quiet context (place, duration) separated from the primary line. */
  meta?: ReactNode;
  description?: ReactNode;
  trailing?: ReactNode;
  className?: string;
}) {
  const card = variant === "card";
  return (
    <TimelineItem
      value={value}
      className={cx(
        "group/item relative flex items-stretch gap-3 rounded-[1rem] px-5 py-0 outline-none focus-visible:inset-ring-2 focus-visible:inset-ring-ui-primary max-md:px-3.5",
        enter && "motion-safe:animate-ui-enter",
        className,
      )}
    >
      <TimelineTime
        dateTime={dateTime}
        className="mt-3 flex h-6 w-10 shrink-0 items-center justify-end text-xs font-semibold text-ui-soft tabular-nums"
      >
        {time}
      </TimelineTime>

      <div className="relative flex w-6 shrink-0 flex-col items-center">
        <span aria-hidden="true" className={SPINE_TOP} />
        <TimelineMarker
          className={cx(
            "relative z-1 grid size-6 shrink-0 place-items-center rounded-full inset-ring inset-ring-ui-surface [&_svg]:size-3.5",
            card ? MARKER_TONE[tone] : "bg-ui-surface text-ui-soft",
          )}
        >
          {icon}
          {live ? (
            <span
              aria-hidden="true"
              className="absolute -inset-0.5 rounded-full border border-ui-accent opacity-60 motion-safe:animate-ui-ping"
            />
          ) : null}
        </TimelineMarker>
        <TimelineConnector className={SPINE_BOTTOM} />
      </div>

      <div
        className={cx(
          "flex min-w-0 flex-1 flex-col",
          card
            ? cx("my-1 gap-2 rounded-[1.25rem] px-4 py-2", CARD_SURFACE[tone])
            : "gap-1.5 rounded-[0.875rem] px-2 py-3 transition-colors duration-150 hover:bg-ui-tint/45",
        )}
      >
        <div className="flex min-h-6 flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <TimelineTitle
            className={cx(
              "min-w-0 text-pretty text-ui-ink",
              card ? "text-[0.9375rem] leading-[1.45]" : "text-sm leading-snug",
            )}
          >
            {title}
          </TimelineTitle>
          {meta || trailing ? (
            <div className="ms-auto flex shrink-0 items-center gap-2">
              {meta ? (
                <span className="text-xs font-semibold text-ui-soft tabular-nums">
                  {meta}
                </span>
              ) : null}
              {trailing}
            </div>
          ) : null}
        </div>
        {description ? (
          <TimelineDescription className="flex flex-col gap-1.5">
            {description}
          </TimelineDescription>
        ) : null}
      </div>
    </TimelineItem>
  );
}

export function ChronicleMilestone({
  value,
  time,
  dateTime,
  icon,
  label,
  enter = false,
}: {
  value: string;
  time: string;
  dateTime?: string;
  icon: ReactNode;
  label: ReactNode;
  enter?: boolean;
}) {
  return (
    <TimelineItem
      value={value}
      className={cx(
        "group/item relative flex items-stretch gap-3 rounded-[1rem] px-5 py-0 outline-none focus-visible:inset-ring-2 focus-visible:inset-ring-ui-primary max-md:px-3.5",
        enter && "motion-safe:animate-ui-enter",
      )}
    >
      <TimelineTime
        dateTime={dateTime}
        className="mt-3 flex h-6 w-10 shrink-0 items-center justify-end text-xs font-semibold text-ui-soft tabular-nums"
      >
        {time}
      </TimelineTime>
      <div className="relative flex w-6 shrink-0 flex-col items-center">
        <span aria-hidden="true" className={SPINE_TOP} />
        <TimelineMarker className="relative z-1 grid size-6 shrink-0 place-items-center rounded-full bg-ui-primary/12 text-ui-primary [&_svg]:size-3.5">
          {icon}
        </TimelineMarker>
        <TimelineConnector className={SPINE_BOTTOM} />
      </div>
      <div className="flex min-w-0 flex-1 items-start px-2 pt-3 pb-2.5">
        <TimelineTitle className="inline-flex h-6 items-center gap-1.5 rounded-full bg-ui-tint px-3 text-xs font-bold text-ui-ink">
          {label}
        </TimelineTitle>
      </div>
    </TimelineItem>
  );
}

export function ChronicleThought({
  by,
  verb = "thinks",
  children,
}: {
  by?: string;
  verb?: string;
  children?: ReactNode;
}) {
  return (
    <p className="border-s-2 border-ui-accent ps-3 text-[0.8125rem] leading-normal text-pretty text-ui-ink/85 italic">
      {by ? (
        <span className="font-bold text-ui-ink not-italic">{`${by} ${verb} `}</span>
      ) : null}
      <span>{children}</span>
    </p>
  );
}

export function ChronicleMore({
  summary,
  children,
}: {
  summary: ReactNode;
  children?: ReactNode;
}) {
  return (
    <Collapsible className="flex min-w-0 flex-col">
      <CollapsibleTrigger className="group/more -ms-1.5 inline-flex w-fit items-center gap-1.5 rounded-full px-1.5 py-0.5 text-xs font-bold text-ui-soft transition-colors duration-150 hover:bg-ui-surface/80 hover:text-ui-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ui-primary">
        <ChevronRightIcon
          aria-hidden
          className="size-3.5 transition-transform duration-200 group-data-open/more:rotate-90 rtl:rotate-180"
        />
        <span>{summary}</span>
      </CollapsibleTrigger>
      <CollapsiblePanel className="h-(--collapsible-panel-height) min-w-0 overflow-hidden transition-[height] duration-200 data-ending-style:h-0 data-starting-style:h-0 motion-reduce:transition-none">
        <div className="ms-1.5 mt-1 flex flex-col gap-1 border-s border-ui-line ps-3.5 text-[0.8125rem] leading-relaxed text-ui-soft">
          {children}
        </div>
      </CollapsiblePanel>
    </Collapsible>
  );
}
