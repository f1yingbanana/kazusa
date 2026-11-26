"use client";

import {
  Tree as Root,
  TreeGroup,
  TreeItem as Item,
  TreeItemIndicator,
  TreeItemLabel,
} from "@ui-sdk/react/tree";
import { ChevronRightIcon } from "lucide-react";
import type { ComponentProps, ReactElement, ReactNode } from "react";
import { cx } from "./cx";

export { createTreeController } from "@ui-sdk/react/tree";

export function Tree(props: Omit<ComponentProps<typeof Root>, "className">) {
  return <Root {...props} className="flex flex-col" />;
}

/**
 * One row of a tree and, for a branch, what is in it. The row indents by its
 * depth; a branch's chevron turns as it opens, and its children unfold to their
 * height. `render` makes the row a link. A `heading` row is a shelf the rest
 * stand on.
 */
export function TreeRow({
  value,
  label,
  render,
  leading,
  trailing,
  heading = false,
  children,
}: {
  value: string;
  /** The words typing jumps to. */
  label: string;
  render?: ReactElement;
  leading?: ReactNode;
  trailing?: ReactNode;
  heading?: boolean;
  /** The rows inside it, for a branch. */
  children?: ReactNode;
}) {
  return (
    <Item value={value} label={label} className="outline-none">
      <TreeItemLabel
        render={render}
        className={cx(
          "group/row flex min-h-8.5 cursor-default items-center gap-2 rounded-[0.75rem] ps-[calc((var(--tree-level)-1)*0.875rem+0.25rem)] pe-2 text-[0.875rem] text-ui-ink outline-none select-none hover:bg-ui-tint data-current:bg-ui-surface data-current:font-bold data-current:inset-ring-2 data-current:inset-ring-ui-primary [[data-slot=tree-item]:focus-visible>&]:outline-2 [[data-slot=tree-item]:focus-visible>&]:-outline-offset-2 [[data-slot=tree-item]:focus-visible>&]:outline-ui-primary",
          heading ? "mt-2 min-h-9 font-extrabold" : "font-semibold",
        )}
      >
        {children ? (
          <TreeItemIndicator className="-me-1 grid size-5 shrink-0 place-items-center rounded-full text-ui-soft transition-transform duration-200 ease-[cubic-bezier(0.3,1.3,0.5,1)] hover:bg-ui-line data-expanded:rotate-90 motion-reduce:transition-none rtl:-scale-x-100 [&_svg]:size-3.5">
            <ChevronRightIcon aria-hidden />
          </TreeItemIndicator>
        ) : (
          <span aria-hidden className="w-4 shrink-0" />
        )}
        {leading}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {trailing}
      </TreeItemLabel>
      {children ? (
        <TreeGroup className="h-(--tree-group-height) overflow-hidden transition-[height] duration-200 ease-[cubic-bezier(0.2,0.9,0.3,1)] data-ending-style:h-0 data-starting-style:h-0 motion-reduce:transition-none">
          {children}
        </TreeGroup>
      ) : null}
    </Item>
  );
}
