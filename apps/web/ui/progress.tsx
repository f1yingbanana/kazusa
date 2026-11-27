"use client";

import {
  Progress as Root,
  ProgressIndicator,
  ProgressLabel,
  ProgressTrack,
  ProgressValue,
} from "@ui-sdk/react/progress";
import type { ReactNode } from "react";
import { cx } from "./cx";

export function ProgressBar({
  label,
  value,
  statusText,
  className,
}: {
  label: ReactNode;
  value: number | null;
  statusText?: ReactNode;
  className?: string;
}) {
  return (
    <Root value={value} className={cx("flex flex-col gap-1.5", className)}>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <ProgressLabel className="truncate font-semibold text-ui-ink">
          {label}
        </ProgressLabel>
        {statusText !== undefined ? (
          <span className="shrink-0 text-xs text-ui-soft tabular-nums">
            {statusText}
          </span>
        ) : (
          <ProgressValue className="shrink-0 text-xs text-ui-soft tabular-nums" />
        )}
      </div>
      <ProgressTrack className="h-2 w-full overflow-hidden rounded-full bg-ui-tint">
        <ProgressIndicator className="h-full rounded-full bg-ui-primary transition-[width] duration-300 ease-out data-indeterminate:w-1/3 motion-safe:data-indeterminate:animate-ui-indeterminate motion-reduce:transition-none motion-reduce:data-indeterminate:animate-ui-pulse" />
      </ProgressTrack>
    </Root>
  );
}
