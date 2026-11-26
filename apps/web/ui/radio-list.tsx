"use client";

import { Radio, RadioGroup, RadioIndicator } from "@ui-sdk/react/radio";
import { useId, type ReactNode } from "react";

/** One choice from a short list, each option a full-width row. */
export function RadioList<T extends string>({
  label,
  value,
  onValueChange,
  children,
}: {
  label: string;
  value: T;
  onValueChange: (value: T) => void;
  children: ReactNode;
}) {
  return (
    <RadioGroup<T>
      aria-label={label}
      className="flex flex-col gap-1"
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
}: {
  value: string;
  label: string;
  hint?: string;
  leading?: ReactNode;
}) {
  const id = useId();
  return (
    <label className="flex cursor-pointer items-center gap-3 rounded-[0.875rem] px-2.5 py-2 hover:bg-ui-tint has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ui-primary has-data-checked:bg-ui-tint has-data-checked:inset-ring-2 has-data-checked:inset-ring-ui-primary">
      {leading}
      <span className="flex min-w-0 flex-1 flex-col">
        <span id={`${id}-label`} className="text-sm font-bold">
          {label}
        </span>
        {hint ? (
          <span id={`${id}-hint`} className="text-xs text-ui-soft">
            {hint}
          </span>
        ) : null}
      </span>
      <Radio
        value={value}
        aria-labelledby={`${id}-label`}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className="grid size-4.5 shrink-0 place-items-center rounded-full inset-ring-2 inset-ring-ui-line outline-none data-checked:inset-ring-ui-primary"
      >
        <RadioIndicator className="size-2 rounded-full bg-ui-primary" />
      </Radio>
    </label>
  );
}
