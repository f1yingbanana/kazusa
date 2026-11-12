"use client";

import type { ComponentProps, ReactNode, RefObject } from "react";
import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import { BookOpenIcon, Minimize2Icon, ScrollTextIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipTrigger } from "@/components/ui/tooltip";
import { SpeedControls } from "@/components/shell/top-bar";
import { useClockActions, useSimNow } from "@/hooks/use-clock";
import { formatSimTime } from "@/lib/time/sim";
import { cn } from "@/lib/utils";
import { SCRIM } from "./scrim";
import { EXIT_ATTRIBUTE } from "./use-scene-fullscreen";

/** The flat chip both corners sit on, over the art. */
const CHIP =
  "absolute top-2 z-50 flex h-[2.125rem] items-center rounded-lg border border-foreground/10 shadow-sm sm:top-3";

/**
 * Over the top corners of a scene in full screen, where the top bar and the
 * header are hidden: the sim time on the left, quietly, with the top bar's
 * clock controls beside it for a viewer who may use them, and on the right one
 * cluster of icon buttons (the backlog, reading mode, the way out), each named
 * and with a tooltip.
 */
export function FullscreenControls({
  onExit,
  container,
  onBacklog,
  reading,
}: {
  onExit: () => void;
  /** The full-screen element: tooltips go inside it, or they would not show. */
  container: RefObject<HTMLElement | null>;
  /** Opens the transcript over the scene. */
  onBacklog?: () => void;
  /** Reading mode, when this viewer may control the clock. */
  reading?: ReadingToggleProps;
}) {
  const now = useSimNow();
  const { enabled } = useClockActions();
  return (
    <>
      {/* The time, and for a viewer who may control the clock the top bar's
          own controls beside it, on one chip. */}
      <div
        className={cn(CHIP, "left-2 gap-1 pr-0.5 pl-2.5 sm:left-3")}
        style={{ backgroundColor: SCRIM }}
      >
        <span className="font-mono text-xs text-muted-foreground tabular-nums">
          <span className="sr-only">Simulation time </span>
          {formatSimTime(now)}
        </span>
        {enabled ? (
          <>
            <span aria-hidden className="mx-1 h-4 w-px bg-foreground/10" />
            <SpeedControls embedded container={container} />
          </>
        ) : null}
      </div>
      <div
        role="toolbar"
        aria-label="Scene"
        className={cn(CHIP, "right-2 gap-0.5 p-0.5 sm:right-3")}
        style={{ backgroundColor: SCRIM }}
      >
        {onBacklog ? (
          <SceneControl
            label="Backlog"
            hint="Backlog: everything said here"
            container={container}
            onClick={onBacklog}
          >
            <ScrollTextIcon />
          </SceneControl>
        ) : null}
        {reading ? (
          <SceneControl
            label="Reading mode"
            hint={READING_HINT}
            container={container}
            aria-pressed={reading.on}
            className={cn(reading.on && "bg-muted text-foreground")}
            onClick={(event) => {
              // As in the header: Space then advances, not this button.
              if (!reading.on) event.currentTarget.blur();
              reading.onToggle();
            }}
          >
            <BookOpenIcon />
          </SceneControl>
        ) : null}
        <SceneControl
          label="Exit full screen"
          hint="Exit full screen (Esc)"
          container={container}
          onClick={onExit}
          {...{ [EXIT_ATTRIBUTE]: "" }}
        >
          <Minimize2Icon />
        </SceneControl>
      </div>
    </>
  );
}

export interface ReadingToggleProps {
  readonly on: boolean;
  readonly onToggle: () => void;
}

/** What reading mode does, in plain words, for its tooltip. */
export const READING_HINT =
  "Reading mode: the world waits while a line is unread. Click or press Space for the next.";

/**
 * An icon button over the scene, named by `label`, with a tooltip drawn inside
 * `container` (anything portalled to the page's body is hidden while the stage
 * is the browser's full-screen element).
 */
export function SceneControl({
  label,
  hint = label,
  container,
  children,
  ...props
}: {
  label: string;
  /** The tooltip, when it says more than the name. */
  hint?: string;
  container: RefObject<HTMLElement | null>;
  children: ReactNode;
} & Omit<ComponentProps<typeof Button>, "children">) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<Button variant="ghost" size="icon-sm" {...props} />}
      >
        {children}
        <span className="sr-only">{label}</span>
      </TooltipTrigger>
      <TooltipPrimitive.Portal container={container}>
        <TooltipPrimitive.Positioner
          side="bottom"
          sideOffset={6}
          className="isolate z-50"
        >
          <TooltipPrimitive.Popup className="z-50 rounded-md bg-foreground px-2.5 py-1 text-xs text-background data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0">
            {hint}
          </TooltipPrimitive.Popup>
        </TooltipPrimitive.Positioner>
      </TooltipPrimitive.Portal>
    </Tooltip>
  );
}
