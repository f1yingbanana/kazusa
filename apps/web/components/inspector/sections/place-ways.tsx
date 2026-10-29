'use client'

import { PlaceChip } from '@/components/entities/chips'
import { usePlaces } from '@/hooks/use-location'
import { connectionsOf, describeWay } from '@/lib/location/places'
import type { EntityRef } from '@/lib/state/entity-ref'

function WayRow({ to, ways, note }: { to: string; ways: string; note?: string }) {
  return (
    <li className="flex flex-col py-0.5">
      <span className="flex min-w-0 items-center justify-between gap-2">
        <PlaceChip id={to} />
        <span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">{ways}</span>
      </span>
      {note ? <span className="pl-1 text-xs leading-relaxed text-muted-foreground">{note}</span> : null}
    </li>
  )
}

/** The graph around a place, rendered from frontmatter: its area, what is inside, and where its ways lead. */
export function PlaceWaysSection({ entity }: { entity: EntityRef }) {
  const places = usePlaces()
  const place = places?.byId.get(entity.id)
  if (!places || !place) return null

  const parent = place.parent && places.byId.get(place.parent)
  const children = places.children.get(place.id) ?? []
  const connections = connectionsOf(places, place.id)
  const walk = (minutes: number) => describeWay({ by: 'walk', minutes })

  if (!parent && children.length === 0 && connections.length === 0) {
    return <p className="text-sm text-muted-foreground">Not connected to anywhere.</p>
  }

  return (
    <ul className="-ml-1 flex flex-col">
      {parent ? <WayRow to={parent.id} ways={`out · ${walk(place.entryMinutes)}`} /> : null}
      {children.map((id) => (
        <WayRow key={id} to={id} ways={`in · ${walk(places.byId.get(id)?.entryMinutes ?? 1)}`} />
      ))}
      {connections.map((connection) => (
        <WayRow
          key={`c:${connection.to}`}
          to={connection.to}
          ways={connection.ways.map(describeWay).join(', ')}
          note={connection.note}
        />
      ))}
    </ul>
  )
}
