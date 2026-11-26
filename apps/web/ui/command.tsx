"use client";

import {
  Command,
  CommandEmpty,
  CommandGroup as Group,
  CommandGroupLabel,
  CommandInput,
  CommandItem as Item,
  CommandList,
  type CommandValueChangeDetails,
} from "@ui-sdk/react/command";
import {
  Dialog,
  DialogBackdrop,
  DialogContent,
  DialogTitle,
} from "@ui-sdk/react/dialog";
import { Button } from "@ui-sdk/react/button";
import {
  CheckIcon,
  ChevronsUpDownIcon,
  LoaderCircleIcon,
  SearchIcon,
} from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cx } from "./cx";
import { BACKDROP } from "./overlay";

/**
 * Looks like a select, and opens a CommandDialog for a list too long to scroll:
 * the chosen item, quieter text after it, and the chevron at the end.
 */
export function CommandTrigger({
  label,
  icon,
  hint,
  pending = false,
  disabled = false,
  onClick,
  className,
  children,
}: {
  label: string;
  icon?: ReactNode;
  hint?: ReactNode;
  pending?: boolean;
  disabled?: boolean;
  onClick: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Button
      type="button"
      aria-label={label}
      aria-haspopup="dialog"
      disabled={disabled || pending}
      data-pending={pending || undefined}
      onClick={onClick}
      className={cx(
        "flex h-10 w-full min-w-0 items-center gap-2.5 rounded-[0.875rem] bg-ui-ground px-3.5 text-start text-sm font-semibold text-ui-ink inset-ring inset-ring-ui-line transition-colors outline-none hover:bg-ui-tint focus-visible:inset-ring-2 focus-visible:inset-ring-ui-primary data-[disabled]:cursor-not-allowed data-[disabled]:opacity-55 data-[pending]:cursor-wait [&_svg]:size-4 [&_svg]:shrink-0",
        className,
      )}
    >
      {pending ? (
        <span className="flex shrink-0 text-ui-soft">
          <LoaderCircleIcon aria-hidden className="animate-ui-spin" />
        </span>
      ) : icon ? (
        <span className="flex shrink-0 text-ui-soft">{icon}</span>
      ) : null}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint ? (
        <span className="shrink-0 truncate text-xs font-medium text-ui-soft">
          {hint}
        </span>
      ) : null}
      <ChevronsUpDownIcon aria-hidden className="text-ui-soft" />
    </Button>
  );
}

/**
 * A search box over everything, in a dialog. Items filter by their `label` and
 * `keywords`.
 */
export function CommandDialog({
  open,
  onOpenChange,
  title,
  label,
  placeholder,
  empty,
  footer,
  query,
  onQueryChange,
  highlighted,
  onHighlightedChange,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  label: string;
  placeholder: string;
  empty: string;
  footer?: ReactNode;
  /** With a query, the caller ranks and renders the matches itself. */
  query?: string;
  onQueryChange?: (query: string) => void;
  /** The highlighted command's value, when the caller ranks. */
  highlighted?: string | null;
  onHighlightedChange?: (
    value: string | null,
    details: CommandValueChangeDetails,
  ) => void;
  children: ReactNode;
}) {
  const ranked = query !== undefined;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogBackdrop className={BACKDROP} />
      <DialogContent className="fixed top-[12vh] left-1/2 z-55 w-[min(38rem,calc(100vw-1.5rem))] -translate-x-1/2 overflow-hidden rounded-[1.5rem] ui-raised text-ui-ink outline-none">
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <Command
          className="flex flex-col"
          loop
          {...(ranked
            ? {
                filter: false,
                query,
                onQueryChange: (next: string) => onQueryChange?.(next),
                value: highlighted,
                onValueChange: (
                  next: string | null,
                  details: CommandValueChangeDetails,
                ) => onHighlightedChange?.(next, details),
              }
            : {})}
        >
          <div className="flex items-center gap-3 border-b border-ui-line px-5 py-4 text-ui-soft">
            <SearchIcon aria-hidden className="size-5 shrink-0" />
            <CommandInput
              className="min-w-0 flex-1 bg-transparent text-base text-ui-ink outline-none placeholder:text-ui-soft"
              aria-label={label}
              placeholder={placeholder}
            />
          </div>
          <CommandEmpty className="text-center text-sm text-ui-soft data-empty:p-6">
            {empty}
          </CommandEmpty>
          <CommandList className="max-h-[min(60vh,28rem)] scroll-py-2 overflow-y-auto p-2 pb-3 empty:hidden">
            {children}
          </CommandList>
          {footer ? (
            <div className="border-t border-ui-line p-2">{footer}</div>
          ) : null}
        </Command>
      </DialogContent>
    </Dialog>
  );
}

export function CommandGroup({
  label,
  more = 0,
  children,
}: {
  label: string;
  /** How many matches past the ones shown. */
  more?: number;
  children: ReactNode;
}) {
  return (
    <Group className="flex flex-col pb-2">
      <CommandGroupLabel className="px-3 pt-2 pb-1 text-xs font-extrabold text-ui-soft">
        {label}
      </CommandGroupLabel>
      {children}
      {more > 0 ? (
        <p className="px-3 pt-1 text-xs text-ui-soft">{more} more</p>
      ) : null}
    </Group>
  );
}

/** `hint` is quieter text after the main line. */
export function CommandItem({
  icon,
  hint,
  trailing,
  checked = false,
  inset = false,
  children,
  ...props
}: Omit<ComponentProps<typeof Item>, "className" | "children"> & {
  icon?: ReactNode;
  hint?: ReactNode;
  trailing?: ReactNode;
  checked?: boolean;
  /** Something to do with the row above it. */
  inset?: boolean;
  children: ReactNode;
}) {
  return (
    <Item
      {...props}
      data-checked={checked || undefined}
      data-inset={inset || undefined}
      className="flex min-h-10 cursor-pointer items-center gap-3 rounded-[0.875rem] px-3 py-1.5 text-[0.9375rem] data-highlighted:bg-ui-tint data-inset:min-h-9 data-inset:ps-9 data-inset:text-sm data-inset:text-ui-soft data-highlighted:data-inset:text-ui-ink data-checked:bg-ui-accent-tint data-disabled:cursor-not-allowed data-disabled:opacity-45 [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-ui-soft data-highlighted:[&>svg]:text-ui-primary"
    >
      {icon}
      <span className="flex min-w-0 flex-1 items-baseline gap-2">
        <span className="min-w-0 truncate">{children}</span>
        {hint ? (
          <span className="truncate text-xs text-ui-soft">
            <span className="sr-only">, </span>
            {hint}
          </span>
        ) : null}
      </span>
      {trailing}
      {checked ? (
        <CheckIcon
          aria-hidden
          className="size-4 shrink-0 text-ui-primary"
          strokeWidth={2.5}
        />
      ) : null}
    </Item>
  );
}
