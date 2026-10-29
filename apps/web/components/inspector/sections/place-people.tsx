'use client'

import { useMemo } from 'react'
import type { CharacterSummary } from '@kazusa/client'
import { CharacterRow } from '@/components/entities/character-row'
import { PlaceChip } from '@/components/entities/chips'
import { useCharacters } from '@/hooks/use-characters'
import { useSimNow } from '@/hooks/use-clock'
import { useLocationVersion, useOccupancy, usePlaces } from '@/hooks/use-location'
import { useSelection } from '@/hooks/use-url-state'
import { locationStore } from '@/lib/live/state'
import { headingTo, peopleWithin } from '@/lib/location/places'
import type { EntityRef } from '@/lib/state/entity-ref'
import { useWatchlist } from '@/lib/state/watchlist'
import { formatSimDuration } from '@/lib/time/sim'

const MAX_ROWS = 12

function Subheading({ children }: { children: React.ReactNode }) {
  return (
    <h4 className="flex items-center justify-between font-mono text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
      {children}
    </h4>
  )
}

/** Who is here (omniscient Observer lens), who is inside, and who is on the way. */
export function PlacePeopleSection({ entity }: { entity: EntityRef }) {
  const places = usePlaces()
  const { characters, byId } = useCharacters()
  const [, select] = useSelection()
  const watchlist = useWatchlist()
  const watchSet = useMemo(() => new Set(watchlist), [watchlist])
  const ids = useMemo(() => characters.map((c) => c.id), [characters])
  const occupied = useOccupancy(ids)
  const version = useLocationVersion()
  const now = useSimNow()

  const arriving = useMemo(
    () => headingTo(ids, (id) => locationStore.get(id), entity.id, now),
    // `version` stands in for every record in the store.
    [ids, entity.id, now, version],
  )

  if (!places?.byId.has(entity.id)) return null

  const people = (list: readonly string[]) =>
    list
      .map((id) => byId.get(id))
      .filter((c): c is CharacterSummary => Boolean(c))
      .sort((a, b) => a.name.localeCompare(b.name))
  const here = people(occupied.at.get(entity.id) ?? [])
  const inside = (places.children.get(entity.id) ?? [])
    .map((id) => ({ id, count: peopleWithin(places, occupied, id).length }))
    .filter(({ count }) => count > 0)
  const onSelect = (id: string) => select({ kind: 'character', id })

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <Subheading>
          <span>Here now</span>
          <span className="tabular-nums">{here.length}</span>
        </Subheading>
        {here.length ? (
          <div className="-mx-2 flex flex-col">
            {here.slice(0, MAX_ROWS).map((character) => (
              <CharacterRow
                key={character.id}
                character={character}
                selected={false}
                starred={watchSet.has(character.id)}
                onSelect={onSelect}
              />
            ))}
            {here.length > MAX_ROWS ? (
              <p className="px-2 pt-1 text-xs text-muted-foreground">{`+${here.length - MAX_ROWS} more; open in World to see everyone.`}</p>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Nobody is standing here.</p>
        )}
      </div>

      {inside.length ? (
        <div className="flex flex-col gap-1">
          <Subheading>Inside</Subheading>
          <ul className="-ml-1 flex flex-col">
            {inside.map(({ id, count }) => (
              <li key={id} className="flex items-center justify-between gap-2">
                <PlaceChip id={id} />
                <span className="font-mono text-xs text-muted-foreground tabular-nums">{count}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {arriving.length ? (
        <div className="flex flex-col gap-1">
          <Subheading>
            <span>On the way here</span>
            <span className="tabular-nums">{arriving.length}</span>
          </Subheading>
          <div className="-mx-2 flex flex-col">
            {arriving.slice(0, MAX_ROWS).map(({ id, arriveAt }) => {
              const character = byId.get(id)
              return character ? (
                <CharacterRow
                  key={id}
                  character={character}
                  selected={false}
                  starred={watchSet.has(id)}
                  onSelect={onSelect}
                  trailing={`in ${formatSimDuration(Math.max(0, arriveAt - now))}`}
                />
              ) : null
            })}
          </div>
        </div>
      ) : null}
    </div>
  )
}
