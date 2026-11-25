"use client";

import { Switch as Root, SwitchThumb } from "@ui-sdk/react/switch";
import { useId } from "react";

/** A setting: its name and a line on what it does, with the switch beside them. */
export function SwitchRow({
  label,
  hint,
  checked,
  onCheckedChange,
  disabled,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-4 rounded-[1rem] bg-ui-tint px-3.5 py-3">
      <span className="flex min-w-0 flex-col gap-0.5">
        <label className="text-sm font-bold" id={`${id}-label`} htmlFor={id}>
          {label}
        </label>
        {hint ? (
          <span
            className="text-xs leading-[1.4] text-ui-soft"
            id={`${id}-hint`}
          >
            {hint}
          </span>
        ) : null}
      </span>
      <Root
        className="relative h-6.5 w-11 shrink-0 rounded-full bg-[color-mix(in_oklch,var(--ui-soft)_40%,transparent)] transition-colors duration-180 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ui-primary motion-reduce:transition-none data-checked:bg-ui-primary data-disabled:opacity-60"
        id={id}
        aria-labelledby={`${id}-label`}
        aria-describedby={hint ? `${id}-hint` : undefined}
        checked={checked}
        onCheckedChange={(next) => onCheckedChange(next)}
        disabled={disabled}
      >
        <SwitchThumb className="absolute inset-s-0.75 top-0.75 size-5 rounded-full bg-ui-surface shadow-[0_1px_3px_color-mix(in_oklch,var(--ui-ink)_30%,transparent)] transition-[translate] duration-220 ease-[cubic-bezier(0.3,1.3,0.5,1)] motion-reduce:transition-none data-checked:translate-x-4.5 rtl:data-checked:-translate-x-4.5" />
      </Root>
    </div>
  );
}
