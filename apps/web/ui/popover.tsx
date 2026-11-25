"use client";

import {
  PopoverContent as Content,
  PopoverTitle as Title,
} from "@ui-sdk/react/popover";
import type { ComponentProps } from "react";
import { cx } from "./cx";
import { POPUP } from "./popup";

export { Popover, PopoverTrigger } from "@ui-sdk/react/popover";

export function PopoverContent({
  className,
  ...props
}: Omit<ComponentProps<typeof Content>, "className"> & { className?: string }) {
  return <Content {...props} className={cx(POPUP, className)} />;
}

export function PopoverTitle(
  props: Omit<ComponentProps<typeof Title>, "className">,
) {
  return <Title {...props} className="text-base font-extrabold" />;
}

export function PopoverText(props: Omit<ComponentProps<"p">, "className">) {
  return (
    <p {...props} className="text-[0.8125rem] leading-normal text-ui-soft" />
  );
}

/** A small heading over a group of controls inside the popover. */
export function PopoverLabel(props: Omit<ComponentProps<"span">, "className">) {
  return <span {...props} className="mt-1 text-xs font-bold text-ui-soft" />;
}
