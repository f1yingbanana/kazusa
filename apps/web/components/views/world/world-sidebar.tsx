'use client'

import { useCallback, useMemo, useState } from 'react'
import type { CharacterSummary } from '@kazusa/client'
import {
  BrainIcon,
  CircleDashedIcon,
  EllipsisIcon,
  FolderIcon,
  FootprintsIcon,
  ListFilterIcon,
  MapIcon,
  MapPinIcon,
  MoonIcon,
  PowerIcon,
  PowerOffIcon,
  StarIcon,
  UserCheckIcon,
  UsersIcon,
  type LucideIcon,
} from 'lucide-react'
import { CharacterRow } from '@/components/entities/character-row'
import { MockTag } from '@/components/entities/source-state'
import { taskIcon } from '@/components/entities/task-icon'
import { PanelToolbar } from '@/components/shell/panel-toolbar'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { useStage } from '@/hooks/use-stage'
import { useNavigate, useSelection } from '@/hooks/use-url-state'
import { filterCharacters, type KindFilter } from '@/lib/state/grouping'
import type { SectionSidebarProps } from '@/lib/registry/types'
import { useWatchlist } from '@/lib/state/watchlist'
import { cn } from '@/lib/utils'
import {
  ALL_FOLDER,
  KIND_LABELS,
  OFFSTAGE_FOLDER,
  TRANSIT_FOLDER,
  UNPLACED_FOLDER,
  WATCH_FOLDER,
  busySummary,
  useDimensions,
  useWorldFolders,
  useWorldParams,
  type Dimension,
  type Folder,
} from './world-state'
import { CastDialog, type CastIntent, type CastRequest } from './cast-dialog'

function FolderRow({
  icon: Icon,
  label,
  count,
  hint,
  active,
  onOpen,
  depth = 0,
  compact = false,
  onstage,
  menu,
}: {
  icon: LucideIcon
  label: string
  count: number
  hint?: string | null
  active: boolean
  onOpen: () => void
  /** Place tree depth; each level indents one step. */
  depth?: number
  /** One line (hint beside the label), for long trees. */
  compact?: boolean
  /** How many of the group are onstage; the count then reads "4/11". */
  onstage?: number
  /** Group actions, beside the row rather than inside its button. */
  menu?: React.ReactNode
}) {
  return (
    <div
      className={cn(
        'group/folder flex items-center rounded-md transition-colors hover:bg-sidebar-accent/70',
        active && 'bg-sidebar-accent text-sidebar-accent-foreground',
      )}
    >
      <button
        type="button"
        aria-current={active ? 'true' : undefined}
        onClick={onOpen}
        style={depth ? { paddingLeft: `${0.625 + depth * 0.875}rem` } : undefined}
        className={cn(
          'flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-2.5 text-left outline-none focus-visible:outline-2 focus-visible:outline-ring',
          compact ? 'h-9' : 'h-11',
          menu ? 'pr-1' : undefined,
        )}
      >
        <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <span className={cn('flex min-w-0 flex-1', compact ? 'items-baseline gap-2' : 'flex-col')}>
          <span
            className={cn(
              'truncate text-sm leading-tight',
              compact && 'max-w-full shrink-0',
              count === 0 && 'text-muted-foreground',
            )}
          >
            {label}
          </span>
          {hint ? <span className="truncate font-mono text-[11px] leading-tight text-primary">{hint}</span> : null}
        </span>
        <span
          className={cn(
            'font-mono text-xs tabular-nums',
            count === 0 ? 'text-muted-foreground/50' : 'text-muted-foreground',
          )}
        >
          {onstage === undefined ? count : `${onstage}/${count}`}
        </span>
      </button>
      {menu}
    </div>
  )
}

/** A group's onstage controls. Each item opens the cast dialog, which explains the change before anything happens. */
function CastMenu({
  label,
  cast,
  onstage,
  onChoose,
}: {
  label: string
  cast: readonly CharacterSummary[]
  onstage: number
  onChoose: (request: CastRequest) => void
}) {
  const open = (intent: CastIntent) => onChoose({ label, cast, intent })
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className="mr-1 shrink-0 opacity-0 group-hover/folder:opacity-100 focus-visible:opacity-100 data-popup-open:opacity-100 [@media(hover:none)]:opacity-100"
          />
        }
      >
        <EllipsisIcon />
        <span className="sr-only">{`Who's onstage in ${label}`}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{`${onstage} of ${cast.length} onstage`}</DropdownMenuLabel>
          {onstage < cast.length ? (
            <DropdownMenuItem onClick={() => open('onstage')}>
              <PowerIcon />
              Bring all onstage
            </DropdownMenuItem>
          ) : null}
          {onstage > 0 ? (
            <DropdownMenuItem onClick={() => open('offstage')}>
              <PowerOffIcon />
              Send all offstage
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onClick={() => open('choose')}>
            <UserCheckIcon />
            Choose who…
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function groupIcon(by: Dimension, folder: Folder): LucideIcon {
  if (by === 'activity') return taskIcon(folder.key === '__none' ? undefined : folder.key)
  if (by === 'brain') return BrainIcon
  if (by === 'place') {
    if (folder.key === TRANSIT_FOLDER) return FootprintsIcon
    if (folder.key === UNPLACED_FOLDER) return CircleDashedIcon
    if (folder.key === OFFSTAGE_FOLDER) return MoonIcon
    return folder.isArea ? MapIcon : MapPinIcon
  }
  return FolderIcon
}

/**
 * World's sidebar: folders of characters. Watchlist and Everyone are fixed; the rest come from the chosen dimension.
 * Typing searches characters directly, so jumping to someone never needs a folder.
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
  const { by, defaultBy, kind, folder: openFolder, folderParam } = useWorldParams()
  const dimensions = useDimensions()
  const folder = asFirstScreen && folderParam === null ? null : openFolder
  const { characters, groups, watched, everyone, castOf, offstage, isLoading, error } = useWorldFolders(by, kind)
  const [query, setQuery] = useState('')
  const { apply: canStage } = useStage()
  const [castRequest, setCastRequest] = useState<CastRequest | null>(null)

  /** Count and menu for a folder that is a group worth switching. */
  function stageProps(key: string, label: string) {
    const cast = canStage ? castOf(key) : undefined
    if (!cast?.length) return {}
    const onstage = cast.filter((c) => !offstage.has(c.id)).length
    return {
      onstage,
      count: cast.length,
      menu: <CastMenu label={label} cast={cast} onstage={onstage} onChoose={setCastRequest} />,
    }
  }

  const matches = useMemo(
    () => (query.trim() ? filterCharacters(characters, 'everyone', query).filter((c) => c.kind !== 'player') : []),
    [characters, query],
  )
  const watchSet = useMemo(() => new Set(watchlist), [watchlist])
  const selectedId = selection?.kind === 'character' ? selection.id : null
  const customized = kind !== 'characters' || by !== defaultBy

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
    navigate(
      {
        'world.by': next === defaultBy ? null : next,
        ...(groupOpen ? { 'world.in': null } : {}),
      },
      'replace',
    )
  }
  function setKind(next: KindFilter) {
    navigate({ 'world.kind': next === 'characters' ? null : next }, 'replace')
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
                {dimensions.map((d) => (
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
            matches
              .slice(0, 60)
              .map((character) => (
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
            {...stageProps(ALL_FOLDER, 'Everyone')}
          />
          <div className="flex items-center justify-between gap-2 px-2.5 pt-4 pb-1">
            <h3 className="font-mono text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
              {dimensions.find((d) => d.id === by)?.label}
            </h3>
            <MockTag requires={by === 'place' ? ['characters', 'places', 'location'] : ['characters', 'status']} />
          </div>
          {groups.map((group) => (
            <FolderRow
              key={group.key}
              icon={groupIcon(by, group)}
              label={group.label}
              count={group.members.length}
              hint={busySummary(group.members)}
              active={folder === group.key}
              onOpen={() => open(group.key)}
              depth={group.depth}
              compact={by === 'place'}
              {...stageProps(group.key, group.label)}
            />
          ))}
          {by === 'place' && groups.length === 0 ? (
            <p className="px-2.5 py-2 text-sm text-muted-foreground">This world has no places yet.</p>
          ) : null}
        </nav>
      )}
      <CastDialog request={castRequest} onOpenChange={(next) => (next ? null : setCastRequest(null))} />
    </div>
  )
}
