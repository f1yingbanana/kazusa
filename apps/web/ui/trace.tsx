"use client";

import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "@ui-sdk/react/collapsible";
import { ChevronRightIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cx } from "./cx";

export type TraceStatus = "running" | "error";

/** Steps of some work, one line each, read top to bottom. */
export function Trace({ children }: { children: ReactNode }) {
  return <div className="flex w-full min-w-0 flex-col gap-1.5">{children}</div>;
}

/**
 * One step: an icon, what it was, and a quiet figure after it. A running step
 * breathes; a failed one is in the danger colour.
 */
export function TraceLine({
  icon,
  title,
  detail,
  status,
  hint,
}: {
  icon: ReactNode;
  title: ReactNode;
  detail?: ReactNode;
  status?: TraceStatus;
  /** On hover: the figures behind the detail. */
  hint?: string;
}) {
  return (
    <span
      title={hint}
      data-status={status}
      className="flex w-fit max-w-full min-w-0 items-center gap-2 text-[0.8125rem] text-ui-soft data-[status=error]:text-ui-danger [&_svg]:size-4 [&_svg]:shrink-0"
    >
      {icon}
      <span
        className={cx(
          "min-w-0 truncate font-semibold",
          status === "running" && "motion-safe:animate-ui-pulse",
        )}
      >
        {title}
      </span>
      {detail ? (
        <span className="shrink-0 text-xs tabular-nums opacity-75">
          {detail}
        </span>
      ) : null}
    </span>
  );
}

/** A step that opens to show what went in and came back. */
export function TraceFold({
  line,
  defaultOpen = false,
  children,
}: {
  line: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <Collapsible defaultOpen={defaultOpen} className="flex min-w-0 flex-col">
      <CollapsibleTrigger className="group/trace flex w-fit max-w-full min-w-0 items-center gap-1 rounded-[0.5rem] text-start focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ui-primary hover:[&>span]:text-ui-ink">
        {line}
        <ChevronRightIcon
          aria-hidden
          className="size-3.5 shrink-0 text-ui-soft transition-transform duration-200 group-data-open/trace:rotate-90"
        />
      </CollapsibleTrigger>
      <CollapsiblePanel className="h-(--collapsible-panel-height) min-w-0 overflow-hidden transition-[height] duration-200 data-ending-style:h-0 data-starting-style:h-0 motion-reduce:transition-none">
        <div className="ms-2 mt-1.5 mb-1 min-w-0 border-s border-ui-line ps-4 text-[0.8125rem] leading-relaxed wrap-break-word text-ui-soft">
          {children}
        </div>
      </CollapsiblePanel>
    </Collapsible>
  );
}

/** Text as it was, for a step's input or result. */
export function TraceBlock({ label, text }: { label: string; text: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-[0.6875rem] font-bold tracking-wide uppercase">
        {label}
      </span>
      <pre className="max-h-72 overflow-auto rounded-[0.625rem] bg-ui-tint p-2 text-xs whitespace-pre-wrap text-ui-ink">
        {text}
      </pre>
    </div>
  );
}
