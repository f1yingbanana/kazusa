"use client";

import { Toggle } from "@ui-sdk/react/toggle";
import type { ComponentProps } from "react";

/** A pill that stays pressed, like a tag that is on: filled while it is. */
export function ToggleChip(
  props: Omit<ComponentProps<typeof Toggle>, "className">,
) {
  return (
    <Toggle
      {...props}
      className="flex h-8 items-center gap-1.5 rounded-full px-3 text-[0.8125rem] font-bold text-ui-soft inset-ring inset-ring-ui-line transition-[background-color,color,scale] duration-150 hover:text-ui-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ui-primary active:scale-95 data-pressed:bg-ui-primary data-pressed:text-ui-on-primary data-pressed:inset-ring-0 [&_svg]:size-3.5"
    />
  );
}
