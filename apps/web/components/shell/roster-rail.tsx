'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ChevronDownIcon, ChevronRightIcon, ListFilterIcon, SearchIcon } from 'lucide-react'
import { CharacterRow } from '@/components/entities/character-row'
import { MockTag } from '@/components/entities/source-state'
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
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Skeleton } from '@/components/ui/skeleton'
import { useCharacters, useStatusVersion } from '@/hooks/use-characters'
import { useSelection } from '@/hooks/use-url-state'
import { statusStore } from '@/lib/live/state'
import {
  GROUP_LABELS,
  filterCharacters,
  groupCharacters,
  type GroupBy,
  type KindFilter,
} from '@/lib/state/grouping'
import { useWatchlist } from '@/lib/state/watchlist'
import { cn } from '@/lib/utils'
import type { CharacterSummary } from '@kazusa/client'

type Row =
  | { readonly type: 'header'; readonly key: string; readonly label: string; readonly count: number; readonly collapsed: boolean }
  | { readonly type: 'character'; readonly key: string; readonly character: CharacterSummary }

const KIND_LABELS: Record<KindFilter, string> = {
  simulated: 'Simulated',
  npc: 'NPCs',
  everyone: 'Everyone',
}

export function RosterRail({ onSelected }: { onSelected?: () => void }) {
  const { characters, byId, isLoading, error } = useCharacters()
  const [selection, select] = useSelection()
  const watchlist = useWatchlist()
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<KindFilter>('simulated')
  const [groupBy, setGroupBy] = useState<GroupBy>('none')
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const statusVersion = useStatusVersion()
  const scrollRef = useRef<HTMLDivElement>(null)

  const statusGrouped = groupBy === 'activity' || groupBy === 'brain'
  const filtered = useMemo(() => filterCharacters(characters, kind, query), [characters, kind, query])
  const groups = useMemo(
    () => groupCharacters(filtered, groupBy, (id) => statusStore.get(id)),
    // Status-based groupings recompute on live deltas; others ignore them.
    [filtered, groupBy, statusGrouped ? statusVersion : 0],
  )
  const starred = useMemo(
    () => watchlist.map((id) => byId.get(id)).filter((c): c is CharacterSummary => Boolean(c)),
    [watchlist, byId],
  )

  const rows = useMemo(() => {
    const result: Row[] = []
    for (const group of groups) {
      const isCollapsed = collapsed.has(group.key)
      if (groupBy !== 'none') {
        result.push({ type: 'header', key: `h-${group.key}`, label: group.label, count: group.members.length, collapsed: isCollapsed })
      }
      if (isCollapsed) continue
      for (const character of group.members) {
        result.push({ type: 'character', key: character.id, character })
      }
    }
    return result
  }, [groups, groupBy, collapsed])

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => (rows[index]?.type === 'header' ? 32 : 46),
    getItemKey: (index) => rows[index]?.key ?? index,
    overscan: 10,
  })

  const onSelect = useCallback(
    (id: string) => {
      select({ kind: 'character', id })
      onSelected?.()
    },
    [select, onSelected],
  )
  const selectedId = selection?.kind === 'character' ? selection.id : null
  const watchSet = useMemo(() => new Set(watchlist), [watchlist])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-col gap-2 p-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            Roster
            <span className="font-mono text-xs font-normal text-muted-foreground tabular-nums">{filtered.length}</span>
          </h2>
          <div className="flex items-center gap-1">
            <MockTag requires={['characters', 'status']} />
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" />}>
                <ListFilterIcon />
                <span className="sr-only">Roster options</span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
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
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Group by</DropdownMenuLabel>
                  <DropdownMenuRadioGroup value={groupBy} onValueChange={(value) => setGroupBy(value as GroupBy)}>
                    {(Object.keys(GROUP_LABELS) as GroupBy[]).map((value) => (
                      <DropdownMenuRadioItem key={value} value={value}>
                        {GROUP_LABELS[value]}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        <InputGroup className="h-8">
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search characters"
            aria-label="Search characters"
          />
        </InputGroup>
      </div>

      {starred.length > 0 ? (
        <section aria-label="Watchlist" className="flex shrink-0 flex-col border-b px-1 pb-2">
          <h3 className="px-3 pb-1 font-mono text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            Watchlist
          </h3>
          <div className="flex max-h-48 flex-col overflow-y-auto">
            {starred.map((character) => (
              <CharacterRow
                key={character.id}
                character={character}
                selected={selectedId === character.id}
                starred
                onSelect={onSelect}
              />
            ))}
          </div>
        </section>
      ) : null}

      {isLoading ? (
        <div className="flex flex-col gap-1 px-3 py-1" aria-hidden>
          {Array.from({ length: 8 }).map((_, index) => (
            <div key={index} className="flex h-11 items-center gap-2.5">
              <Skeleton className="size-7 rounded-full" />
              <div className="flex flex-1 flex-col gap-1.5">
                <Skeleton className="h-3 w-1/2" />
                <Skeleton className="h-2.5 w-4/5" />
              </div>
            </div>
          ))}
        </div>
      ) : error ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">{error.message}</p>
      ) : rows.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">
          {query ? 'No characters match that search.' : 'No characters to show.'}
        </p>
      ) : (
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-1 pb-2">
          <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((item) => {
              const row = rows[item.index]
              return (
                <div
                  key={item.key}
                  className="absolute inset-x-0 top-0"
                  style={{ height: item.size, transform: `translateY(${item.start}px)` }}
                >
                  {row.type === 'header' ? (
                    <button
                      type="button"
                      aria-expanded={!row.collapsed}
                      onClick={() =>
                        setCollapsed((current) => {
                          const next = new Set(current)
                          const key = row.key.slice(2)
                          if (next.has(key)) next.delete(key)
                          else next.add(key)
                          return next
                        })
                      }
                      className={cn(
                        'flex h-8 w-full items-center gap-1 rounded-md px-2 text-left text-xs font-medium text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {row.collapsed ? <ChevronRightIcon className="size-3.5" /> : <ChevronDownIcon className="size-3.5" />}
                      <span className="truncate">{row.label}</span>
                      <span className="font-mono tabular-nums">{`· ${row.count}`}</span>
                    </button>
                  ) : (
                    <CharacterRow
                      character={row.character}
                      selected={selectedId === row.character.id}
                      starred={watchSet.has(row.character.id)}
                      onSelect={onSelect}
                    />
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
