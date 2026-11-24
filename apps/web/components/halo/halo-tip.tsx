"use client";

import { Tooltip, TooltipContent, TooltipTrigger } from "@ui-sdk/react/tooltip";
import type { ReactElement, ReactNode } from "react";

/**
 * The app's own hint in place of the browser's `title`. `type="label"` when the
 * tip repeats the control's name, so screen readers hear it once.
 */
export function HaloTip({
  tip,
  side,
  type,
  disabled,
  children,
}: {
  tip: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  type?: "label" | "description";
  disabled?: boolean;
  children: ReactElement;
}) {
  return (
    <Tooltip type={type} disabled={disabled} delay={400}>
      <TooltipTrigger render={children} />
      <TooltipContent className="halo-tip" side={side} sideOffset={6}>
        {tip}
      </TooltipContent>
    </Tooltip>
  );
}
