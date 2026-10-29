'use client'

import { useMemo } from 'react'
import {
  EyeIcon,
  FootprintsIcon,
  MapPinIcon,
  RouteIcon,
  TargetIcon,
  UsersIcon,
  type LucideIcon,
} from 'lucide-react'
import { CharacterChip, PlaceChip } from '@/components/entities/chips'
import { Fact } from '@/components/entities/fact'
import { useCharacter, useCharacters } from '@/hooks/use-characters'
import { useSimNow } from '@/hooks/use-clock'
import { useLocationRecord, useOccupancy, usePlaces } from '@/hooks/use-location'
import { areaPath, positionAt, type PlaceIndex, type Position } from '@/lib/location/places'
import type { EntityRef } from '@/lib/state/entity-ref'
import { formatSimDuration, formatSimTime, progress } from '@/lib/time/sim'
import { cn } from '@/lib/utils'

const MAX_CHIPS = 8

/** People as chips, capped so a crowded square stays one glance. */
export function PeopleChips({ ids }: { ids: readonly string[] }) {
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-0.5 gap-y-1">
      {ids.slice(0, MAX_CHIPS).map((id) => (
        <CharacterChip key={id} id={id} />
      ))}
      {ids.length > MAX_CHIPS ? (
        <span className="px-1 font-mono text-xs text-muted-foreground tabular-nums">{`+${ids.length - MAX_CHIPS}`}</span>
      ) : null}
    </span>
  )
}

/** A fact whose value is a wrapping list of people; the icon stays on the first line. */
function PeopleFact({ icon: Icon, label, ids }: { icon: LucideIcon; label: string; ids: readonly string[] }) {
  return (
    <div className="flex min-w-0 items-start gap-1.5 text-sm">
      <Icon aria-hidden className="mt-1.5 size-3.5 shrink-0 text-muted-foreground" />
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-muted-foreground">{label}</span>
        <div className="-ml-1">
          <PeopleChips ids={ids} />
        </div>
      </div>
    </div>
  )
}

function CardLabel({ icon: Icon, children }: { icon: LucideIcon; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
      <Icon aria-hidden className="size-3.5 shrink-0" />
      {children}
    </span>
  )
}

/** Where a character is: the place and who else is there, or the trip they are on. */
export function CharacterLocationSection({ entity }: { entity: EntityRef }) {
  const character = useCharacter(entity.id)
  const places = usePlaces()
  const record = useLocationRecord(entity.id)
  const now = useSimNow()
  const { characters } = useCharacters()
  const everyone = useMemo(() => characters.map((c) => c.id), [characters])
  const occupied = useOccupancy(everyone)

  if (!places) return <p className="text-sm text-muted-foreground">Loading places…</p>
  if (!record) {
    return (
      <p className="text-sm text-muted-foreground">
        {character?.kind === 'npc'
          ? 'Not on the map: only simulated characters and the player have a position.'
          : 'Not placed anywhere yet. They settle somewhere with their first activity.'}
      </p>
    )
  }
  if (now === 0) return null

  const position = positionAt(record, now)
  if (position.kind === 'traveling') return <Traveling places={places} position={position} now={now} />

  const place = places.byId.get(position.placeId)
  const area = areaPath(places, position.placeId)
  const alsoHere = (occupied.at.get(position.placeId) ?? []).filter((id) => id !== entity.id)
  const noticed = (record.noticed ?? []).filter((id) => alsoHere.includes(id))

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5 rounded-lg border bg-card p-3">
        <CardLabel icon={MapPinIcon}>Here</CardLabel>
        <div className="-ml-1 flex min-w-0 flex-col">
          <PlaceChip id={position.placeId} className="self-start text-base font-semibold" />
          {area ? <span className="pl-1 text-xs text-muted-foreground">{`in ${area}`}</span> : null}
        </div>
        {place?.summary ? <p className="text-sm leading-relaxed text-pretty text-muted-foreground">{place.summary}</p> : null}
        <p className="font-mono text-xs text-muted-foreground tabular-nums">
          {position.since > 0
            ? `Since ${formatSimTime(position.since)} · ${formatSimDuration(Math.max(0, now - position.since))}`
            : "Hasn't moved yet"}
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        {alsoHere.length ? (
          <PeopleFact icon={UsersIcon} label="Also here" ids={alsoHere} />
        ) : (
          <Fact icon={UsersIcon}>
            <span className="text-muted-foreground">Nobody else here</span>
          </Fact>
        )}
        {noticed.length ? (
          <PeopleFact icon={EyeIcon} label="Has noticed" ids={noticed} />
        ) : alsoHere.length ? (
          <Fact icon={EyeIcon}>
            <span className="text-muted-foreground">{"Hasn't noticed anyone here yet"}</span>
          </Fact>
        ) : null}
      </div>
    </div>
  )
}

function Traveling({
  places,
  position,
  now,
}: {
  places: PlaceIndex
  position: Extract<Position, { kind: 'traveling' }>
  now: number
}) {
  const { trip } = position
  const fraction = progress(trip.departAt, trip.arriveAt, now)
  const planned = Math.round((trip.arriveAt - trip.departAt) / 60_000)
  const nearIndex = trip.legs.findIndex((leg) => leg.placeId === position.near)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 rounded-lg border bg-card p-3">
        <CardLabel icon={FootprintsIcon}>On the way</CardLabel>
        <p className="-ml-1 flex min-w-0 flex-wrap items-center gap-1 text-sm">
          <PlaceChip id={position.from} />
          <span aria-hidden className="text-muted-foreground">
            →
          </span>
          <span className="sr-only">to</span>
          <PlaceChip id={trip.to} className="font-semibold" />
        </p>
        <div
          className="h-1 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-label="Trip progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(fraction * 100)}
        >
          <div className="h-full bg-primary transition-[width] duration-700" style={{ width: `${fraction * 100}%` }} />
        </div>
        <div className="flex items-center justify-between font-mono text-xs text-muted-foreground tabular-nums">
          <span>{`${formatSimTime(trip.departAt)} → ${formatSimTime(trip.arriveAt)}`}</span>
          <span className="text-foreground">{`${formatSimDuration(Math.max(0, trip.arriveAt - now))} left`}</span>
        </div>
        <ol aria-label="Route" className="flex flex-col">
          {trip.legs.map((leg, index) => {
            const state = index < nearIndex ? 'passed' : index === nearIndex ? 'near' : 'ahead'
            return (
              <li key={`${leg.placeId}-${index}`} className="flex items-center gap-2 py-0.5 text-sm">
                <span
                  aria-hidden
                  className={cn(
                    'size-2 shrink-0 rounded-full border',
                    state === 'near' ? 'border-primary bg-primary' : state === 'passed' ? 'border-muted-foreground bg-muted-foreground' : 'border-muted-foreground',
                  )}
                />
                <span
                  className={cn(
                    'min-w-0 flex-1 truncate',
                    state === 'passed' && 'text-muted-foreground',
                    state === 'near' && 'font-medium',
                  )}
                >
                  {places.byId.get(leg.placeId)?.name ?? leg.placeId}
                  {state === 'near' ? <span className="sr-only"> (near here now)</span> : null}
                </span>
                <span className="font-mono text-xs text-muted-foreground tabular-nums">{formatSimTime(leg.at)}</span>
              </li>
            )
          })}
        </ol>
      </div>
      {trip.purpose ? (
        <Fact icon={TargetIcon}>
          <span className="text-muted-foreground">Then </span>
          <span>{trip.purpose.description}</span>
          <span className="font-mono text-xs text-muted-foreground">{` · ${formatSimDuration(trip.purpose.minutes * 60_000)} planned`}</span>
        </Fact>
      ) : (
        <Fact icon={RouteIcon}>
          <span className="text-muted-foreground">The trip is the activity</span>
          <span className="font-mono text-xs text-muted-foreground">
            {` · ${formatSimDuration(planned * 60_000)}, usually ${formatSimDuration(trip.usualMinutes * 60_000)}`}
          </span>
        </Fact>
      )}
    </div>
  )
}
