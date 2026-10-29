'use client'

import { useCallback, useMemo, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { CharacterSummary } from '@kazusa/client'
import { ChevronLeftIcon, InfoIcon, MapPinIcon, StarIcon, UsersIcon } from 'lucide-react'
import { CharacterRow } from '@/components/entities/character-row'
import { MockTag } from '@/components/entities/source-state'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { useSimNow } from '@/hooks/use-clock'
import { useNavigate, useSelection } from '@/hooks/use-url-state'
import { locationStore } from '@/lib/live/state'
import { areaPath } from '@/lib/location/places'
import { serializeEntityRef } from '@/lib/state/entity-ref'
import { useWatchlist } from '@/lib/state/watchlist'
import { formatSimDuration } from '@/lib/time/sim'
import { cn } from '@/lib/utils'
import {
  KIND_LABELS,
  TRANSIT_FOLDER,
  UNPLACED_FOLDER,
  WATCH_FOLDER,
  busySummary,
  useWorldFolders,
  useWorldParams,
  type Folder,
} from './world-state'
import { WorldSidebar } from './world-sidebar'

/**
 * The open folder from the World sidebar. Narrow screens have no visible
 * sidebar, so until a folder is opened the folder list is this screen.
 * A map renderer can register as an alternative here later.
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

type Item =
  | { readonly type: 'heading'; readonly key: string; readonly label: string; readonly placeId?: string; readonly count: number }
  | { readonly type: 'row'; readonly key: string; readonly character: CharacterSummary }

/** Sub-place headings only when they add something: more than one run, or a run elsewhere. */
function itemsOf(folder: Folder): Item[] {
  const sections = folder.sections ?? []
  const headed = sections.length > 1 || (sections[0] && sections[0].placeId !== folder.placeId)
  if (!headed) {
    return folder.members.map((character) => ({ type: 'row', key: character.id, character }))
  }
  return sections.flatMap((section): Item[] => [
    { type: 'heading', key: `h:${section.key}`, label: section.label, placeId: section.placeId, count: section.members.length },
    ...section.members.map((character): Item => ({ type: 'row', key: `${section.key}:${character.id}`, character })),
  ])
}

function FolderStage() {
  const navigate = useNavigate()
  const [selection, select] = useSelection()
  const watchlist = useWatchlist()
  const { by, kind, folder } = useWorldParams()
  const { resolve, places } = useWorldFolders(by, kind)
  const open = resolve(folder) ?? resolve('all')!
  const members = open.members
  const items = useMemo(() => itemsOf(open), [open])
  const scrollRef = useRef<HTMLDivElement>(null)
  const now = useSimNow()
  const inTransit = open.key === TRANSIT_FOLDER

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => (items[index]?.type === 'heading' ? 32 : 46),
    getItemKey: (index) => items[index]?.key ?? index,
    overscan: 10,
  })

  const onSelect = useCallback((id: string) => select({ kind: 'character', id }), [select])
  const selectPlace = useCallback((id: string) => select({ kind: 'place', id }), [select])
  const selectedId = selection?.kind === 'character' ? selection.id : null
  const watchSet = useMemo(() => new Set(watchlist), [watchlist])
  const busy = busySummary(members)
  const scope = open.key === WATCH_FOLDER ? null : KIND_LABELS[kind].toLowerCase()
  const area = open.placeId && places ? areaPath(places, open.placeId) : ''

  const arrival = (id: string) => {
    const arriveAt = locationStore.get(id)?.trip?.arriveAt
    if (!arriveAt || now === 0) return undefined
    return arriveAt > now ? `in ${formatSimDuration(arriveAt - now)}` : 'arriving'
  }

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
          <h2 className="flex min-w-0 items-center gap-2 text-sm font-semibold">
            <span className="truncate">{open.label}</span>
            {by === 'place' ? <MockTag requires={['places', 'location']} /> : null}
          </h2>
          <p className="truncate font-mono text-[11px] text-muted-foreground tabular-nums">
            {[area && `in ${area}`, `${members.length} ${scope ?? 'watched'}`, busy].filter(Boolean).join(' · ')}
          </p>
        </div>
        {open.placeId ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => selectPlace(open.placeId!)}
            aria-current={selection?.kind === 'place' && selection.id === open.placeId ? 'true' : undefined}
          >
            <InfoIcon data-icon="inline-start" />
            <span className="sr-only sm:not-sr-only">Place details</span>
          </Button>
        ) : null}
      </header>

      {members.length === 0 ? (
        <EmptyFolder folder={open} />
      ) : (
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto p-2">
          <ul aria-label={`${open.label} members`} className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((virtual) => {
              const item = items[virtual.index]
              return (
                <li
                  key={virtual.key}
                  className="absolute inset-x-0 top-0"
                  style={{ height: virtual.size, transform: `translateY(${virtual.start}px)` }}
                >
                  {item.type === 'heading' ? (
                    <SectionHeading item={item} onSelectPlace={selectPlace} />
                  ) : (
                    <CharacterRow
                      character={item.character}
                      selected={selectedId === item.character.id}
                      starred={watchSet.has(item.character.id)}
                      onSelect={onSelect}
                      trailing={inTransit ? arrival(item.character.id) : undefined}
                    />
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </>
  )
}

function SectionHeading({
  item,
  onSelectPlace,
}: {
  item: Extract<Item, { type: 'heading' }>
  onSelectPlace: (id: string) => void
}) {
  const content = (
    <>
      <MapPinIcon aria-hidden className="size-3.5 shrink-0" />
      <span className="truncate">{item.label}</span>
      <span className="font-mono tabular-nums">{item.count}</span>
    </>
  )
  const className =
    'flex h-8 w-full min-w-0 items-center gap-1.5 px-2 pt-2 text-left font-mono text-[11px] font-medium tracking-wide text-muted-foreground uppercase'
  return item.placeId ? (
    <button
      type="button"
      onClick={() => onSelectPlace(item.placeId!)}
      className={cn(className, 'rounded-sm outline-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring')}
    >
      {content}
    </button>
  ) : (
    <div className={className}>{content}</div>
  )
}

function EmptyFolder({ folder }: { folder: Folder }) {
  const navigate = useNavigate()
  const watch = folder.key === WATCH_FOLDER
  const placed = folder.placeId !== undefined
  const title = watch
    ? 'Nobody on your watchlist yet'
    : placed
      ? 'Nobody here right now'
      : folder.key === TRANSIT_FOLDER
        ? 'Nobody is on the way anywhere'
        : folder.key === UNPLACED_FOLDER
          ? 'Everyone has a place'
          : 'Nobody here'
  const description = watch
    ? 'Star a character to follow them here and in the Timeline.'
    : placed
      ? `No one is at ${folder.label} or anywhere inside it. People heading here are listed in its details.`
      : 'Try another folder or show everyone from the sidebar filters.'
  return (
    <Empty className="border-none">
      <EmptyHeader>
        <EmptyMedia variant="icon">{watch ? <StarIcon /> : placed ? <MapPinIcon /> : <UsersIcon />}</EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {placed ? (
        <Button
          variant="outline"
          size="sm"
          onClick={() => navigate({ sel: serializeEntityRef({ kind: 'place', id: folder.placeId! }) })}
        >
          Place details
        </Button>
      ) : null}
    </Empty>
  )
}
