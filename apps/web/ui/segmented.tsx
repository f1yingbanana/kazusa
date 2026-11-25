"use client";

import {
  SegmentedControl,
  SegmentedControlIndicator,
  SegmentedControlItem,
} from "@ui-sdk/react/segmented-control";
import type { ComponentProps, ReactNode } from "react";
import { cx } from "./cx";

export function Segmented<T extends string>({
  stretch,
  className,
  children,
  ...props
}: Omit<
  ComponentProps<typeof SegmentedControl<T>>,
  "className" | "children"
> & {
  /** Fill the row, items sharing it equally. */
  stretch?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <SegmentedControl<T>
      {...props}
      className={cx(
        "relative inline-flex shrink-0 rounded-full bg-ui-tint p-1",
        stretch && "flex w-full",
        className,
      )}
    >
      {/* ui-sdk publishes the checked item's box as custom properties; the pill follows them. */}
      <SegmentedControlIndicator className="absolute top-(--segmented-control-indicator-top) left-(--segmented-control-indicator-left) h-(--segmented-control-indicator-height) w-(--segmented-control-indicator-width) rounded-full bg-ui-primary shadow-[0_2px_8px_-2px_color-mix(in_oklch,var(--ui-primary)_60%,transparent)] transition-[left,width] duration-280 ease-[cubic-bezier(0.3,1.3,0.5,1)] motion-reduce:transition-none" />
      {children}
    </SegmentedControl>
  );
}

export function SegmentedItem({
  className,
  ...props
}: Omit<ComponentProps<typeof SegmentedControlItem>, "className"> & {
  className?: string;
}) {
  return (
    <SegmentedControlItem
      {...props}
      className={cx(
        "relative z-1 h-8 flex-1 rounded-full px-3.5 text-sm font-bold text-ui-soft transition-colors duration-150 hover:not-data-[checked]:text-ui-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ui-primary data-[checked]:text-ui-on-primary data-[disabled]:cursor-not-allowed data-[disabled]:opacity-55",
        className,
      )}
    />
  );
}
