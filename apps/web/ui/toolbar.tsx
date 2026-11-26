"use client";

import {
  Toolbar as Root,
  ToolbarButton as Button,
  ToolbarSeparator as Separator,
} from "@ui-sdk/react/toolbar";
import type { ComponentProps, ReactNode } from "react";
import { cx } from "./cx";
import { Tooltip } from "./tooltip";

/** A floating row of controls with one tab stop; arrow keys move between them. */
export function Toolbar({
  label,
  orientation,
  className,
  children,
}: {
  label: string;
  orientation?: "horizontal" | "vertical";
  className?: string;
  children: ReactNode;
}) {
  return (
    <Root
      aria-label={label}
      orientation={orientation}
      className={cx(
        "flex items-center gap-0.5 rounded-full ui-raised p-1 data-[orientation=vertical]:flex-col",
        className,
      )}
    >
      {children}
    </Root>
  );
}

/** An icon button with its name as a tooltip, and its shortcut if it has one. */
export function ToolbarIconButton({
  label,
  shortcut,
  tooltipSide,
  className,
  children,
  ...props
}: Omit<ComponentProps<typeof Button>, "className" | "children"> & {
  label: string;
  shortcut?: string;
  tooltipSide?: "top" | "bottom" | "left" | "right";
  className?: string;
  children: ReactNode;
}) {
  return (
    <Tooltip label={label} shortcut={shortcut} side={tooltipSide} names>
      <Button
        aria-label={label}
        {...props}
        className={cx(
          "grid size-9 place-items-center rounded-full text-ui-soft transition-[background-color,color,scale] duration-150 hover:bg-ui-tint hover:text-ui-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ui-primary active:scale-90 data-[disabled]:opacity-40 [&_svg]:size-4.5",
          className,
        )}
      >
        {children}
      </Button>
    </Tooltip>
  );
}

export function ToolbarSeparator() {
  return (
    <Separator className="mx-0.5 h-5 w-px bg-ui-line data-[orientation=horizontal]:my-0.5 data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-5" />
  );
}
