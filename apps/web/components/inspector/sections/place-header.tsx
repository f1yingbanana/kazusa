'use client'

import { MapIcon, MapPinIcon, UsersIcon } from 'lucide-react'
import { PlaceChip } from '@/components/entities/chips'
import { MockTag } from '@/components/entities/source-state'
import { Button } from '@/components/ui/button'
import { usePlaces } from '@/hooks/use-location'
import { useNavigate } from '@/hooks/use-url-state'
import { ancestors } from '@/lib/location/places'
import type { EntityRef } from '@/lib/state/entity-ref'

/** Frontmatter as facts, the description verbatim and never mined (D4). */
export function PlaceHeaderSection({ entity }: { entity: EntityRef }) {
  const places = usePlaces()
  const navigate = useNavigate()
  const place = places?.byId.get(entity.id)
  if (!places) return <p className="text-sm text-muted-foreground">Loading places…</p>
  if (!place) return <p className="text-sm text-muted-foreground">{`No place called "${entity.id}" on this map.`}</p>

  const isArea = (places.children.get(place.id)?.length ?? 0) > 0
  const Icon = isArea ? MapIcon : MapPinIcon
  const path = ancestors(places, place.id).reverse()

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-2">
        <Icon aria-hidden className="mt-1 size-4 shrink-0 text-muted-foreground" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2 className="text-base leading-tight font-semibold text-balance">{place.name}</h2>
          {path.length ? (
            <nav aria-label="Inside" className="-ml-1 flex min-w-0 flex-wrap items-center text-xs text-muted-foreground">
              {path.map((id, index) => (
                <span key={id} className="flex min-w-0 items-center">
                  {index > 0 ? <span aria-hidden>›</span> : null}
                  <PlaceChip id={id} className="text-xs font-normal text-muted-foreground" />
                </span>
              ))}
            </nav>
          ) : (
            <span className="text-xs text-muted-foreground">Top level</span>
          )}
        </div>
        <MockTag requires={['places']} />
      </div>
      <p className="text-sm leading-relaxed text-pretty">{place.summary}</p>
      {place.aliases.length ? (
        <p className="text-xs text-muted-foreground">
          Also called <span className="text-foreground">{place.aliases.join(', ')}</span>
        </p>
      ) : null}
      {place.bodyMarkdown ? (
        <details className="group rounded-lg border">
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium">Description</summary>
          <pre className="px-3 pb-3 font-sans text-sm leading-relaxed whitespace-pre-wrap text-muted-foreground">
            {place.bodyMarkdown}
          </pre>
        </details>
      ) : null}
      <Button
        size="sm"
        variant="outline"
        className="self-start"
        onClick={() => navigate({ view: 'world', 'world.by': null, 'world.in': `place:${place.id}` })}
      >
        <UsersIcon data-icon="inline-start" />
        Open in World
      </Button>
    </div>
  )
}
