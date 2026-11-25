"use client";

import { XIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Tooltip } from "./tooltip";
import { VisuallyHidden } from "./visually-hidden";

/**
 * A column with a fixed head (search, actions), a scrolling body and an
 * optional footnote.
 */
export function ListPane({
  head,
  foot,
  children,
}: {
  head?: ReactNode;
  foot?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {head ? <div className="flex items-center gap-2 pb-3">{head}</div> : null}
      {children}
      {foot ? (
        <p className="pt-3 text-[0.8125rem] text-ui-soft">{foot}</p>
      ) : null}
    </div>
  );
}

export function ListPaneScroll({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
      {children}
    </div>
  );
}

export function ListSection({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-1" aria-label={title}>
      <h2 className="flex flex-wrap items-baseline gap-2 px-3 text-sm font-extrabold">
        {title}
        {note ? (
          <span className="text-xs font-medium text-ui-soft">{note}</span>
        ) : null}
      </h2>
      {children}
    </section>
  );
}

export function ListRows({ children }: { children: ReactNode }) {
  return <ul className="flex flex-col">{children}</ul>;
}

/** One pressable row of a list. Render it as the child of a `<li>`. */
export function ListRow({
  current,
  onClick,
  leading,
  title,
  sub,
  trailing,
}: {
  current?: boolean;
  onClick: () => void;
  leading?: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <button
      type="button"
      className="flex w-full items-center gap-3 rounded-[1rem] px-3 py-2.5 text-start transition-colors duration-150 hover:bg-ui-tint focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ui-primary aria-current:bg-ui-surface aria-current:inset-ring-2 aria-current:inset-ring-ui-primary"
      aria-current={current ? "true" : undefined}
      onClick={onClick}
    >
      {leading}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-[0.9375rem] font-bold">{title}</span>
        {sub ? (
          <span className="truncate text-[0.8125rem] text-ui-soft">{sub}</span>
        ) : null}
      </span>
      {trailing}
    </button>
  );
}

/**
 * A count in the accent colour. `label` finishes the sentence a screen reader
 * hears.
 */
export function Badge({ count, label }: { count: number; label: string }) {
  return (
    <span className="inline-grid h-5.5 min-w-5.5 place-items-center rounded-full bg-ui-accent px-1.5 text-xs font-extrabold text-ui-on-accent">
      {count > 99 ? "99+" : count}
      <VisuallyHidden>{` ${label}`}</VisuallyHidden>
    </span>
  );
}

/** A filter that's on, with a button to take it off. */
export function FilterChip({
  children,
  clearLabel,
  onClear,
}: {
  children: ReactNode;
  clearLabel: string;
  onClear: () => void;
}) {
  return (
    <div className="ms-1 mb-3 inline-flex items-center gap-1.5 self-start rounded-full bg-ui-accent-tint py-1 ps-3 pe-1.5 text-[0.8125rem] font-bold text-ui-accent-ink">
      <span>{children}</span>
      <Tooltip label={clearLabel} names>
        <button
          type="button"
          className="grid place-items-center rounded-full"
          onClick={onClear}
        >
          <XIcon aria-hidden className="size-3.5" />
        </button>
      </Tooltip>
    </div>
  );
}
