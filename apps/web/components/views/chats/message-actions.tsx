"use client";

import { useEffect, useRef } from "react";

export { useLongPress } from "@/hooks/use-long-press";
import { CopyIcon, CropIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * What can be done with one message, Discord-style: beside the bubble while the
 * pointer is over its row, or above it after a long press on touch, where the
 * buttons are labeled since there is no tooltip. Sits inside the bubble's own
 * positioned box.
 */
export function MessageActions({
  text,
  align,
  open,
  onClose,
  onScreenshot,
}: {
  text: string;
  align: "start" | "end";
  /** Opened by a long press; hover needs no state. */
  open: boolean;
  onClose: () => void;
  onScreenshot: () => void;
}) {
  const bar = useRef<HTMLDivElement>(null);

  // A tap anywhere else puts it away, as a touch menu should.
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (!bar.current?.contains(event.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open, onClose]);

  const copy = () => {
    onClose();
    navigator.clipboard.writeText(text).then(
      () => toast.success("Copied"),
      () => toast.error("Couldn't copy: the browser blocked the clipboard."),
    );
  };
  const screenshot = () => {
    onClose();
    onScreenshot();
  };

  const actions = [
    { label: "Copy text", short: "Copy", icon: CopyIcon, run: copy },
    {
      label: "Screenshot",
      short: "Screenshot",
      icon: CropIcon,
      run: screenshot,
    },
  ];

  return (
    <div
      ref={bar}
      role="toolbar"
      aria-label="Message actions"
      data-open={open || undefined}
      className={cn(
        "absolute z-20 flex items-center gap-0.5 rounded-lg border bg-popover p-0.5 text-popover-foreground shadow-md",
        // Touch: above the bubble, only once pressed.
        "bottom-full mb-1.5 hidden data-open:flex data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95",
        align === "end" ? "right-0" : "left-0",
        // Mouse: beside the bubble, toward the middle, while its row is hovered.
        "pointer-fine:top-1/2 pointer-fine:bottom-auto pointer-fine:mb-0 pointer-fine:flex pointer-fine:-translate-y-1/2 pointer-fine:opacity-0 pointer-fine:shadow-sm",
        "pointer-fine:pointer-events-none pointer-fine:group-hover/message:pointer-events-auto pointer-fine:group-hover/message:opacity-100 pointer-fine:has-focus-visible:pointer-events-auto pointer-fine:has-focus-visible:opacity-100",
        align === "end"
          ? "pointer-fine:right-full pointer-fine:mr-1.5"
          : "pointer-fine:left-full pointer-fine:ml-1.5",
      )}
    >
      {actions.map(({ label, short, icon: Icon, run }) => (
        <Tooltip key={label}>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="sm"
                onClick={run}
                className="pointer-fine:size-7 pointer-fine:px-0"
              />
            }
          >
            <Icon />
            <span className="pointer-fine:sr-only">{short}</span>
          </TooltipTrigger>
          <TooltipContent className="pointer-coarse:hidden">
            {label}
          </TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}
