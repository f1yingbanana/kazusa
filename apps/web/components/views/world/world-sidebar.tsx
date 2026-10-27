'use client'

import { useCallback, useMemo, useState } from 'react'
import { BrainIcon, FolderIcon, ListFilterIcon, StarIcon, UsersIcon, type LucideIcon } from 'lucide-react'
import { CharacterRow } from '@/components/entities/character-row'
import { MockTag } from '@/components/entities/source-state'
import { taskIcon } from '@/components/entities/task-icon'
import { PanelToolbar } from '@/components/shell/panel-toolbar'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { useNavigate, useSelection } from '@/hooks/use-url-state'
import { filterCharacters, type KindFilter } from '@/lib/state/grouping'
import type { SectionSidebarProps } from '@/lib/registry/types'
import { useWatchlist } from '@/lib/state/watchlist'
import { cn } from '@/lib/utils'
import {
  ALL_FOLDER,
  DIMENSIONS,
  KIND_LABELS,
  WATCH_FOLDER,
  busySummary,
  useWorldFolders,
  useWorldParams,
  type Dimension,
} from './world-state'

function FolderRow({
  icon: Icon,
  label,
  count,
  hint,
  active,
  onOpen,
}: {
  icon: LucideIcon
  label: string
  count: number
  hint?: string | null
  active: boolean
  onOpen: () => void
}) {
  return (
    <button
      type="button"
      aria-current={active ? 'true' : undefined}
      onClick={onOpen}
      className={cn(
        'flex h-11 w-full items-center gap-2.5 rounded-md px-2.5 text-left transition-colors hover:bg-sidebar-accent/70',
        active && 'bg-sidebar-accent text-sidebar-accent-foreground',
      )}
    >
      <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm leading-tight">{label}</span>
        {hint ? <span className="truncate font-mono text-[11px] leading-tight text-primary">{hint}</span> : null}
      </span>
      <span className="font-mono text-xs text-muted-foreground tabular-nums">{count}</span>
    </button>
  )
}

function groupIcon(by: Dimension, key: string): LucideIcon {
  if (by === 'activity') return taskIcon(key === '__none' ? undefined : key)
  if (by === 'brain') return BrainIcon
  return FolderIcon
}

/**
 * World's sidebar: folders of characters. Watchlist and Everyone are fixed;
 * the rest come from the chosen dimension. Typing searches characters
 * directly, so jumping to someone never needs a folder.
 */
export function WorldSidebar({
  onNavigated,
  asFirstScreen = false,
}: SectionSidebarProps & {
  /** Rendered as the narrow-screen first screen, where nothing is open yet. */
  asFirstScreen?: boolean
}) {
  const navigate = useNavigate()
  const [selection, select] = useSelection()
  const watchlist = useWatchlist()
  const { by, kind, folder: openFolder, folderParam } = useWorldParams()
  const folder = asFirstScreen && folderParam === null ? null : openFolder
  const { characters, groups, watched, everyone, isLoading, error } = useWorldFolders(by, kind)
  const [query, setQuery] = useState('')

  const matches = useMemo(
    () => (query.trim() ? filterCharacters(characters, 'everyone', query).filter((c) => c.kind !== 'player') : []),
    [characters, query],
  )
  const watchSet = useMemo(() => new Set(watchlist), [watchlist])
  const selectedId = selection?.kind === 'character' ? selection.id : null
  const customized = kind !== 'simulated' || by !== 'affiliation'

  function open(key: string) {
    navigate({ view: 'world', 'world.in': key })
    onNavigated?.()
  }

  const onSelect = useCallback(
    (id: string) => {
      select({ kind: 'character', id })
      onNavigated?.()
    },
    [select, onNavigated],
  )

  // A group key only means something within its dimension; switching drops it.
  const groupOpen = folderParam !== null && folderParam !== ALL_FOLDER && folderParam !== WATCH_FOLDER
  function setBy(next: Dimension) {
    navigate({ 'world.by': next === 'affiliation' ? null : next, ...(groupOpen ? { 'world.in': null } : {}) }, 'replace')
  }
  function setKind(next: KindFilter) {
    navigate({ 'world.kind': next === 'simulated' ? null : next }, 'replace')
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PanelToolbar
        query={query}
        onQueryChange={setQuery}
        placeholder={characters.length ? `Search ${characters.length} characters` : 'Search characters'}
        label="Search characters"
      >
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" className="relative" />}>
            <ListFilterIcon />
            {customized ? (
              <span aria-hidden className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-primary" />
            ) : null}
            <span className="sr-only">{customized ? 'Folders and filters (changed)' : 'Folders and filters'}</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Folders by</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={by} onValueChange={(value) => setBy(value as Dimension)}>
                {DIMENSIONS.map((d) => (
                  <DropdownMenuRadioItem key={d.id} value={d.id}>
                    {d.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>Show</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={kind} onValueChange={(value) => setKind(value as KindFilter)}>
                {(Object.keys(KIND_LABELS) as KindFilter[]).map((value) => (
                  <DropdownMenuRadioItem key={value} value={value}>
                    {KIND_LABELS[value]}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </PanelToolbar>

      {query.trim() ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-1 pb-2">
          <h3 className="px-3 pt-1 pb-1 font-mono text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            {matches.length === 1 ? '1 match' : `${matches.length} matches`}
          </h3>
          {matches.length === 0 ? (
            <p className="px-3 py-4 text-sm text-muted-foreground">No characters match that search.</p>
          ) : (
            matches.slice(0, 60).map((character) => (
              <CharacterRow
                key={character.id}
                character={character}
                selected={selectedId === character.id}
                starred={watchSet.has(character.id)}
                onSelect={onSelect}
              />
            ))
          )}
        </div>
      ) : isLoading ? (
        <div className="flex flex-col gap-1 px-3 py-1" aria-hidden>
          {Array.from({ length: 8 }).map((_, index) => (
            <Skeleton key={index} className="h-9" />
          ))}
        </div>
      ) : error ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">{error.message}</p>
      ) : (
        <nav aria-label="Folders" className="flex min-h-0 flex-1 flex-col overflow-y-auto px-1.5 pb-2">
          <FolderRow
            icon={StarIcon}
            label="Watchlist"
            count={watched.length}
            hint={busySummary(watched)}
            active={folder === WATCH_FOLDER}
            onOpen={() => open(WATCH_FOLDER)}
          />
          <FolderRow
            icon={UsersIcon}
            label="Everyone"
            count={everyone.length}
            hint={busySummary(everyone)}
            active={folder === ALL_FOLDER}
            onOpen={() => open(ALL_FOLDER)}
          />
          <div className="flex items-center justify-between gap-2 px-2.5 pt-4 pb-1">
            <h3 className="font-mono text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
              {DIMENSIONS.find((d) => d.id === by)?.label}
            </h3>
            <MockTag requires={['characters', 'status']} />
          </div>
          {groups.map((group) => (
            <FolderRow
              key={group.key}
              icon={groupIcon(by, group.key)}
              label={group.label}
              count={group.members.length}
              hint={busySummary(group.members)}
              active={folder === group.key}
              onOpen={() => open(group.key)}
            />
          ))}
        </nav>
      )}
    </div>
  )
}
