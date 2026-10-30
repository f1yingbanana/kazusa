'use client'

import { SearchIcon } from 'lucide-react'
import { Kbd } from '@/components/ui/kbd'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useActiveView } from '@/hooks/use-active-view'
import { useNavigate } from '@/hooks/use-url-state'
import type { StageView } from '@/lib/registry/types'
import { STAGE_VIEWS } from '@/lib/registry/views'
import { cn } from '@/lib/utils'

const SECTIONS = [...STAGE_VIEWS].sort((a, b) => a.order - b.order)
const WORLD_SECTIONS = SECTIONS.filter((view) => view.placement !== 'end')
const APP_SECTIONS = SECTIONS.filter((view) => view.placement === 'end')

function RailItem({ view, current, onSelect }: { view: StageView; current: boolean; onSelect: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<button type="button" aria-current={current ? 'page' : undefined} onClick={onSelect} />}
        className={cn(
          'relative flex size-10 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
          current && 'bg-accent text-foreground',
        )}
      >
        {current ? <span aria-hidden className="absolute top-2.5 bottom-2.5 -left-2 w-0.5 rounded-full bg-primary" /> : null}
        <view.icon className="size-5" />
        <span className="sr-only">{view.label}</span>
        {view.badge ? (
          <span className="absolute -top-0.5 -right-0.5">
            <view.badge />
          </span>
        ) : null}
      </TooltipTrigger>
      <TooltipContent side="right">{view.label}</TooltipContent>
    </Tooltip>
  )
}

/**
 * Vertical icon rail (md and up). Picks the section; the section owns the
 * sidebar. The world's sections sit at the top; the app's own (Settings) at
 * the bottom, under search.
 */
export function SectionRail({ onOpenPalette }: { onOpenPalette: () => void }) {
  const active = useActiveView()
  const navigate = useNavigate()

  return (
    <nav aria-label="Sections" className="hidden w-14 shrink-0 flex-col items-center gap-1 border-r py-2 md:flex">
      {WORLD_SECTIONS.map((view) => (
        <RailItem key={view.id} view={view} current={view.id === active.id} onSelect={() => navigate({ view: view.id })} />
      ))}

      <div className="flex-1" />

      <Tooltip>
        <TooltipTrigger
          render={<button type="button" onClick={onOpenPalette} />}
          className="flex size-10 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <SearchIcon className="size-5" />
          <span className="sr-only">Jump to anything</span>
        </TooltipTrigger>
        <TooltipContent side="right" className="flex items-center gap-2">
          Jump to anything
          <Kbd>⌘K</Kbd>
        </TooltipContent>
      </Tooltip>

      {APP_SECTIONS.map((view) => (
        <RailItem key={view.id} view={view} current={view.id === active.id} onSelect={() => navigate({ view: view.id })} />
      ))}
    </nav>
  )
}

/** Bottom tab bar below md, replacing the rail. */
export function SectionTabs() {
  const active = useActiveView()
  const navigate = useNavigate()

  return (
    <nav aria-label="Sections" className="flex shrink-0 border-t bg-sidebar pb-[env(safe-area-inset-bottom)] md:hidden">
      {SECTIONS.map((view) => {
        const current = view.id === active.id
        return (
          <button
            key={view.id}
            type="button"
            aria-current={current ? 'page' : undefined}
            onClick={() => navigate({ view: view.id })}
            className={cn(
              'flex h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] text-muted-foreground',
              current && 'text-foreground',
            )}
          >
            <span className="relative">
              <view.icon className={cn('size-5', current && 'text-primary')} />
              {view.badge ? (
                <span className="absolute -top-1.5 left-3">
                  <view.badge />
                </span>
              ) : null}
            </span>
            {view.label}
          </button>
        )
      })}
    </nav>
  )
}
