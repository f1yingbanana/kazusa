"use client";

import {
  Tabs as Root,
  TabsIndicator,
  TabsList as List,
  TabsPanel as Panel,
  TabsTab as Tab,
} from "@ui-sdk/react/tabs";
import type { ComponentProps, ReactNode } from "react";
import { cx } from "./cx";

export function Tabs<T extends string>({
  className,
  ...props
}: Omit<ComponentProps<typeof Root<T>>, "className"> & { className?: string }) {
  return <Root<T> {...props} className={cx("flex flex-col", className)} />;
}

/**
 * A row of tabs over a hairline, the chosen one underlined by a bar that glides
 * to it. `end` holds whatever acts on the panel shown, at the row's far side.
 */
export function TabsList({
  label,
  end,
  className,
  children,
}: {
  label: string;
  end?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cx(
        "flex items-end gap-3 border-b border-ui-line max-sm:overflow-x-auto",
        className,
      )}
    >
      <List
        aria-label={label}
        className="relative flex min-w-0 flex-1 items-end gap-5 max-sm:gap-4"
      >
        {children}
        <TabsIndicator className="absolute -bottom-px left-(--active-tab-left) h-[3px] w-(--active-tab-width) rounded-full bg-ui-primary transition-[left,width] duration-280 ease-[cubic-bezier(0.3,1.3,0.5,1)] data-[activation-direction=none]:transition-none motion-reduce:transition-none" />
      </List>
      {end ? (
        <div className="flex shrink-0 items-center gap-1 pb-1.5">{end}</div>
      ) : null}
    </div>
  );
}

export function TabsTab({
  count,
  children,
  ...props
}: Omit<ComponentProps<typeof Tab>, "className" | "children"> & {
  /** A number after the label, like how many people a tab lists. */
  count?: number;
  children: ReactNode;
}) {
  return (
    <Tab
      {...props}
      className="group/tab flex h-10 shrink-0 items-center gap-1.5 rounded-[0.5rem] text-[0.9375rem] font-bold text-ui-soft transition-colors duration-150 outline-none hover:text-ui-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ui-primary data-selected:text-ui-ink data-disabled:opacity-50"
    >
      {children}
      {count ? (
        <span className="rounded-full bg-ui-tint px-1.5 text-xs leading-5 tabular-nums group-data-selected/tab:bg-ui-accent-tint group-data-selected/tab:text-ui-accent-ink">
          {count}
        </span>
      ) : null}
    </Tab>
  );
}

/** Fades in as it's chosen; an unchosen panel is not rendered. */
export function TabsPanel({
  className,
  ...props
}: Omit<ComponentProps<typeof Panel>, "className"> & { className?: string }) {
  return (
    <Panel
      {...props}
      className={cx(
        "outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ui-primary data-[selected]:motion-safe:animate-ui-enter",
        className,
      )}
    />
  );
}
