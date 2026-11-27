"use client";

import { Radio, RadioGroup, RadioIndicator } from "@ui-sdk/react/radio";
import { useId, type ReactNode } from "react";
import { cx } from "./cx";

/** One choice from a short list, each option a full-width row. */
export function RadioList<T extends string>({
  label,
  value,
  onValueChange,
  className,
  children,
}: {
  label: string;
  value: T | null;
  onValueChange: (value: T) => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <RadioGroup<T>
      aria-label={label}
      className={cx("flex flex-col gap-1.5", className)}
      value={value}
      onValueChange={(next) => {
        if (next !== null) onValueChange(next);
      }}
    >
      {children}
    </RadioGroup>
  );
}

export function RadioOption({
  value,
  label,
  hint,
  leading,
  trailing,
  disabled,
  className,
  children,
}: {
  value: string;
  label: ReactNode;
  hint?: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
  disabled?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  const id = useId();
  return (
    <label
      className={cx(
        "flex cursor-pointer flex-col gap-2.5 rounded-[1rem] px-3.5 py-3 transition-[background-color,box-shadow,transform] duration-150 hover:bg-ui-tint active:scale-[0.995] has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ui-primary has-data-checked:bg-ui-tint has-data-checked:inset-ring-2 has-data-checked:inset-ring-ui-primary has-data-[disabled]:cursor-not-allowed has-data-[disabled]:opacity-55",
        className,
      )}
    >
      <span className="flex items-center gap-3">
        {leading}
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span
            id={`${id}-label`}
            className="text-[0.9375rem] font-bold text-ui-ink"
          >
            {label}
          </span>
          {hint ? (
            <span
              id={`${id}-hint`}
              className="text-[0.8125rem] leading-snug text-pretty text-ui-soft"
            >
              {hint}
            </span>
          ) : null}
        </span>
        {trailing}
        <Radio
          value={value}
          disabled={disabled}
          aria-labelledby={`${id}-label`}
          aria-describedby={hint ? `${id}-hint` : undefined}
          className="grid size-4.5 shrink-0 place-items-center rounded-full inset-ring-2 inset-ring-ui-line transition-colors duration-150 outline-none data-checked:inset-ring-ui-primary"
        >
          <RadioIndicator className="size-2 rounded-full bg-ui-primary motion-safe:animate-ui-pop" />
        </Radio>
      </span>
      {children}
    </label>
  );
}
