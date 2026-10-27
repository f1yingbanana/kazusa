'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ChevronDownIcon, ChevronRightIcon, MapIcon } from 'lucide-react'
import type { CharacterSummary } from '@kazusa/client'
import { CharacterRow } from '@/components/entities/character-row'
import { MockTag, NeedsLine } from '@/components/entities/source-state'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useCharacters, useStatusVersion } from '@/hooks/use-characters'
import { useNavigate, useParam, useSelection } from '@/hooks/use-url-state'
import { statusStore } from '@/lib/live/state'
import { filterCharacters, groupCharacters, type Group, type GroupBy } from '@/lib/state/grouping'
import { useWatchlist } from '@/lib/state/watchlist'

/*
 * First-draft tree renderer. Place hierarchy becomes a dimension once the
 * `places` + `location` domains exist; a map renderer registers as an
 * alternative inside this view, not as a separate view.
 */
const DIMENSIONS = [
  { id: 'affiliation', label: 'Affiliation' },
  { id: 'activity', label: 'Activity' },
  { id: 'brain', label: 'Brain state' },
] as const satisfies readonly { id: Exclude<GroupBy, 'none'>; label: string }[]

type Dimension = (typeof DIMENSIONS)[number]['id']

type Row =
  | { readonly type: 'node'; readonly key: string; readonly group: Group; readonly expanded: boolean }
  | { readonly type: 'occupant'; readonly key: string; readonly character: CharacterSummary }

function GroupSummary({ members }: { members: readonly CharacterSummary[] }) {
  let thinking = 0
  let composing = 0
  for (const member of members) {
    const status = statusStore.get(member.id)
    if (status?.brain === 'thinking') thinking += 1
    if (status?.composingIn.length) composing += 1
  }
  if (!thinking && !composing) return null
  return (
    <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
      {[thinking ? `${thinking} thinking` : null, composing ? `${composing} composing` : null]
        .filter(Boolean)
        .join(' · ')}
    </span>
  )
}

export function WorldView() {
  const { characters } = useCharacters()
  const navigate = useNavigate()
  const [selection, select] = useSelection()
  const watchlist = useWatchlist()
  const statusVersion = useStatusVersion()
  const rawDimension = useParam('world.group')
  const dimension: Dimension = DIMENSIONS.some((d) => d.id === rawDimension)
    ? (rawDimension as Dimension)
    : 'affiliation'
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const scrollRef = useRef<HTMLDivElement>(null)

  const simulated = useMemo(() => filterCharacters(characters, 'everyone', '').filter((c) => c.kind !== 'player'), [characters])
  const groups = useMemo(
    () => groupCharacters(simulated, dimension, (id) => statusStore.get(id)),
    // Live status deltas regroup activity/brain trees and refresh node summaries.
    [simulated, dimension, statusVersion],
  )

  const rows = useMemo(() => {
    const result: Row[] = []
    for (const group of groups) {
      const isExpanded = expanded.has(group.key)
      result.push({ type: 'node', key: `n-${group.key}`, group, expanded: isExpanded })
      if (!isExpanded) continue
      for (const character of group.members) {
        result.push({ type: 'occupant', key: `${group.key}/${character.id}`, character })
      }
    }
    return result
  }, [groups, expanded])

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => (rows[index]?.type === 'node' ? 48 : 46),
    getItemKey: (index) => rows[index]?.key ?? index,
    overscan: 10,
  })

  const onSelect = useCallback((id: string) => select({ kind: 'character', id }), [select])
  const selectedId = selection?.kind === 'character' ? selection.id : null
  const watchSet = useMemo(() => new Set(watchlist), [watchlist])

  return (
    <section aria-label="World" className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b px-3 py-2">
        <Tabs
          value={dimension}
          onValueChange={(value) => navigate({ 'world.group': String(value) }, 'replace')}
        >
          <TabsList>
            {DIMENSIONS.map((d) => (
              <TabsTrigger key={d.id} value={d.id} className="px-2.5">
                {d.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <MapIcon className="size-3.5" />
          <NeedsLine requires={['places', 'location']}>Place tree and map:</NeedsLine>
        </span>
        <MockTag requires={['characters', 'status']} className="ml-auto" />
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto p-2">
        <div role="tree" aria-label={`Characters by ${dimension}`} className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((item) => {
            const row = rows[item.index]
            return (
              <div
                key={item.key}
                className="absolute inset-x-0 top-0"
                style={{ height: item.size, transform: `translateY(${item.start}px)` }}
              >
                {row.type === 'node' ? (
                  <button
                    type="button"
                    role="treeitem"
                    aria-expanded={row.expanded}
                    onClick={() =>
                      setExpanded((current) => {
                        const next = new Set(current)
                        if (next.has(row.group.key)) next.delete(row.group.key)
                        else next.add(row.group.key)
                        return next
                      })
                    }
                    className="flex h-11 w-full items-center gap-2 rounded-md px-2 text-left hover:bg-accent/70"
                  >
                    {row.expanded ? (
                      <ChevronDownIcon className="size-4 text-muted-foreground" />
                    ) : (
                      <ChevronRightIcon className="size-4 text-muted-foreground" />
                    )}
                    <span className="truncate text-sm font-medium">{row.group.label}</span>
                    <span className="font-mono text-xs text-muted-foreground tabular-nums">
                      {row.group.members.length}
                    </span>
                    <span className="ml-auto">
                      <GroupSummary members={row.group.members} />
                    </span>
                  </button>
                ) : (
                  <div role="treeitem" className="pl-6">
                    <CharacterRow
                      character={row.character}
                      selected={selectedId === row.character.id}
                      starred={watchSet.has(row.character.id)}
                      onSelect={onSelect}
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
