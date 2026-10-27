'use client'

import { ListIcon, MessageCircleIcon, StarIcon } from 'lucide-react'
import { PresenceAvatar } from '@/components/entities/presence-avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useCharacter } from '@/hooks/use-characters'
import { useNavigate } from '@/hooks/use-url-state'
import { useSources } from '@/lib/source/provider'
import type { EntityRef } from '@/lib/state/entity-ref'
import { toggleWatch, useWatchlist } from '@/lib/state/watchlist'
import { cn } from '@/lib/utils'

const KIND_LABEL = { agent: 'Simulated', npc: 'NPC', player: 'Player' } as const

export function CharacterHeaderSection({ entity }: { entity: EntityRef }) {
  const character = useCharacter(entity.id)
  const watchlist = useWatchlist()
  const navigate = useNavigate()
  const { resolved } = useSources()
  const starred = watchlist.includes(entity.id)

  if (!character) {
    return <p className="text-sm text-muted-foreground">{`Unknown character "${entity.id}".`}</p>
  }

  const subtitle = [character.occupation, character.affiliation].filter(Boolean).join(' · ')
  const canMessage = character.kind === 'agent' && resolved.chats === 'live'

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <PresenceAvatar
          id={character.id}
          name={character.name}
          avatarUrl={character.avatarUrl}
          kind={character.kind}
          size="lg"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-1 pt-1">
          <h2 className="truncate text-base leading-tight font-semibold text-balance">{character.name}</h2>
          {subtitle ? <p className="truncate text-sm text-muted-foreground">{subtitle}</p> : null}
          <div className="flex items-center gap-1.5">
            <Badge variant="outline">{KIND_LABEL[character.kind]}</Badge>
            <span className="truncate font-mono text-[11px] text-muted-foreground">{character.id}</span>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-pressed={starred}
          onClick={() => toggleWatch(character.id)}
        >
          <StarIcon className={cn(starred && 'fill-current')} />
          <span className="sr-only">{starred ? 'Remove from watchlist' : 'Add to watchlist'}</span>
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        {canMessage ? (
          <Button size="sm" onClick={() => navigate({ view: 'chats', 'chats.dm': character.id })}>
            <MessageCircleIcon data-icon="inline-start" />
            Message
          </Button>
        ) : null}
        {resolved.timeline !== 'unavailable' ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => navigate({ view: 'timeline', 'tl.actors': character.id, 'tl.watch': null })}
          >
            <ListIcon data-icon="inline-start" />
            Open in Timeline
          </Button>
        ) : null}
      </div>
    </div>
  )
}
