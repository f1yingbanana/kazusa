"use client";

import type { RefObject } from "react";
import { FastForwardIcon, PauseIcon, SearchIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useClockActions, useClockAnchor, useSimNow } from "@/hooks/use-clock";
import {
  formatSimDate,
  formatSimDateLong,
  formatSimTime,
  simPhase,
} from "@/lib/time/sim";
import { SocialLinks } from "./social-links";
import { cn } from "@/lib/utils";

const SPEED_PRESETS = [1, 10, 60] as const;
const ADVANCE_PRESETS = [
  { minutes: 15, label: "+15 minutes" },
  { minutes: 60, label: "+1 hour" },
  { minutes: 360, label: "+6 hours" },
] as const;

function SimClock() {
  const anchor = useClockAnchor();
  const now = useSimNow();
  if (!anchor || now === 0) {
    return (
      <span className="font-mono text-xs text-muted-foreground">
        Clock unavailable
      </span>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger
        render={<time dateTime={new Date(now).toISOString()} />}
        className="flex items-baseline gap-2 font-mono text-sm tabular-nums"
      >
        <span className="hidden text-muted-foreground sm:inline">
          {formatSimDate(now)}
        </span>
        <span className="font-medium">{formatSimTime(now)}</span>
        <span className="hidden text-xs text-muted-foreground md:inline">
          {simPhase(now)}
        </span>
      </TooltipTrigger>
      <TooltipContent>{`${formatSimDateLong(now)} · simulation time (UTC)`}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Pause, the speeds and advancing the clock: here, and over a scene in full
 * screen (`embedded`: always shown, on the surface it sits on, and only to a
 * viewer who may use it; its menu drawn inside `container`, the full-screen
 * element, where anything on the page's body is hidden).
 */
export function SpeedControls({
  embedded = false,
  container,
}: {
  embedded?: boolean;
  container?: RefObject<HTMLElement | null>;
}) {
  const anchor = useClockAnchor();
  const { apply, enabled } = useClockActions();
  const speed = anchor?.clock.speed;
  if (!anchor || (embedded && !enabled)) return null;

  return (
    <div
      className={cn(
        "items-center gap-0.5",
        embedded ? "flex" : "hidden rounded-lg border p-0.5 sm:flex",
      )}
      role="group"
      aria-label="Simulation speed"
    >
      <Button
        variant={speed === 0 ? "secondary" : "ghost"}
        size="icon-xs"
        aria-pressed={speed === 0}
        disabled={!enabled}
        onClick={() => apply({ action: "set_speed", speed: 0 })}
      >
        <PauseIcon />
        <span className="sr-only">Pause</span>
      </Button>
      {SPEED_PRESETS.map((preset) => (
        <Button
          key={preset}
          variant={speed === preset ? "secondary" : "ghost"}
          size="xs"
          aria-pressed={speed === preset}
          disabled={!enabled}
          onClick={() => apply({ action: "set_speed", speed: preset })}
          className="font-mono tabular-nums"
        >
          {`${preset}×`}
        </Button>
      ))}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="icon-xs" disabled={!enabled} />}
        >
          <FastForwardIcon />
          <span className="sr-only">Advance clock</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40" container={container}>
          <DropdownMenuGroup>
            <DropdownMenuLabel>Advance (forward only)</DropdownMenuLabel>
            {ADVANCE_PRESETS.map((preset) => (
              <DropdownMenuItem
                key={preset.minutes}
                onClick={() =>
                  apply({ action: "advance", minutes: preset.minutes })
                }
              >
                {preset.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/**
 * Global time only. Sections, Settings included, live on the rail (or the
 * bottom tab bar on phones); feature controls live inside their section.
 */
export function TopBar({ onOpenPalette }: { onOpenPalette: () => void }) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b bg-sidebar px-3">
      {/* World title comes from GET /kazusa/world once it exists (D1). */}
      <h1 className="flex items-center gap-1.5 text-sm font-semibold tracking-tight">
        {/* Noto Color Emoji 🐱, same artwork as the favicon (app/icon.png). */}
        <img src="/logo.png" alt="" width={20} height={20} className="size-5" />
        Kazusa
      </h1>

      <div className="flex flex-1 items-center justify-center gap-3">
        <SimClock />
        <SpeedControls />
      </div>

      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon-sm"
          className="md:hidden"
          onClick={onOpenPalette}
        >
          <SearchIcon />
          <span className="sr-only">Jump to anything</span>
        </Button>
        <SocialLinks />
      </div>
    </header>
  );
}
