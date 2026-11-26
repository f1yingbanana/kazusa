"use client";

import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@ui-sdk/react/field";
import { Input } from "@ui-sdk/react/input";
import {
  NumberInput,
  NumberInputControl,
  NumberInputDecrement,
  NumberInputGroup,
  NumberInputIncrement,
} from "@ui-sdk/react/number-input";
import {
  PasswordInput,
  PasswordInputControl,
  PasswordInputToggle,
} from "@ui-sdk/react/password-input";
import { Textarea } from "@ui-sdk/react/textarea";
import { EyeIcon, EyeOffIcon, MinusIcon, PlusIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cx } from "./cx";

const CONTROL =
  "rounded-[0.875rem] bg-ui-ground text-sm text-ui-ink inset-ring inset-ring-ui-line outline-none placeholder:text-ui-soft focus-visible:inset-ring-2 focus-visible:inset-ring-ui-primary data-[disabled]:opacity-60 data-[invalid]:inset-ring-ui-danger";

const MONO = "font-[ui-monospace,monospace] text-[0.8125rem]";

function FieldHeader({
  label,
  action,
  hidden = false,
}: {
  label: string;
  action?: ReactNode;
  hidden?: boolean;
}) {
  if (hidden) return <FieldLabel className="sr-only">{label}</FieldLabel>;
  return (
    <div className="flex items-center justify-between gap-2">
      <FieldLabel className="text-sm font-bold">{label}</FieldLabel>
      {action}
    </div>
  );
}

function FieldFooter({
  description,
  error,
}: {
  description?: ReactNode;
  error?: string | undefined;
}) {
  if (error) {
    return (
      <FieldError match className="text-xs font-semibold text-ui-danger">
        {error}
      </FieldError>
    );
  }
  if (description) {
    return (
      <FieldDescription className="text-xs leading-normal text-ui-soft">
        {description}
      </FieldDescription>
    );
  }
  return null;
}

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
      <FieldHeader label={label} action={action} />
      <Input
        {...input}
        className={cx("h-10 min-w-0 px-3.5", CONTROL, mono && MONO)}
      />
      <FieldFooter description={description} error={error} />
    </Field>
  );
}

/** A secret field with a show/hide toggle, named by its FieldLabel. */
export function PasswordField({
  label,
  labelHidden = false,
  description,
  error,
  action,
  mono = true,
  name,
  value,
  defaultValue,
  onValueChange,
  disabled,
  readOnly,
  required,
  autoComplete = "off",
  placeholder,
  autoFocus,
  className,
}: {
  label: string;
  /** For a row whose title already says what this is. */
  labelHidden?: boolean;
  description?: ReactNode;
  error?: string | undefined;
  action?: ReactNode;
  mono?: boolean;
  name?: string;
  value?: string;
  defaultValue?: string;
  onValueChange?: ComponentProps<typeof PasswordInput>["onValueChange"];
  disabled?: boolean;
  readOnly?: boolean;
  required?: boolean;
  autoComplete?: ComponentProps<typeof PasswordInput>["autoComplete"];
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
}) {
  return (
    <Field
      name={name}
      invalid={error ? true : undefined}
      disabled={disabled}
      className={cx("flex flex-col gap-1.5", className)}
    >
      <FieldHeader label={label} action={action} hidden={labelHidden} />
      <PasswordInput
        value={value}
        defaultValue={defaultValue}
        onValueChange={onValueChange}
        disabled={disabled}
        readOnly={readOnly}
        required={required}
        autoComplete={autoComplete}
        className="flex h-10 min-w-0 items-center overflow-hidden rounded-[0.875rem] bg-ui-ground inset-ring inset-ring-ui-line focus-within:inset-ring-2 focus-within:inset-ring-ui-primary data-invalid:inset-ring-ui-danger data-disabled:opacity-60"
      >
        <PasswordInputControl
          placeholder={placeholder}
          autoFocus={autoFocus}
          spellCheck={false}
          className={cx(
            "h-full min-w-0 flex-1 bg-transparent ps-3.5 pe-2 text-sm text-ui-ink outline-none placeholder:text-ui-soft",
            mono && MONO,
          )}
        />
        <PasswordInputToggle
          aria-label={`Show ${label.toLowerCase()}`}
          className="me-1 grid size-8 shrink-0 place-items-center rounded-full text-ui-soft transition-colors hover:bg-ui-tint hover:text-ui-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ui-primary [&_svg]:size-4"
        >
          {(state) =>
            state.visible ? <EyeOffIcon aria-hidden /> : <EyeIcon aria-hidden />
          }
        </PasswordInputToggle>
      </PasswordInput>
      <FieldFooter description={description} error={error} />
    </Field>
  );
}

/** A multi-line text field with label, description and error. */
export function TextareaField({
  label,
  description,
  error,
  action,
  mono = false,
  className,
  ...textarea
}: Omit<ComponentProps<typeof Textarea>, "className"> & {
  label: string;
  description?: ReactNode;
  error?: string | undefined;
  action?: ReactNode;
  mono?: boolean;
  className?: string;
}) {
  return (
    <Field
      invalid={error ? true : undefined}
      className={cx("flex flex-col gap-1.5", className)}
    >
      <FieldHeader label={label} action={action} />
      <Textarea
        {...textarea}
        className={cx(
          "min-h-24 min-w-0 resize-y px-3.5 py-2.5 leading-relaxed",
          CONTROL,
          mono && MONO,
        )}
      />
      <FieldFooter description={description} error={error} />
    </Field>
  );
}

/** A whole or stepped number field with optional unit suffix. */
export function NumberField({
  label,
  description,
  error,
  action,
  unit,
  value,
  defaultValue,
  onValueChange,
  onValueCommit,
  min,
  max,
  step = 1,
  disabled,
  readOnly,
  muted = false,
  horizontal = false,
  className,
}: {
  label: string;
  description?: ReactNode;
  error?: string | undefined;
  action?: ReactNode;
  unit?: string;
  value?: number | null;
  defaultValue?: number | null;
  onValueChange?: ComponentProps<typeof NumberInput>["onValueChange"];
  onValueCommit?: ComponentProps<typeof NumberInput>["onValueCommit"];
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  readOnly?: boolean;
  /** Quieter text, for an inherited setting. */
  muted?: boolean;
  horizontal?: boolean;
  className?: string;
}) {
  const input = (
    <NumberInput
      value={value}
      defaultValue={defaultValue}
      onValueChange={onValueChange}
      onValueCommit={onValueCommit}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      readOnly={readOnly}
      className={horizontal ? "shrink-0" : undefined}
    >
      <NumberInputGroup className="inline-flex h-10 items-center overflow-hidden rounded-[0.875rem] bg-ui-ground inset-ring inset-ring-ui-line focus-within:inset-ring-2 focus-within:inset-ring-ui-primary data-invalid:inset-ring-ui-danger data-disabled:opacity-60">
        <NumberInputDecrement
          aria-label={`Decrease ${label}`}
          className="grid size-8 shrink-0 place-items-center text-ui-soft transition-colors hover:bg-ui-tint hover:text-ui-ink focus-visible:outline-2 focus-visible:outline-ui-primary data-disabled:opacity-35 [&_svg]:size-3.5"
        >
          <MinusIcon aria-hidden />
        </NumberInputDecrement>
        <NumberInputControl
          className={cx(
            "h-full w-24 min-w-0 bg-transparent px-1.5 text-end font-[ui-monospace,monospace] text-[0.8125rem] tabular-nums outline-none",
            muted ? "text-ui-soft" : "text-ui-ink",
          )}
        />
        {unit ? (
          <span className="pe-1.5 text-xs font-semibold text-ui-soft select-none">
            {unit}
          </span>
        ) : null}
        <NumberInputIncrement
          aria-label={`Increase ${label}`}
          className="grid size-8 shrink-0 place-items-center text-ui-soft transition-colors hover:bg-ui-tint hover:text-ui-ink focus-visible:outline-2 focus-visible:outline-ui-primary data-disabled:opacity-35 [&_svg]:size-3.5"
        >
          <PlusIcon aria-hidden />
        </NumberInputIncrement>
      </NumberInputGroup>
    </NumberInput>
  );

  if (horizontal) {
    return (
      <Field
        invalid={error ? true : undefined}
        disabled={disabled}
        className={cx(
          "flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4",
          className,
        )}
      >
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <FieldLabel className="text-sm font-bold">{label}</FieldLabel>
          <FieldFooter description={description} error={error} />
        </div>
        <div className="flex shrink-0 flex-col items-start gap-1 sm:items-end">
          {input}
          {action}
        </div>
      </Field>
    );
  }

  return (
    <Field
      invalid={error ? true : undefined}
      disabled={disabled}
      className={cx("flex flex-col gap-1.5", className)}
    >
      <FieldHeader label={label} action={action} />
      {input}
      <FieldFooter description={description} error={error} />
    </Field>
  );
}
