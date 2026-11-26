"use client";

import {
  MenuContent as Content,
  MenuItem as Item,
  MenuItemIcon,
  MenuSeparator as Separator,
} from "@ui-sdk/react/menu";
import type { ComponentProps, ReactNode } from "react";
import { cx } from "./cx";
import { POPUP } from "./popup";

export {
  createMenuController,
  Menu,
  MenuContextTrigger,
  MenuTrigger,
} from "@ui-sdk/react/menu";

/*
  Concentric corners: the menu's radius is the item's plus the menu's padding.
  A compact menu, opened at the pointer by a right click, is smaller and only
  fades, so it reads as a quick aside rather than a dropdown.
*/
export function MenuContent({
  compact = false,
  ...props
}: Omit<ComponentProps<typeof Content>, "className"> & { compact?: boolean }) {
  return (
    <Content
      {...props}
      data-compact={compact || undefined}
      className={cx(
        POPUP,
        compact
          ? "w-auto min-w-44 gap-px rounded-[calc(0.5rem+0.25rem)] p-1 duration-100 data-[starting-style]:scale-100 data-[ending-style]:scale-100"
          : "w-auto min-w-48 gap-0.5 rounded-[calc(0.625rem+0.3125rem)] p-[0.3125rem]",
      )}
    />
  );
}

/**
 * An icon with `data-on` is drawn filled, for an item that is switched on.
 * `danger` is for one that can't be taken back lightly, like leaving.
 */
export function MenuItem({
  icon,
  danger = false,
  children,
  ...props
}: Omit<ComponentProps<typeof Item>, "className" | "children"> & {
  icon?: ReactNode;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <Item
      {...props}
      data-danger={danger || undefined}
      className="flex h-8.5 cursor-default items-center gap-2.5 rounded-[0.625rem] px-2.5 text-sm font-semibold outline-none in-data-compact:h-7 in-data-compact:gap-2 in-data-compact:rounded-[0.5rem] in-data-compact:px-2 in-data-compact:text-[0.8125rem] data-danger:text-ui-danger data-highlighted:bg-ui-tint data-disabled:opacity-50 [&_svg]:size-4 [&_svg]:text-ui-soft in-data-compact:[&_svg]:size-3.5 data-danger:[&_svg]:text-ui-danger [&_svg[data-on]]:fill-current [&_svg[data-on]]:text-ui-primary"
    >
      {icon ? <MenuItemIcon>{icon}</MenuItemIcon> : null}
      {children}
    </Item>
  );
}

export function MenuSeparator() {
  return (
    <Separator className="mx-1.5 my-1 h-px bg-ui-line in-data-compact:mx-1 in-data-compact:my-0.5" />
  );
}
