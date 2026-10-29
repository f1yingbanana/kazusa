'use client'

import { ArrowDownRightIcon, ArrowUpRightIcon, PauseIcon, TrendingDownIcon } from 'lucide-react'
import type { DesireDefinition, DesireRecord, DesiresConfig } from '@kazusa/client'
import { Fact } from '@/components/entities/fact'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useCharacter, useCharacterStatus } from '@/hooks/use-characters'
import { useSimNow } from '@/hooks/use-clock'
import { useDesireConfig, useDesireRecord } from '@/hooks/use-desires'
import type { EntityRef } from '@/lib/state/entity-ref'
import { desireLabel, levelAt, nextDrop, stateIndex, trendOf, type DesireTrend } from '@/lib/time/desires'
import { formatSimDuration, formatSimTime } from '@/lib/time/sim'
import { cn } from '@/lib/utils'

/**
 * How the character feels, as the brain reads it: one state word per desire.
 * Bars are segmented at the world's state boundaries; the accent marks a
 * desire the current task is moving, with the task's declared target.
 */
export function CharacterDesiresSection({ entity }: { entity: EntityRef }) {
  const character = useCharacter(entity.id)
  const isAgent = character?.kind === 'agent'
  const config = useDesireConfig()
  const record = useDesireRecord(isAgent ? entity.id : undefined)
  const status = useCharacterStatus(isAgent ? entity.id : undefined)
  const now = useSimNow()
  // Offstage, their body waits: levels stand where they were when they left.
  const offstage = status?.onstage === false

  if (!isAgent) {
    return <p className="text-sm text-muted-foreground">Only simulated characters have desires.</p>
  }
  if (!config || now <= 0) {
    return (
      <div className="flex flex-col gap-2.5" aria-hidden>
        {Array.from({ length: 5 }).map((_, index) => (
          <Skeleton key={index} className="h-4" />
        ))}
      </div>
    )
  }

  const at = Math.max(offstage ? (status.offstageSince ?? now) : now, record?.anchorAt ?? 0)
  const drop = offstage ? undefined : nextDrop(config, record, at)

  return (
    <div className="flex flex-col gap-3">
      {offstage ? (
        <Fact icon={PauseIcon}>Paused while offstage</Fact>
      ) : drop ? (
        <Fact icon={TrendingDownIcon}>
          {desireLabel(drop.desire)} turns <span className="font-medium">{drop.state}</span> in{' '}
          <span className="font-mono tabular-nums">{formatSimDuration(drop.at - at)}</span>
        </Fact>
      ) : !record ? (
        <p className="text-sm leading-relaxed text-muted-foreground">
          {`Hasn't started a task yet, so every desire is still ${config.initial}.`}
        </p>
      ) : null}
      <ul className="flex flex-col gap-2.5">
        {config.catalog.map((desire) => (
          <DesireRow key={desire.name} config={config} record={record} desire={desire} at={at} paused={offstage} />
        ))}
      </ul>
    </div>
  )
}

function DesireRow({
  config,
  record,
  desire,
  at,
  paused,
}: {
  config: DesiresConfig
  record: DesireRecord | undefined
  desire: DesireDefinition
  at: number
  /** Offstage: nothing is moving, whatever the task planned. */
  paused: boolean
}) {
  const level = levelAt(config, record, desire, at)
  const index = stateIndex(config, level)
  const state = config.states[index]?.name ?? ''
  const initialIndex = Math.max(
    0,
    config.states.findIndex(({ name }) => name === config.initial),
  )
  const trend = paused ? undefined : trendOf(config, record, desire, at)
  const label = desireLabel(desire.name)
  const TrendIcon = trend?.direction === 'down' ? ArrowDownRightIcon : ArrowUpRightIcon

  return (
    <li className="flex flex-col gap-1">
      <div className="flex items-center gap-3">
        <Tooltip>
          <TooltipTrigger render={<span />} className="w-22 shrink-0 cursor-default truncate text-sm">
            {label}
          </TooltipTrigger>
          <TooltipContent className="max-w-64">{desire.description}</TooltipContent>
        </Tooltip>
        <Meter config={config} level={level} trend={trend} label={label} state={state} pressing={index === 0} />
        <span
          className={cn(
            'flex w-18 shrink-0 items-center justify-end gap-1 font-mono text-xs',
            index === 0
              ? 'font-medium text-foreground'
              : index < initialIndex
                ? 'text-foreground'
                : 'text-muted-foreground',
          )}
        >
          {trend ? <TrendIcon aria-hidden className="size-3 shrink-0 text-primary" /> : null}
          {state}
        </span>
      </div>
      {trend ? (
        <p className="pl-25 font-mono text-[11px] text-muted-foreground tabular-nums">
          {`→ ${trend.targetState} by ${formatSimTime(trend.reachesAt)}`}
        </p>
      ) : null}
    </li>
  )
}

function Meter({
  config,
  level,
  trend,
  label,
  state,
  pressing,
}: {
  config: DesiresConfig
  level: number
  trend: DesireTrend | undefined
  label: string
  state: string
  pressing: boolean
}) {
  const fill = trend ? 'bg-primary' : pressing ? 'bg-foreground' : 'bg-muted-foreground'
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(level)}
      aria-valuetext={trend ? `${state}, moving to ${trend.targetState}` : state}
      className="relative flex min-w-0 flex-1 gap-0.5"
    >
      {config.states.map((segment, index) => {
        const low = segment.min
        const high = config.states[index + 1]?.min ?? 100
        const share = Math.min(1, Math.max(0, (level - low) / Math.max(high - low, 1)))
        return (
          <div
            key={segment.name}
            className="h-1.5 basis-0 overflow-hidden rounded-[2px] bg-muted"
            style={{ flexGrow: Math.max(high - low, 1) }}
          >
            <div className={cn('h-full transition-[width] duration-700', fill)} style={{ width: `${share * 100}%` }} />
          </div>
        )
      })}
      {trend ? (
        <span
          aria-hidden
          className="absolute -top-1 -bottom-1 w-0.5 rounded-full bg-primary"
          style={{ left: `calc(${trend.target}% - 1px)` }}
        />
      ) : null}
    </div>
  )
}
