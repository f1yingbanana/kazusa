"use client";

import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@ui-sdk/react/field";
import {
  Select as Root,
  SelectContent as Content,
  SelectGroup,
  SelectGroupLabel,
  SelectItem as Item,
  SelectItemIndicator,
  SelectSeparator as Separator,
  SelectTrigger as Trigger,
  SelectValue,
} from "@ui-sdk/react/select";
import { CheckIcon, ChevronDownIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cx } from "./cx";
import { POPUP } from "./popup";

export { SelectGroup, SelectGroupLabel, SelectValue };

export function Select<T extends string>({
  ...props
}: ComponentProps<typeof Root<T>>) {
  return <Root<T> {...props} />;
}

export function SelectTrigger({
  className,
  children,
  ...props
}: Omit<ComponentProps<typeof Trigger>, "className"> & {
  className?: string;
  children?: ReactNode;
}) {
  return (
    <Trigger
      {...props}
      className={cx(
        "flex h-10 w-full min-w-0 items-center justify-between gap-2 rounded-[0.875rem] bg-ui-ground px-3.5 text-sm font-semibold text-ui-ink inset-ring inset-ring-ui-line transition-colors outline-none hover:bg-ui-tint focus-visible:inset-ring-2 focus-visible:inset-ring-ui-primary data-[disabled]:cursor-not-allowed data-[disabled]:opacity-55",
        className,
      )}
    >
      <span className="min-w-0 truncate">{children ?? <SelectValue />}</span>
      <ChevronDownIcon aria-hidden className="size-4 shrink-0 text-ui-soft" />
    </Trigger>
  );
}

export function SelectContent({
  className,
  children,
  ...props
}: Omit<ComponentProps<typeof Content>, "className"> & {
  className?: string;
}) {
  return (
    <Content
      {...props}
      className={cx(
        POPUP,
        "max-h-[min(22rem,var(--available-height))] min-w-(--anchor-width) overflow-y-auto rounded-[1rem] p-1",
        className,
      )}
    >
      {children}
    </Content>
  );
}

export function SelectItem({
  children,
  ...props
}: Omit<ComponentProps<typeof Item>, "className"> & {
  children: ReactNode;
}) {
  return (
    <Item
      {...props}
      className="flex min-h-9 cursor-default items-center justify-between gap-2 rounded-[0.625rem] px-2.5 py-1.5 text-sm font-semibold text-ui-ink outline-none data-highlighted:bg-ui-tint data-disabled:opacity-45"
    >
      <span className="min-w-0 flex-1 truncate">{children}</span>
      <SelectItemIndicator className="grid size-4 shrink-0 place-items-center text-ui-primary">
        <CheckIcon aria-hidden className="size-3.5" strokeWidth={3} />
      </SelectItemIndicator>
    </Item>
  );
}

export function SelectSeparator() {
  return <Separator className="mx-1.5 my-1 h-px bg-ui-line" />;
}

export function SelectField<T extends string>({
  label,
  options,
  value,
  onValueChange,
  description,
  error,
  disabled,
  className,
  children,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onValueChange: (value: T) => void;
  description?: ReactNode;
  error?: string;
  disabled?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <Field
      invalid={error ? true : undefined}
      disabled={disabled}
      className={cx("flex flex-col gap-1.5", className)}
    >
      <FieldLabel className="text-sm font-bold">{label}</FieldLabel>
      <Select<T>
        items={[...options]}
        value={value}
        disabled={disabled}
        onValueChange={(next) => {
          if (next !== null) onValueChange(next);
        }}
      >
        <SelectTrigger />
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error ? (
        <FieldError match className="text-xs font-semibold text-ui-danger">
          {error}
        </FieldError>
      ) : description ? (
        <FieldDescription className="text-xs leading-normal text-ui-soft">
          {description}
        </FieldDescription>
      ) : null}
      {children}
    </Field>
  );
}
