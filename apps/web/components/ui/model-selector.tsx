"use client"

import type { ComponentProps, ReactNode } from "react"
import { cn } from "@/lib/utils"

import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command"
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

/* AI Elements Model Selector (registry.ai-sdk.dev/model-selector.json). */

export type ModelSelectorProps = ComponentProps<typeof Dialog>

export const ModelSelector = (props: ModelSelectorProps) => (
  <Dialog {...props} />
)

export type ModelSelectorTriggerProps = ComponentProps<typeof DialogTrigger>

export const ModelSelectorTrigger = (props: ModelSelectorTriggerProps) => (
  <DialogTrigger {...props} />
)

export type ModelSelectorContentProps = ComponentProps<typeof DialogContent> & {
  title?: ReactNode
  commandProps?: ComponentProps<typeof Command>
}

export const ModelSelectorContent = ({
  className,
  children,
  title = "Model Selector",
  commandProps,
  ...props
}: ModelSelectorContentProps) => (
  <DialogContent className={cn("p-0", className)} {...props}>
    <DialogTitle className="sr-only">{title}</DialogTitle>
    <Command
      {...commandProps}
      className={cn(
        "**:data-[slot=command-input-wrapper]:h-auto",
        commandProps?.className
      )}
    >
      {children}
    </Command>
  </DialogContent>
)

export type ModelSelectorDialogProps = ComponentProps<typeof CommandDialog>

export const ModelSelectorDialog = (props: ModelSelectorDialogProps) => (
  <CommandDialog {...props} />
)

export type ModelSelectorInputProps = ComponentProps<typeof CommandInput>

export const ModelSelectorInput = ({
  className,
  ...props
}: ModelSelectorInputProps) => (
  <CommandInput className={cn("h-auto py-3.5", className)} {...props} />
)

export type ModelSelectorListProps = ComponentProps<typeof CommandList>

export const ModelSelectorList = (props: ModelSelectorListProps) => (
  <CommandList {...props} />
)

export type ModelSelectorEmptyProps = ComponentProps<typeof CommandEmpty>

export const ModelSelectorEmpty = (props: ModelSelectorEmptyProps) => (
  <CommandEmpty {...props} />
)

export type ModelSelectorGroupProps = ComponentProps<typeof CommandGroup>

export const ModelSelectorGroup = (props: ModelSelectorGroupProps) => (
  <CommandGroup {...props} />
)

export type ModelSelectorItemProps = ComponentProps<typeof CommandItem>

export const ModelSelectorItem = (props: ModelSelectorItemProps) => (
  <CommandItem {...props} />
)

export type ModelSelectorShortcutProps = ComponentProps<typeof CommandShortcut>

export const ModelSelectorShortcut = (props: ModelSelectorShortcutProps) => (
  <CommandShortcut {...props} />
)

export type ModelSelectorSeparatorProps = ComponentProps<
  typeof CommandSeparator
>

export const ModelSelectorSeparator = (props: ModelSelectorSeparatorProps) => (
  <CommandSeparator {...props} />
)

export type ModelSelectorLogoProps = ComponentProps<"span"> & {
  /** A models.dev provider id (`zai`, `openrouter`, `venice`, …). */
  provider: string
}

/**
 * The upstream logo is an `<img>` with `dark:invert`; this app's dark theme
 * follows `prefers-color-scheme`, not a `.dark` class, so the logo is a mask
 * filled with `currentColor` instead and matches the text in either theme.
 */
export const ModelSelectorLogo = ({
  provider,
  className,
  style,
  ...props
}: ModelSelectorLogoProps) => {
  const url = `url(https://models.dev/logos/${provider}.svg)`
  return (
    <span
      {...props}
      role="img"
      aria-label={`${provider} logo`}
      className={cn("size-3 shrink-0 bg-current", className)}
      style={{
        maskImage: url,
        maskSize: "contain",
        maskRepeat: "no-repeat",
        maskPosition: "center",
        ...style,
      }}
    />
  )
}

export type ModelSelectorLogoGroupProps = ComponentProps<"div">

export const ModelSelectorLogoGroup = ({
  className,
  ...props
}: ModelSelectorLogoGroupProps) => (
  <div
    className={cn(
      "-space-x-1 flex shrink-0 items-center [&>[role=img]]:rounded-full [&>[role=img]]:ring-1",
      className
    )}
    {...props}
  />
)

export type ModelSelectorNameProps = ComponentProps<"span">

export const ModelSelectorName = ({
  className,
  ...props
}: ModelSelectorNameProps) => (
  <span className={cn("flex-1 truncate text-left", className)} {...props} />
)
