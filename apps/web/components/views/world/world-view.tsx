'use client'

import { useCallback, useMemo, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ChevronLeftIcon, MapIcon, StarIcon, UsersIcon } from 'lucide-react'
import { CharacterRow } from '@/components/entities/character-row'
import { NeedsLine } from '@/components/entities/source-state'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { useNavigate, useSelection } from '@/hooks/use-url-state'
import { useWatchlist } from '@/lib/state/watchlist'
import { KIND_LABELS, WATCH_FOLDER, busySummary, useWorldFolders, useWorldParams } from './world-state'
import { WorldSidebar } from './world-sidebar'

/**
 * The open folder from the World sidebar. Narrow screens have no visible
 * sidebar, so until a folder is opened the folder list is this screen.
 * A map renderer registers as an alternative here once `places` exists.
 */
export function WorldView() {
  const { folderParam } = useWorldParams()
  return (
    <section aria-label="World" className="flex min-h-0 flex-1 flex-col">
      {folderParam === null ? (
        <div className="flex min-h-0 flex-1 flex-col lg:hidden">
          <WorldSidebar asFirstScreen />
        </div>
      ) : null}
      <div className={folderParam === null ? 'hidden min-h-0 flex-1 flex-col lg:flex' : 'flex min-h-0 flex-1 flex-col'}>
        <FolderStage />
      </div>
    </section>
  )
}

function FolderStage() {
  const navigate = useNavigate()
  const [selection, select] = useSelection()
  const watchlist = useWatchlist()
  const { by, kind, folder } = useWorldParams()
  const { resolve } = useWorldFolders(by, kind)
  const open = resolve(folder) ?? resolve('all')!
  const members = open.members
  const scrollRef = useRef<HTMLDivElement>(null)

  const virtualizer = useVirtualizer({
    count: members.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 46,
    getItemKey: (index) => members[index]?.id ?? index,
    overscan: 10,
  })

  const onSelect = useCallback((id: string) => select({ kind: 'character', id }), [select])
  const selectedId = selection?.kind === 'character' ? selection.id : null
  const watchSet = useMemo(() => new Set(watchlist), [watchlist])
  const busy = busySummary(members)
  const scope = open.key === WATCH_FOLDER ? null : KIND_LABELS[kind].toLowerCase()

  return (
    <>
      <header className="flex h-14 shrink-0 items-center gap-2 border-b px-3">
        <Button
          variant="ghost"
          size="icon-sm"
          className="lg:hidden"
          onClick={() => navigate({ 'world.in': null })}
        >
          <ChevronLeftIcon />
          <span className="sr-only">All folders</span>
        </Button>
        <div className="flex min-w-0 flex-1 flex-col">
          <h2 className="truncate text-sm font-semibold">{open.label}</h2>
          <p className="truncate font-mono text-[11px] text-muted-foreground tabular-nums">
            {[`${members.length} ${scope ?? 'watched'}`, busy].filter(Boolean).join(' · ')}
          </p>
        </div>
        <span className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex">
          <MapIcon aria-hidden className="size-3.5" />
          <NeedsLine requires={['places', 'location']}>Map:</NeedsLine>
        </span>
      </header>

      {members.length === 0 ? (
        <Empty className="border-none">
          <EmptyHeader>
            <EmptyMedia variant="icon">{open.key === WATCH_FOLDER ? <StarIcon /> : <UsersIcon />}</EmptyMedia>
            <EmptyTitle>{open.key === WATCH_FOLDER ? 'Nobody on your watchlist yet' : 'Nobody here'}</EmptyTitle>
            <EmptyDescription>
              {open.key === WATCH_FOLDER
                ? 'Star a character to follow them here and in the Timeline.'
                : 'Try another folder or show everyone from the sidebar filters.'}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto p-2">
          <ul aria-label={`${open.label} members`} className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((item) => {
              const character = members[item.index]
              return (
                <li
                  key={item.key}
                  className="absolute inset-x-0 top-0"
                  style={{ height: item.size, transform: `translateY(${item.start}px)` }}
                >
                  <CharacterRow
                    character={character}
                    selected={selectedId === character.id}
                    starred={watchSet.has(character.id)}
                    onSelect={onSelect}
                  />
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </>
  )
}
