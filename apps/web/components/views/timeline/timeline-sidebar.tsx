'use client'

import { CheckIcon, StarIcon, UsersIcon, XIcon, type LucideIcon } from 'lucide-react'
import type { JournalKind } from '@kazusa/client'
import { CharacterChip } from '@/components/entities/chips'
import { MockTag } from '@/components/entities/source-state'
import { Button } from '@/components/ui/button'
import { useListParam, useNavigate, useParam } from '@/hooks/use-url-state'
import {
  effectiveTimelineKinds,
  TIMELINE_KIND_LIST,
  timelineKindsParam,
} from '@/lib/registry/timeline-kinds'
import { useWatchlist } from '@/lib/state/watchlist'
import { cn } from '@/lib/utils'

const ALL_KINDS = TIMELINE_KIND_LIST.map((kind) => kind.kind)

function OptionRow({
  role,
  checked,
  disabled,
  icon: Icon,
  label,
  hint,
  onToggle,
}: {
  role: 'radio' | 'checkbox'
  checked: boolean
  disabled?: boolean
  icon: LucideIcon
  label: string
  hint?: string
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      role={role}
      aria-checked={checked}
      disabled={disabled}
      onClick={onToggle}
      className="flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-sm transition-colors hover:bg-sidebar-accent/70 disabled:opacity-60"
    >
      <span
        aria-hidden
        className={cn(
          'flex size-4 shrink-0 items-center justify-center border',
          role === 'radio' ? 'rounded-full' : 'rounded-sm',
          checked ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/50',
        )}
      >
        {checked ? <CheckIcon className="size-3" /> : null}
      </span>
      <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {hint ? <span className="font-mono text-xs text-muted-foreground tabular-nums">{hint}</span> : null}
    </button>
  )
}

function SectionLabel({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h3 id={id} className="px-2.5 pt-4 pb-1 font-mono text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
      {children}
    </h3>
  )
}

/**
 * Timeline's sidebar: who to follow and which event kinds to show. Every
 * control writes `tl.*` URL params, so filters are shareable and survive reloads.
 * No kinds param means the default set (everything except messages); any
 * other selection is stored explicitly.
 */
export function TimelineSidebar() {
  const navigate = useNavigate()
  const actorParam = useListParam('tl.actors')
  const kindParam = useListParam('tl.kinds') as JournalKind[]
  const watchOnly = useParam('tl.watch') === '1'
  const watchlist = useWatchlist()
  const effectiveKinds = effectiveTimelineKinds(kindParam)
  const hasFilters = actorParam.length > 0 || kindParam.length > 0 || watchOnly

  function patch(next: Record<string, string | null>) {
    navigate({ view: 'timeline', ...next }, 'replace')
  }

  function toggleKind(kind: JournalKind) {
    const next = effectiveKinds.includes(kind) ? effectiveKinds.filter((k) => k !== kind) : [...effectiveKinds, kind]
    // Keep registry order so the param is stable.
    patch({ 'tl.kinds': timelineKindsParam(ALL_KINDS.filter((k) => next.includes(k))) })
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center justify-between gap-2 px-3.5">
        <h2 className="text-sm font-semibold">Filters</h2>
        <div className="flex items-center gap-1.5">
          <MockTag requires={['timeline']} />
          {hasFilters ? (
            <Button
              variant="ghost"
              size="xs"
              onClick={() => patch({ 'tl.actors': null, 'tl.kinds': null, 'tl.watch': null })}
            >
              Clear
            </Button>
          ) : null}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-1.5 pb-3">
        <SectionLabel id="tl-following">Following</SectionLabel>
        <div role="radiogroup" aria-labelledby="tl-following" className="flex flex-col">
          <OptionRow
            role="radio"
            checked={!watchOnly && actorParam.length === 0}
            icon={UsersIcon}
            label="Everyone"
            onToggle={() => patch({ 'tl.watch': null, 'tl.actors': null })}
          />
          <OptionRow
            role="radio"
            checked={watchOnly}
            icon={StarIcon}
            label="Watchlist"
            hint={String(watchlist.length)}
            onToggle={() => patch({ 'tl.watch': '1', 'tl.actors': null })}
          />
        </div>
        {!watchOnly && actorParam.length > 0 ? (
          <ul aria-label="Selected characters" className="flex flex-col gap-1 px-2.5 pt-2">
            {actorParam.map((id) => (
              <li key={id} className="flex items-center justify-between gap-1 rounded-md border pr-0.5">
                <CharacterChip id={id} className="min-w-0" />
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => patch({ 'tl.actors': actorParam.filter((a) => a !== id).join(',') || null })}
                >
                  <XIcon />
                  <span className="sr-only">Stop following</span>
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
        {watchOnly && watchlist.length === 0 ? (
          <p className="px-2.5 pt-1 text-xs leading-relaxed text-muted-foreground">
            Star characters in World to follow them here.
          </p>
        ) : null}

        <SectionLabel id="tl-kinds">Show</SectionLabel>
        <div role="group" aria-labelledby="tl-kinds" className="flex flex-col">
          {TIMELINE_KIND_LIST.map((kind) => {
            const checked = effectiveKinds.includes(kind.kind)
            return (
              <OptionRow
                key={kind.kind}
                role="checkbox"
                checked={checked}
                disabled={checked && effectiveKinds.length === 1}
                icon={kind.icon}
                label={kind.label}
                onToggle={() => toggleKind(kind.kind)}
              />
            )
          })}
        </div>
      </div>
    </div>
  )
}
