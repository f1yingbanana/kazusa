'use client'

import { useMemo } from 'react'
import type { CharacterSummary } from '@kazusa/client'
import { useCharacters, useStatusVersion } from '@/hooks/use-characters'
import { useParam } from '@/hooks/use-url-state'
import { statusStore } from '@/lib/live/state'
import { filterCharacters, groupCharacters, type Group, type GroupBy, type KindFilter } from '@/lib/state/grouping'
import { useWatchlist } from '@/lib/state/watchlist'

/*
 * URL params:
 *   world.by   – folder dimension (affiliation | activity | brain)
 *   world.in   – open folder: `all`, `watch`, or a group key. Absent means
 *                "nothing opened yet": desktop shows `all`, narrow screens
 *                show the folder list as the section's first screen.
 *   world.kind – simulated (default) | npc | everyone
 * Place hierarchy becomes another dimension once `places` + `location` exist.
 */
export type Dimension = Exclude<GroupBy, 'none'>

export const DIMENSIONS: readonly { id: Dimension; label: string }[] = [
  { id: 'affiliation', label: 'Affiliation' },
  { id: 'activity', label: 'Activity' },
  { id: 'brain', label: 'Brain state' },
]

export const KIND_LABELS: Record<KindFilter, string> = {
  simulated: 'Simulated',
  npc: 'NPCs',
  everyone: 'Everyone',
}

export const ALL_FOLDER = 'all'
export const WATCH_FOLDER = 'watch'

export function useWorldParams() {
  const rawBy = useParam('world.by')
  const rawKind = useParam('world.kind')
  const folderParam = useParam('world.in')
  const by: Dimension = DIMENSIONS.some((d) => d.id === rawBy) ? (rawBy as Dimension) : 'affiliation'
  const kind: KindFilter = rawKind && rawKind in KIND_LABELS ? (rawKind as KindFilter) : 'simulated'
  return { by, kind, folderParam, folder: folderParam ?? ALL_FOLDER }
}

export interface Folder {
  readonly key: string
  readonly label: string
  readonly members: readonly CharacterSummary[]
}

/** The folders the World sidebar lists, and what each one contains. */
export function useWorldFolders(by: Dimension, kind: KindFilter) {
  const { characters, byId, isLoading, error } = useCharacters()
  const watchlist = useWatchlist()
  const statusVersion = useStatusVersion()
  const statusGrouped = by !== 'affiliation'

  const pool = useMemo(
    () => filterCharacters(characters, kind, '').filter((c) => c.kind !== 'player'),
    [characters, kind],
  )
  const groups: Group[] = useMemo(
    () => groupCharacters(pool, by, (id) => statusStore.get(id)),
    // Activity and brain folders regroup on live status deltas.
    [pool, by, statusGrouped ? statusVersion : 0],
  )
  const watched = useMemo(
    () =>
      watchlist
        .map((id) => byId.get(id))
        .filter((c): c is CharacterSummary => Boolean(c))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [watchlist, byId],
  )
  const everyone = useMemo(() => [...pool].sort((a, b) => a.name.localeCompare(b.name)), [pool])

  const resolve = (key: string): Folder | null => {
    if (key === ALL_FOLDER) return { key, label: 'Everyone', members: everyone }
    if (key === WATCH_FOLDER) return { key, label: 'Watchlist', members: watched }
    const group = groups.find((g) => g.key === key)
    return group ? { key: group.key, label: group.label, members: group.members } : null
  }

  return { characters, groups, watched, everyone, resolve, isLoading, error }
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
