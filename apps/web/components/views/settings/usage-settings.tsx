'use client'

import { useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { UsageResponse } from '@kazusa/client'
import { Unavailable } from '@/components/entities/source-state'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useUsage } from '@/hooks/use-brain'
import { useCharacters } from '@/hooks/use-characters'
import { useSelection } from '@/hooks/use-url-state'
import { formatCost, formatTokens } from '@/lib/format'
import { useSources } from '@/lib/source/provider'
import { cn } from '@/lib/utils'
import { SettingsSection } from './settings-section'

const RANGES = [
  { days: 1, label: 'Today' },
  { days: 7, label: '7d' },
  { days: 30, label: '30d' },
  { days: 90, label: '90d' },
  { days: 3650, label: 'All' },
] as const

const ROW_HEIGHT = 44

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-lg border p-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="font-mono text-xl font-semibold tabular-nums">{value}</span>
      {note ? <span className="truncate text-xs text-muted-foreground">{note}</span> : null}
    </div>
  )
}

/** One series: tokens per real day. Bars grow from a shared baseline. */
function DailyChart({ daily }: { daily: UsageResponse['daily'] }) {
  const peak = Math.max(...daily.map((day) => day.tokens), 1)
  return (
    <>
      <div aria-hidden className="flex h-28 items-end gap-0.5 border-b">
        {daily.map((day) => (
          <Tooltip key={day.date}>
            <TooltipTrigger
              render={<div />}
              className="group flex h-full max-w-8 min-w-0 flex-1 items-end"
            >
              <div
                className="min-h-px w-full rounded-t bg-primary/80 transition-colors group-hover:bg-primary"
                style={{ height: `${(day.tokens / peak) * 100}%` }}
              />
            </TooltipTrigger>
            <TooltipContent>{`${day.date}: ${formatTokens(day.tokens)} tokens · ${formatCost(day.cost)}`}</TooltipContent>
          </Tooltip>
        ))}
      </div>
      <table className="sr-only">
        <caption>Tokens per day</caption>
        <tbody>
          {daily.map((day) => (
            <tr key={day.date}>
              <th scope="row">{day.date}</th>
              <td>{day.tokens}</td>
              <td>{formatCost(day.cost)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}

function ByCharacter({ report }: { report: UsageResponse }) {
  const { byId } = useCharacters()
  const [selection, select] = useSelection()
  const scrollRef = useRef<HTMLDivElement>(null)
  const rows = useMemo(
    () => [...report.byAgent].sort((a, b) => b.totals.totalTokens - a.totals.totalTokens),
    [report.byAgent],
  )
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  })
  const peak = rows[0]?.totals.totalTokens || 1

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No character has used any tokens in this range.</p>
  }
  return (
    <div ref={scrollRef} className="max-h-96 overflow-y-auto rounded-lg border">
      <ul className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((virtual) => {
          const { agentId, totals } = rows[virtual.index]
          const selected = selection?.kind === 'character' && selection.id === agentId
          return (
            <li
              key={agentId}
              className="absolute inset-x-0 top-0"
              style={{ height: virtual.size, transform: `translateY(${virtual.start}px)` }}
            >
              <button
                type="button"
                aria-current={selected ? 'true' : undefined}
                onClick={() => select({ kind: 'character', id: agentId })}
                className={cn(
                  'flex h-full w-full items-center gap-3 px-3 text-left outline-none hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring',
                  selected && 'bg-muted',
                )}
              >
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="truncate text-sm">{byId.get(agentId)?.name ?? agentId}</span>
                  <span aria-hidden className="h-1 overflow-hidden rounded-full bg-muted">
                    <span
                      className="block h-full rounded-full bg-primary/80"
                      style={{ width: `${(totals.totalTokens / peak) * 100}%` }}
                    />
                  </span>
                </span>
                <span className="w-16 text-right font-mono text-xs tabular-nums">{formatTokens(totals.totalTokens)}</span>
                <span className="w-16 text-right font-mono text-xs text-muted-foreground tabular-nums">
                  {formatCost(totals.totalCost)}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/**
 * OpenClaw's usage report, as its Control UI shows it: read from `sessions.usage`
 * through the plugin, never counted here. Days are real days, since spending
 * follows the wall clock and not the sim.
 */
export function UsageSettings() {
  const { resolved } = useSources()
  const [days, setDays] = useState<number>(30)
  const { data: report, error, isLoading, isValidating, settling, refresh } = useUsage(days)

  if (resolved.usage !== 'live') {
    return <Unavailable requires={['usage']} title="Usage needs a live Gateway" />
  }

  const missing = report?.totals.missingCostEntries ?? 0
  // OpenClaw's own bookkeeping rows (delivery mirrors) appear as models with no tokens.
  const models = report?.byModel.filter((entry) => entry.totals.totalTokens > 0) ?? []
  return (
    <div className="flex flex-col">
      <SettingsSection
        title="Tokens used"
        description="Every model call in this world's session logs, in real days. Costs are OpenClaw's estimates, not your provider's bill."
        action={
          <div role="group" aria-label="Date range" className="flex shrink-0 gap-0.5">
            {RANGES.map((range) => (
              <Button
                key={range.days}
                variant={range.days === days ? 'secondary' : 'ghost'}
                size="sm"
                aria-pressed={range.days === days}
                onClick={() => setDays(range.days)}
              >
                {range.label}
              </Button>
            ))}
          </div>
        }
      >
        {error && !report ? (
          <p className="text-sm text-muted-foreground">{`Couldn't read usage: ${error.message}`}</p>
        ) : isLoading && !report ? (
          <Skeleton className="h-24" />
        ) : report ? (
          <>
            {report.partial ? (
              <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
                {settling ? <Spinner /> : null}
                <span className="min-w-0 flex-1">
                  {settling
                    ? 'Still reading history, so these totals may grow.'
                    : "OpenClaw couldn't read all of its history yet, so these totals may be low."}
                </span>
                {settling ? null : (
                  <Button variant="outline" size="sm" disabled={isValidating} onClick={() => void refresh()}>
                    Refresh
                  </Button>
                )}
              </div>
            ) : null}
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
              <Stat
                label="Total tokens"
                value={formatTokens(report.totals.totalTokens)}
                note={`${formatTokens(report.totals.input)} in · ${formatTokens(report.totals.output)} out`}
              />
              <Stat
                label="Cached tokens"
                value={formatTokens(report.totals.cacheRead)}
                note={`${formatTokens(report.totals.cacheWrite)} written`}
              />
              <Stat
                label="Estimated cost"
                value={formatCost(report.totals.totalCost)}
                note={missing > 0 ? `${missing} ${missing === 1 ? 'call' : 'calls'} without a price` : undefined}
              />
              <Stat
                label="Sessions"
                value={report.sessionCount.toLocaleString()}
                note={`${report.messages.toolCalls.toLocaleString()} tool calls`}
              />
            </div>
            {report.daily.length > 0 ? <DailyChart daily={report.daily} /> : null}
          </>
        ) : null}
      </SettingsSection>
      {report ? (
        <>
          <SettingsSection title="By character" description="Most tokens first. Pick one to open it in the inspector.">
            <ByCharacter report={report} />
          </SettingsSection>
          <SettingsSection title="By model">
            {models.length === 0 ? (
              <p className="text-sm text-muted-foreground">No model calls in this range.</p>
            ) : (
              <ul className="divide-y rounded-lg border">
                {models.map((entry) => (
                  <li key={`${entry.provider}/${entry.model}`} className="flex items-center gap-3 px-3 py-2.5">
                    <span className="min-w-0 flex-1 truncate font-mono text-xs">
                      {[entry.provider, entry.model].filter(Boolean).join('/') || 'Unknown model'}
                    </span>
                    <span className="font-mono text-xs text-muted-foreground tabular-nums">{`${entry.count.toLocaleString()} ${entry.count === 1 ? 'call' : 'calls'}`}</span>
                    <span className="w-16 text-right font-mono text-xs tabular-nums">{formatTokens(entry.totals.totalTokens)}</span>
                    <span className="w-16 text-right font-mono text-xs text-muted-foreground tabular-nums">
                      {formatCost(entry.totals.totalCost)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </SettingsSection>
        </>
      ) : null}
    </div>
  )
}
