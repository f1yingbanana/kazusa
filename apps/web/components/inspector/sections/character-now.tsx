'use client'

import { useMemo, useState } from 'react'
import { FootprintsIcon, MapPinIcon, PenLineIcon, UsersIcon, type LucideIcon } from 'lucide-react'
import type { TaskSummary } from '@kazusa/client'
import { CharacterChip, ChatChip, PlaceChip } from '@/components/entities/chips'
import { taskIcon, taskLabel } from '@/components/entities/task-icon'
import { useCharacter, useCharacterStatus, useCharacters } from '@/hooks/use-characters'
import { useSimNow } from '@/hooks/use-clock'
import { useLocationRecord, useOccupancy, usePlaces } from '@/hooks/use-location'
import { areaPath, positionAt, type PlaceIndex, type Position } from '@/lib/location/places'
import type { EntityRef } from '@/lib/state/entity-ref'
import { formatSimDuration, formatSimTime, progress } from '@/lib/time/sim'
import { cn } from '@/lib/utils'

const MAX_PEOPLE = 6

/**
 * What the character is doing and where, in one glance: the task, then the
 * place (or the trip), who else is there, and any chat being written in.
 * Brain state is left to the presence ring on the avatar.
 */
export function CharacterNowSection({ entity }: { entity: EntityRef }) {
  const character = useCharacter(entity.id)
  const status = useCharacterStatus(character?.kind === 'agent' ? entity.id : undefined)
  const places = usePlaces()
  const record = useLocationRecord(entity.id)
  const now = useSimNow()

  if (!character) return null
  const position = record && now > 0 ? positionAt(record, now) : undefined
  const task = status?.task

  // Offstage, they aren't doing anything anywhere: the last task and place wait.
  if (status?.onstage === false) {
    return (
      <p className="text-sm text-muted-foreground">
        {status.queued > 0
          ? `Offstage. ${status.queued} waiting for when they're back.`
          : "Offstage: not simulated until they're back."}
      </p>
    )
  }

  if (!task && !position) {
    return (
      <p className="text-sm text-muted-foreground">
        {character.kind === 'npc'
          ? 'Not simulated: no activity or position.'
          : character.kind === 'agent' && !status
            ? 'No status reported yet.'
            : 'Not placed anywhere yet.'}
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {task ? <Task task={task} now={now} /> : null}
      {position && places ? <Where id={entity.id} places={places} position={position} now={now} noticed={record?.noticed} /> : null}
      {status?.composingIn.length ? (
        <Line icon={PenLineIcon}>
          <span className="text-muted-foreground">Writing in</span>
          {status.composingIn.map((chatId) => (
            <ChatChip key={chatId} id={chatId} />
          ))}
        </Line>
      ) : null}
    </div>
  )
}

function Task({ task, now }: { task: TaskSummary; now: number }) {
  const [expanded, setExpanded] = useState(false)
  const Icon = taskIcon(task.type)
  const fraction = now > 0 ? progress(task.startedAt, task.endAt, now) : 0
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2 font-mono text-[11px] text-muted-foreground tabular-nums">
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <Icon aria-hidden className="size-3.5 shrink-0" />
          <span className="truncate">
            <span className="font-medium tracking-wide uppercase">{taskLabel(task.type)}</span>
            {` · ${formatSimTime(task.startedAt)}–${formatSimTime(task.endAt)}`}
          </span>
        </span>
        <span className="shrink-0 text-foreground">
          {now > 0 && task.endAt > now ? `${formatSimDuration(task.endAt - now)} left` : 'Due'}
        </span>
      </div>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
        className={cn(
          'text-left text-sm leading-snug font-medium text-pretty outline-none focus-visible:outline-2 focus-visible:outline-ring',
          !expanded && 'line-clamp-3',
        )}
      >
        {task.description}
      </button>
      <div
        className="h-1 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label="Task progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(fraction * 100)}
      >
        <div className="h-full bg-primary transition-[width] duration-700" style={{ width: `${fraction * 100}%` }} />
      </div>
    </div>
  )
}

function Where({
  id,
  places,
  position,
  now,
  noticed,
}: {
  id: string
  places: PlaceIndex
  position: Position
  now: number
  noticed: readonly string[] | undefined
}) {
  const { characters } = useCharacters()
  const everyone = useMemo(() => characters.map((c) => c.id), [characters])
  const occupied = useOccupancy(everyone)

  if (position.kind === 'traveling') {
    const { trip } = position
    const near = places.byId.get(position.near)?.name ?? position.near
    return (
      <div className="flex flex-col gap-1">
        <Line icon={FootprintsIcon} trailing={`arrives ${formatSimTime(trip.arriveAt)}`}>
          <span className="text-muted-foreground">To</span>
          <PlaceChip id={trip.to} bare />
        </Line>
        <p className="pl-5 text-xs leading-relaxed text-muted-foreground">
          {`Near ${near}`}
          {trip.purpose ? `, then ${trip.purpose.description}` : null}
        </p>
      </div>
    )
  }

  const area = areaPath(places, position.placeId)
  const here = (occupied.at.get(position.placeId) ?? []).filter((other) => other !== id)
  const seen = new Set(noticed ?? [])
  // Noticed people first: who they know is here is what drives them.
  const people = [...here].sort((a, b) => Number(seen.has(b)) - Number(seen.has(a)))

  return (
    <div className="flex flex-col gap-1">
      <Line
        icon={MapPinIcon}
        trailing={position.since > 0 ? `${formatSimDuration(Math.max(0, now - position.since))} here` : undefined}
      >
        <PlaceChip id={position.placeId} bare />
        {area ? <span className="truncate text-xs text-muted-foreground">{area}</span> : null}
      </Line>
      <Line icon={UsersIcon}>
        {people.length ? (
          <>
            {people.slice(0, MAX_PEOPLE).map((other) => (
              <span
                key={other}
                title={seen.has(other) ? undefined : "Hasn't noticed them"}
                className={cn(!seen.has(other) && 'opacity-50')}
              >
                <CharacterChip id={other} />
              </span>
            ))}
            {people.length > MAX_PEOPLE ? (
              <span className="font-mono text-xs text-muted-foreground tabular-nums">{`+${people.length - MAX_PEOPLE}`}</span>
            ) : null}
          </>
        ) : (
          <span className="text-muted-foreground">Alone</span>
        )}
      </Line>
    </div>
  )
}

/** One fact line: icon, a wrapping value, and an optional mono readout on the right. */
function Line({
  icon: Icon,
  trailing,
  children,
}: {
  icon: LucideIcon
  trailing?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex min-w-0 items-start gap-1.5 text-sm">
      <Icon aria-hidden className="mt-1 size-3.5 shrink-0 text-muted-foreground" />
      <div className="-my-0.5 flex min-w-0 flex-1 flex-wrap items-center gap-x-1 gap-y-0.5">{children}</div>
      {trailing ? (
        <span className="mt-0.5 shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">{trailing}</span>
      ) : null}
    </div>
  )
}
