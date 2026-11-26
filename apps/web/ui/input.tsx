"use client";

import { Input } from "@ui-sdk/react/input";
import { Textarea } from "@ui-sdk/react/textarea";
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

/** A one-line text field; name it with `aria-label` or a label's `htmlFor`. */
export function TextInput({
  className,
  ...props
}: Omit<ComponentProps<typeof Input>, "className"> & { className?: string }) {
  return (
    <Input
      {...props}
      className={cx(
        "h-10 min-w-0 rounded-[0.875rem] bg-ui-ground px-3.5 text-sm text-ui-ink inset-ring inset-ring-ui-line outline-none placeholder:text-ui-soft focus-visible:inset-ring-2 focus-visible:inset-ring-ui-primary data-[disabled]:opacity-50",
        className,
      )}
    />
  );
}

/** Several lines of text that grow with what is typed; name it like TextInput. */
export function TextArea({
  className,
  ...props
}: Omit<ComponentProps<typeof Textarea>, "className"> & {
  className?: string;
}) {
  return (
    <Textarea
      {...props}
      className={cx(
        "w-full min-w-0 resize-y rounded-[0.875rem] bg-ui-ground px-3.5 py-2.5 text-[0.9375rem] leading-[1.65] text-ui-ink inset-ring inset-ring-ui-line outline-none [field-sizing:content] placeholder:text-ui-soft focus-visible:inset-ring-2 focus-visible:inset-ring-ui-primary",
        className,
      )}
    />
  );
}
