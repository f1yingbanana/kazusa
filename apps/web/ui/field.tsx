"use client";

import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@ui-sdk/react/field";
import { Input } from "@ui-sdk/react/input";
import type { ComponentProps, ReactNode } from "react";
import { cx } from "./cx";

/**
 * A line of text with its label, a line under it saying what it's for, and in
 * its place what's wrong with it when something is. `action` sits at the
 * label's end, like a button that unlocks the field.
 */
export function TextField({
  label,
  description,
  error,
  action,
  mono = false,
  className,
  ...input
}: Omit<ComponentProps<typeof Input>, "className"> & {
  label: string;
  description?: ReactNode;
  error?: string | undefined;
  action?: ReactNode;
  /** Set in the monospaced face, for ids and codes. */
  mono?: boolean;
  className?: string;
}) {
  return (
    <Field
      invalid={error ? true : undefined}
      className={cx("flex flex-col gap-1.5", className)}
    >
      <div className="flex items-center justify-between gap-2">
        <FieldLabel className="text-sm font-bold">{label}</FieldLabel>
        {action}
      </div>
      <Input
        {...input}
        className={cx(
          "h-10 min-w-0 rounded-[0.875rem] bg-ui-ground px-3.5 text-sm text-ui-ink inset-ring inset-ring-ui-line outline-none placeholder:text-ui-soft focus-visible:inset-ring-2 focus-visible:inset-ring-ui-primary data-[disabled]:opacity-60 data-[invalid]:inset-ring-ui-danger",
          mono && "font-[ui-monospace,monospace] text-[0.8125rem]",
        )}
      />
      {error ? (
        <FieldError match className="text-xs font-semibold text-ui-danger">
          {error}
        </FieldError>
      ) : description ? (
        <FieldDescription className="text-xs leading-normal text-ui-soft">
          {description}
        </FieldDescription>
      ) : null}
    </Field>
  );
}
