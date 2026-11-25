"use client";

import {
  Command,
  CommandEmpty,
  CommandGroup as Group,
  CommandGroupLabel,
  CommandInput,
  CommandItem as Item,
  CommandList,
} from "@ui-sdk/react/command";
import {
  Dialog,
  DialogBackdrop,
  DialogContent,
  DialogTitle,
} from "@ui-sdk/react/dialog";
import { SearchIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { BACKDROP } from "./overlay";

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
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  label: string;
  placeholder: string;
  empty: string;
  children: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogBackdrop className={BACKDROP} />
      <DialogContent className="fixed top-[12vh] left-1/2 z-55 w-[min(38rem,calc(100vw-1.5rem))] -translate-x-1/2 overflow-hidden rounded-[1.5rem] ui-raised text-ui-ink outline-none">
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <Command className="flex flex-col" loop>
          <div className="flex items-center gap-3 border-b border-ui-line px-5 py-4 text-ui-soft">
            <SearchIcon aria-hidden className="size-5 shrink-0" />
            <CommandInput
              className="min-w-0 flex-1 bg-transparent text-base text-ui-ink outline-none placeholder:text-ui-soft"
              aria-label={label}
              placeholder={placeholder}
            />
          </div>
          <CommandList className="max-h-[min(60vh,28rem)] overflow-y-auto p-2">
            <CommandEmpty className="p-6 text-center text-sm text-ui-soft">
              {empty}
            </CommandEmpty>
            {children}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

export function CommandGroup({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <Group className="flex flex-col pb-2">
      <CommandGroupLabel className="px-3 pt-2 pb-1 text-xs font-extrabold text-ui-soft">
        {label}
      </CommandGroupLabel>
      {children}
    </Group>
  );
}

/** `hint` is quieter text after the main line. */
export function CommandItem({
  icon,
  hint,
  trailing,
  children,
  ...props
}: Omit<ComponentProps<typeof Item>, "className" | "children"> & {
  icon?: ReactNode;
  hint?: ReactNode;
  trailing?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Item
      {...props}
      className="flex min-h-10 cursor-pointer items-center gap-3 rounded-[0.875rem] px-3 py-1.5 text-[0.9375rem] data-highlighted:bg-ui-tint data-disabled:cursor-not-allowed data-disabled:opacity-45 [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-ui-soft data-highlighted:[&>svg]:text-ui-primary"
    >
      {icon}
      <span className="flex min-w-0 flex-1 items-baseline gap-2">
        <span>{children}</span>
        {hint ? (
          <span className="truncate text-xs text-ui-soft">{hint}</span>
        ) : null}
      </span>
      {trailing}
    </Item>
  );
}
