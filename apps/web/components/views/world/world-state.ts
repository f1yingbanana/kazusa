'use client'

import { useMemo } from 'react'
import type { CharacterSummary } from '@kazusa/client'
import { useCharacters, useStatusVersion } from '@/hooks/use-characters'
import { useOccupancy, usePlaces } from '@/hooks/use-location'
import { useOffstage } from '@/hooks/use-stage'
import { useParam } from '@/hooks/use-url-state'
import { locationStore, statusStore } from '@/lib/live/state'
import type { Occupancy, PlaceIndex } from '@/lib/location/places'
import { useSources } from '@/lib/source/provider'
import { filterCharacters, groupCharacters, type Group, type GroupBy, type KindFilter } from '@/lib/state/grouping'
import { useWatchlist } from '@/lib/state/watchlist'

/*
 * URL params:
 *   world.by   – folder dimension (place | affiliation | activity | brain).
 *                Absent means the default: place once the world has places,
 *                affiliation before that.
 *   world.in   – open folder: `all`, `watch`, or a group key. Absent means
 *                "nothing opened yet": desktop shows `all`, narrow screens
 *                show the folder list as the section's first screen.
 *   world.kind – characters (default) | onstage | offstage | npc | everyone
 */
export type Dimension = Exclude<GroupBy, 'none'> | 'place'

const ALL_DIMENSIONS: readonly { id: Dimension; label: string }[] = [
  { id: 'place', label: 'Place' },
  { id: 'affiliation', label: 'Affiliation' },
  { id: 'activity', label: 'Activity' },
  { id: 'brain', label: 'Brain state' },
]

export const KIND_LABELS: Record<KindFilter, string> = {
  characters: 'Characters',
  onstage: 'Onstage',
  offstage: 'Offstage',
  npc: 'NPCs',
  everyone: 'Everyone',
}

export const ALL_FOLDER = 'all'
export const WATCH_FOLDER = 'watch'
export const PLACE_PREFIX = 'place:'
export const TRANSIT_FOLDER = '__transit'
export const UNPLACED_FOLDER = '__unplaced'
export const OFFSTAGE_FOLDER = '__offstage'

/** Place folders need both the map and positions. */
export function usePlacesAvailable() {
  const { resolved } = useSources()
  return resolved.places !== 'unavailable' && resolved.location !== 'unavailable'
}

export function useDimensions() {
  const placesAvailable = usePlacesAvailable()
  return useMemo(
    () => ALL_DIMENSIONS.filter((d) => d.id !== 'place' || placesAvailable),
    [placesAvailable],
  )
}

export function useWorldParams() {
  const rawBy = useParam('world.by')
  const rawKind = useParam('world.kind')
  const folderParam = useParam('world.in')
  const dimensions = useDimensions()
  const defaultBy: Dimension = dimensions.some((d) => d.id === 'place') ? 'place' : 'affiliation'
  const by: Dimension = dimensions.some((d) => d.id === rawBy) ? (rawBy as Dimension) : defaultBy
  const kind: KindFilter = rawKind && rawKind in KIND_LABELS ? (rawKind as KindFilter) : 'characters'
  return { by, defaultBy, kind, folderParam, folder: folderParam ?? ALL_FOLDER }
}

/** A run of members under one heading inside an open folder. */
export interface FolderSection {
  readonly key: string
  readonly label: string
  readonly placeId?: string
  readonly members: readonly CharacterSummary[]
}

export interface Folder {
  readonly key: string
  readonly label: string
  readonly members: readonly CharacterSummary[]
  /** Place folders: the place, its depth in the tree, and who is directly there. */
  readonly placeId?: string
  readonly depth?: number
  readonly isArea?: boolean
  /** Place folders split members by the sub-place they stand in. */
  readonly sections?: readonly FolderSection[]
}

const byName = (a: CharacterSummary, b: CharacterSummary) => a.name.localeCompare(b.name)

function placeFolders(
  index: PlaceIndex,
  occupied: Occupancy,
  byId: ReadonlyMap<string, CharacterSummary>,
  offstage: readonly CharacterSummary[],
): Folder[] {
  const people = (ids: readonly string[]) =>
    ids
      .map((id) => byId.get(id))
      .filter((c): c is CharacterSummary => Boolean(c))
      .sort(byName)

  const folders: Folder[] = index.order.map((placeId) => {
    const place = index.byId.get(placeId)!
    const within: string[] = []
    const sections: FolderSection[] = []
    const visit = (id: string) => {
      const here = people(occupied.at.get(id) ?? [])
      if (here.length) {
        within.push(...here.map((c) => c.id))
        sections.push({ key: id, label: index.byId.get(id)?.name ?? id, placeId: id, members: here })
      }
      for (const child of index.children.get(id) ?? []) visit(child)
    }
    visit(placeId)
    return {
      key: `${PLACE_PREFIX}${placeId}`,
      label: place.name,
      placeId,
      depth: index.depth.get(placeId) ?? 0,
      isArea: (index.children.get(placeId)?.length ?? 0) > 0,
      members: sections.flatMap((section) => section.members),
      sections,
    }
  })

  // Travelers grouped by where they are headed.
  const heading = new Map<string, CharacterSummary[]>()
  for (const character of people(occupied.traveling)) {
    const to = locationStore.get(character.id)?.trip?.to ?? ''
    heading.set(to, [...(heading.get(to) ?? []), character])
  }
  const transit = [...heading.entries()]
    .map(([to, members]) => ({
      key: `to:${to}`,
      label: `To ${index.byId.get(to)?.name ?? to}`,
      placeId: to,
      members,
    }))
    .sort((a, b) => a.label.localeCompare(b.label))
  folders.push({
    key: TRANSIT_FOLDER,
    label: 'On the way',
    members: transit.flatMap((section) => section.members),
    sections: transit,
  })
  const unplaced = people(occupied.unplaced)
  if (unplaced.length) folders.push({ key: UNPLACED_FOLDER, label: 'Unplaced', members: unplaced })
  // Offstage characters aren't anywhere in the world.
  if (offstage.length) folders.push({ key: OFFSTAGE_FOLDER, label: 'Offstage', members: [...offstage].sort(byName) })
  return folders
}

/** The folders the World sidebar lists, and what each one contains. */
export function useWorldFolders(by: Dimension, kind: KindFilter) {
  const { characters, byId, isLoading, error } = useCharacters()
  const watchlist = useWatchlist()
  const statusVersion = useStatusVersion()
  const statusGrouped = by === 'activity' || by === 'brain'
  const places = usePlaces()
  const offstage = useOffstage()

  const pool = useMemo(
    () => filterCharacters(characters, kind, '', (id) => offstage.has(id)).filter((c) => c.kind !== 'player'),
    [characters, kind, offstage],
  )
  const poolIds = useMemo(() => (by === 'place' ? pool.map((c) => c.id) : []), [pool, by])
  const occupied = useOccupancy(poolIds)

  const groups: Folder[] = useMemo(() => {
    if (by === 'place')
      return places ? placeFolders(places, occupied, byId, pool.filter((c) => offstage.has(c.id))) : []
    const statusGroups: Group[] = groupCharacters(pool, by, (id) => statusStore.get(id))
    return statusGroups
    // Activity and brain folders regroup on live status deltas.
  }, [pool, by, places, occupied, byId, offstage, statusGrouped ? statusVersion : 0])

  /*
   * Who a folder's onstage controls act on: every character in it, whatever
   * the Show filter hides. Only Everyone and affiliation folders are groups
   * worth switching; activity, brain and place folders change by the minute,
   * and offstage characters have none of those.
   */
  const agents = useMemo(() => characters.filter((c) => c.kind === 'agent').sort(byName), [characters])
  const affiliations = useMemo(
    () => new Map(groupCharacters(agents, 'affiliation', () => undefined).map((g) => [g.key, g.members])),
    [agents],
  )
  const castOf = (key: string): readonly CharacterSummary[] | undefined => {
    if (key === ALL_FOLDER) return agents
    if (by === 'affiliation') return affiliations.get(key)
    return undefined
  }

  const watched = useMemo(
    () =>
      watchlist
        .map((id) => byId.get(id))
        .filter((c): c is CharacterSummary => Boolean(c))
        .sort(byName),
    [watchlist, byId],
  )
  const everyone = useMemo(() => [...pool].sort(byName), [pool])

  const resolve = (key: string): Folder | null => {
    if (key === ALL_FOLDER) return { key, label: 'Everyone', members: everyone }
    if (key === WATCH_FOLDER) return { key, label: 'Watchlist', members: watched }
    return groups.find((g) => g.key === key) ?? null
  }

  return { characters, groups, watched, everyone, resolve, castOf, offstage, isLoading, error, places }
}

/** "2 thinking · 1 composing", or null when nobody is busy. */
export function busySummary(members: readonly CharacterSummary[]): string | null {
  let thinking = 0
  let composing = 0
  for (const member of members) {
    const status = statusStore.get(member.id)
    if (status?.brain === 'thinking') thinking += 1
    if (status?.composingIn.length) composing += 1
  }
  const parts = [thinking ? `${thinking} thinking` : null, composing ? `${composing} composing` : null].filter(Boolean)
  return parts.length ? parts.join(' · ') : null
}
