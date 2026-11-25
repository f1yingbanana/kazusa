"use client";

import {
  Checkbox,
  CheckboxGroup,
  CheckboxIndicator,
} from "@ui-sdk/react/checkbox";
import { CheckIcon, MinusIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cx } from "./cx";

export { createCheckboxGroupController } from "@ui-sdk/react/checkbox";

export function CheckList<T extends string>({
  label,
  className,
  children,
  ...props
}: Omit<ComponentProps<typeof CheckboxGroup<T>>, "className" | "aria-label"> & {
  label: string;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <CheckboxGroup<T>
      aria-label={label}
      className={cx("flex flex-col gap-0.5", className)}
      {...props}
    >
      {children}
    </CheckboxGroup>
  );
}

export function CheckRow({
  value,
  parent,
  checked,
  defaultChecked,
  onCheckedChange,
  disabled,
  icon,
  media,
  label,
  hint,
  className,
}: {
  value?: string;
  parent?: boolean;
  checked?: boolean | "indeterminate";
  defaultChecked?: boolean | "indeterminate";
  onCheckedChange?: ComponentProps<typeof Checkbox>["onCheckedChange"];
  disabled?: boolean;
  icon?: ReactNode;
  /** A picture beside the label, like a face, at its own size. */
  media?: ReactNode;
  label: ReactNode;
  hint?: ReactNode;
  className?: string;
}) {
  return (
    <label
      className={cx(
        "group/check flex min-h-9 cursor-pointer items-center gap-2.5 rounded-[0.875rem] px-2.5 py-1.5 text-sm transition-colors duration-150 hover:bg-ui-tint has-data-[disabled]:cursor-not-allowed has-data-[disabled]:opacity-50",
        className,
      )}
    >
      <Checkbox
        value={value}
        parent={parent}
        checked={checked}
        defaultChecked={defaultChecked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        className="grid size-4.5 shrink-0 place-items-center rounded-[0.375rem] bg-ui-surface inset-ring-2 inset-ring-ui-line transition-colors duration-150 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ui-primary data-indeterminate:bg-ui-primary data-indeterminate:text-ui-on-primary data-indeterminate:inset-ring-0 data-checked:bg-ui-primary data-checked:text-ui-on-primary data-checked:inset-ring-0"
      >
        <CheckboxIndicator className="grid place-items-center">
          {(state) =>
            state.indeterminate ? (
              <MinusIcon aria-hidden className="size-3" strokeWidth={3} />
            ) : (
              <CheckIcon aria-hidden className="size-3" strokeWidth={3} />
            )
          }
        </CheckboxIndicator>
      </Checkbox>
      {icon ? (
        <span
          aria-hidden="true"
          className="grid size-4 shrink-0 place-items-center text-ui-soft [&_svg]:size-4"
        >
          {icon}
        </span>
      ) : null}
      {media}
      <span className="min-w-0 flex-1 truncate font-semibold text-ui-ink">
        {label}
      </span>
      {hint !== undefined ? (
        <span className="shrink-0 text-xs font-semibold text-ui-soft tabular-nums">
          {hint}
        </span>
      ) : null}
    </label>
  );
}
