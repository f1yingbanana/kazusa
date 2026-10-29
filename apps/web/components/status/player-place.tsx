'use client'

import { MapPinIcon } from 'lucide-react'
import { usePlace, usePlayer } from '@/hooks/use-location'
import { useSelection } from '@/hooks/use-url-state'

/** Where the player stands; opens that place, where "Go here" lives too. */
export function PlayerPlaceItem() {
  const player = usePlayer()
  const place = usePlace(player.placeId)
  const [, select] = useSelection()
  if (!place) return null
  return (
    <button
      type="button"
      className="flex items-center gap-1 hover:text-foreground"
      onClick={() => select({ kind: 'place', id: place.id })}
    >
      <MapPinIcon className="size-3" aria-hidden />
      {`You're at ${place.name}`}
    </button>
  )
}
