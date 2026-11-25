"use client";

import {
  Tooltip as Root,
  TooltipContent,
  TooltipShortcut,
  TooltipTrigger,
} from "@ui-sdk/react/tooltip";
import type { ReactElement, ReactNode } from "react";

/**
 * The app's hint on hover and focus, in place of the browser's `title`: a
 * control's short name, or a line about it (why it's off, what it is).
 * `children` is the control itself.
 */
export function Tooltip({
  label,
  shortcut,
  side = "top",
  names,
  children,
}: {
  label: ReactNode;
  shortcut?: string;
  side?: "top" | "bottom" | "left" | "right";
  /**
   * The control has no name of its own, like an icon button: the tooltip is its
   * name.
   */
  names?: boolean;
  children: ReactElement;
}) {
  return (
    <Root delay={450} shortcut={shortcut} type={names ? "label" : undefined}>
      <TooltipTrigger render={children} />
      <TooltipContent
        side={side}
        sideOffset={8}
        className="z-70 flex max-w-64 origin-(--transform-origin) items-center gap-1.5 rounded-[0.625rem] bg-ui-ink px-2.5 py-1 text-xs leading-[1.45] font-bold text-ui-ground shadow-ui transition-[opacity,scale] duration-150 ease-out data-ending-style:scale-95 data-ending-style:opacity-0 data-instant:transition-none data-starting-style:scale-90 data-starting-style:opacity-0 motion-reduce:transition-none"
      >
        {label}
        {shortcut ? (
          <TooltipShortcut className="font-medium opacity-60" />
        ) : null}
      </TooltipContent>
    </Root>
  );
}
