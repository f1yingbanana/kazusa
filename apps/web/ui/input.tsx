"use client";

import { Input } from "@ui-sdk/react/input";
import type { ComponentProps } from "react";
import { cx } from "./cx";

export function SearchInput({
  className,
  ...props
}: Omit<ComponentProps<typeof Input>, "type" | "className"> & {
  "aria-label": string;
  className?: string;
}) {
  return (
    <Input
      {...props}
      type="search"
      className={cx(
        "h-10 min-w-0 flex-1 rounded-full bg-ui-surface px-4 text-sm text-ui-ink inset-ring inset-ring-ui-line outline-none placeholder:text-ui-soft focus-visible:inset-ring-2 focus-visible:inset-ring-ui-primary",
        className,
      )}
    />
  );
}
