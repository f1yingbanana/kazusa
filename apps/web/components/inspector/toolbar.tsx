"use client";

import { Fragment, useLayoutEffect, useRef, useState } from "react";
import { EllipsisIcon, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** One thing a toolbar can do. Its label is the tooltip and the menu item. */
export interface ToolbarAction {
  readonly id: string;
  /** Actions of one group sit together; a menu separates groups. */
  readonly group: string;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly onSelect: () => void;
  readonly disabled?: boolean;
  /** A toggle that is on, such as Watch. */
  readonly pressed?: boolean;
  /** The icon spins: something under way, such as stopping. */
  readonly busy?: boolean;
  /** Always in More, after anything that didn't fit, never a button. */
  readonly inMenu?: boolean;
}

/** `icon-sm` buttons and the gap between them, in pixels. */
const BUTTON = 28;
const GAP = 4;

/**
 * Icon buttons in priority order, as many as fit; the rest go into More, in the
 * same order, ahead of the actions that always live there, a separator between
 * groups. Measured on every resize.
 */
export function Toolbar({
  actions,
  moreLabel,
  className,
}: {
  actions: readonly ToolbarAction[];
  moreLabel: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number>();

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const fits = (count: number) => count * BUTTON + Math.max(0, count - 1) * GAP;
  // Unmeasured, show none rather than overflow: the first resize fills it.
  const room = width ?? 0;
  const buttons = actions.filter((action) => !action.inMenu);
  const pinned = actions.filter((action) => action.inMenu);
  // With More: k buttons and More need (k + 1) buttons and k gaps.
  const beside = Math.max(0, Math.floor((room - BUTTON) / (BUTTON + GAP)));
  const count = pinned.length
    ? Math.min(buttons.length, beside)
    : fits(buttons.length) <= room
      ? buttons.length
      : beside;
  const visible = buttons.slice(0, count);
  const rest = [...buttons.slice(count), ...pinned];

  return (
    <div
      ref={ref}
      role="toolbar"
      className={cn("flex min-w-0 items-center gap-1", className)}
    >
      {visible.map((action) => (
        <Tooltip key={action.id}>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={action.label}
                aria-pressed={action.pressed}
                disabled={action.disabled}
                onClick={action.onSelect}
              />
            }
          >
            <ActionIcon action={action} />
          </TooltipTrigger>
          <TooltipContent>{action.label}</TooltipContent>
        </Tooltip>
      ))}
      {rest.length ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="ghost" size="icon-sm" className="ml-auto" />
            }
          >
            <EllipsisIcon />
            <span className="sr-only">{moreLabel}</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-auto">
            {rest.map((action, index) => (
              <Fragment key={action.id}>
                {index > 0 && rest[index - 1]?.group !== action.group ? (
                  <DropdownMenuSeparator />
                ) : null}
                <DropdownMenuItem
                  disabled={action.disabled}
                  onClick={action.onSelect}
                >
                  <ActionIcon action={action} />
                  {action.label}
                </DropdownMenuItem>
              </Fragment>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}

/** An action's icon: filled while pressed, spinning while busy. */
function ActionIcon({ action }: { action: ToolbarAction }) {
  return (
    <action.icon
      className={cn(
        action.pressed && "fill-current",
        action.busy && "animate-spin",
      )}
    />
  );
}
