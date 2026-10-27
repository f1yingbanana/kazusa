'use client'

import { FastForwardIcon, PanelLeftIcon, PauseIcon, Settings2Icon } from 'lucide-react'
import { MockTag } from '@/components/entities/source-state'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useClockActions, useClockAnchor, useSimNow } from '@/hooks/use-clock'
import { formatSimDate, formatSimDateLong, formatSimTime, simPhase } from '@/lib/time/sim'
import { cn } from '@/lib/utils'

const SPEED_PRESETS = [1, 10, 60] as const
const ADVANCE_PRESETS = [
  { minutes: 15, label: '+15 minutes' },
  { minutes: 60, label: '+1 hour' },
  { minutes: 360, label: '+6 hours' },
] as const

function SimClock() {
  const anchor = useClockAnchor()
  const now = useSimNow()
  if (!anchor || now === 0) {
    return <span className="font-mono text-xs text-muted-foreground">Clock unavailable</span>
  }
  return (
    <Tooltip>
      <TooltipTrigger
        render={<time dateTime={new Date(now).toISOString()} />}
        className="flex items-baseline gap-2 font-mono text-sm tabular-nums"
      >
        <span className="hidden text-muted-foreground sm:inline">{formatSimDate(now)}</span>
        <span className="font-medium">{formatSimTime(now)}</span>
        <span className="hidden text-xs text-muted-foreground md:inline">{simPhase(now)}</span>
      </TooltipTrigger>
      <TooltipContent>{`${formatSimDateLong(now)} · simulation time (UTC)`}</TooltipContent>
    </Tooltip>
  )
}

function SpeedControls() {
  const anchor = useClockAnchor()
  const { apply, enabled } = useClockActions()
  const speed = anchor?.clock.speed
  if (!anchor) return null

  return (
    <div className="hidden items-center gap-0.5 rounded-lg border p-0.5 sm:flex" role="group" aria-label="Simulation speed">
      <Button
        variant={speed === 0 ? 'secondary' : 'ghost'}
        size="icon-xs"
        aria-pressed={speed === 0}
        disabled={!enabled}
        onClick={() => apply({ action: 'set_speed', speed: 0 })}
      >
        <PauseIcon />
        <span className="sr-only">Pause</span>
      </Button>
      {SPEED_PRESETS.map((preset) => (
        <Button
          key={preset}
          variant={speed === preset ? 'secondary' : 'ghost'}
          size="xs"
          aria-pressed={speed === preset}
          disabled={!enabled}
          onClick={() => apply({ action: 'set_speed', speed: preset })}
          className="font-mono tabular-nums"
        >
          {`${preset}×`}
        </Button>
      ))}
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-xs" disabled={!enabled} />}>
          <FastForwardIcon />
          <span className="sr-only">Advance clock</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Advance (forward only)</DropdownMenuLabel>
            {ADVANCE_PRESETS.map((preset) => (
              <DropdownMenuItem key={preset.minutes} onClick={() => apply({ action: 'advance', minutes: preset.minutes })}>
                {preset.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

/** Global time and navigation only. Feature controls live inside their stage view. */
export function TopBar({
  onOpenRoster,
  onOpenSettings,
}: {
  onOpenRoster: () => void
  onOpenSettings: () => void
}) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b bg-sidebar px-3">
      <Button variant="ghost" size="icon-sm" className="lg:hidden" onClick={onOpenRoster}>
        <PanelLeftIcon />
        <span className="sr-only">Open sidebar</span>
      </Button>
      {/* World title comes from GET /kazusa/world once it exists (D1). */}
      <h1 className="text-sm font-semibold tracking-tight">Kazusa</h1>

      <div className="flex flex-1 items-center justify-center gap-3">
        <SimClock />
        <SpeedControls />
        <MockTag requires={['clock']} />
      </div>

      <div className="flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger
            render={<span />}
            className={cn(
              'hidden h-6 items-center rounded-md border px-2 font-mono text-[11px] text-muted-foreground sm:inline-flex',
            )}
          >
            Observer
          </TooltipTrigger>
          <TooltipContent>Lens: omniscient observer. Player lens comes later.</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger render={<Button variant="ghost" size="icon-sm" onClick={onOpenSettings} />}>
            <Settings2Icon />
            <span className="sr-only">Connection settings</span>
          </TooltipTrigger>
          <TooltipContent>Connection settings</TooltipContent>
        </Tooltip>
      </div>
    </header>
  )
}
