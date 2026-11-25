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

export { Menu, MenuTrigger } from "@ui-sdk/react/menu";

/* Concentric corners: the menu's radius is the item's plus the menu's padding. */
export function MenuContent(
  props: Omit<ComponentProps<typeof Content>, "className">,
) {
  return (
    <Content
      {...props}
      className={cx(
        POPUP,
        "w-auto min-w-48 gap-0.5 rounded-[calc(0.625rem+0.3125rem)] p-[0.3125rem]",
      )}
    />
  );
}

/** An icon with `data-on` is drawn filled, for an item that is switched on. */
export function MenuItem({
  icon,
  children,
  ...props
}: Omit<ComponentProps<typeof Item>, "className" | "children"> & {
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Item
      {...props}
      className="flex h-8.5 cursor-default items-center gap-2.5 rounded-[0.625rem] px-2.5 text-sm font-semibold outline-none data-highlighted:bg-ui-tint data-disabled:opacity-50 [&_svg]:size-4 [&_svg]:text-ui-soft [&_svg[data-on]]:fill-current [&_svg[data-on]]:text-ui-primary"
    >
      {icon ? <MenuItemIcon>{icon}</MenuItemIcon> : null}
      {children}
    </Item>
  );
}

export function MenuSeparator() {
  return <Separator className="mx-1.5 my-1 h-px bg-ui-line" />;
}
