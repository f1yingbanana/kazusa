'use client'

import { HashIcon, MessagesSquareIcon, UsersIcon } from 'lucide-react'
import { CharacterRow } from '@/components/entities/character-row'
import { CharacterChip, useChatTitle } from '@/components/entities/chips'
import { MockTag } from '@/components/entities/source-state'
import { Button } from '@/components/ui/button'
import { useCharacters } from '@/hooks/use-characters'
import { useChats } from '@/hooks/use-chats'
import { useNavigate, useSelection } from '@/hooks/use-url-state'
import { useSources } from '@/lib/source/provider'
import { useKazusaConfig } from '@/lib/state/config-store'
import { useWatchlist } from '@/lib/state/watchlist'
import type { EntityRef } from '@/lib/state/entity-ref'
import { formatSimDate, formatSimTime } from '@/lib/time/sim'

export function ChatSummarySection({ entity }: { entity: EntityRef }) {
  const { chats } = useChats()
  const { world } = useSources()
  const navigate = useNavigate()
  const [, select] = useSelection()
  const { byId } = useCharacters()
  const config = useKazusaConfig()
  const watchlist = useWatchlist()
  const watchSet = new Set(watchlist)
  const { title, type, mine } = useChatTitle(entity.id)
  const chat = chats.find((c) => c.id === entity.id)
  const members = chat?.members ?? world?.chats.find((c) => c.id === entity.id)?.members ?? []
  const Icon = type === 'group' ? UsersIcon : HashIcon

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-2">
        <Icon aria-hidden className="mt-1 size-4 shrink-0 text-muted-foreground" />
        <div className="flex min-w-0 flex-1 flex-col">
          <h2 className="truncate text-base font-semibold">{title}</h2>
          <p className="text-sm text-muted-foreground">
            {type === 'group' ? 'Group' : 'Direct'} · {members.length} members
            {mine ? '' : ' · observed'}
          </p>
        </div>
        {!mine ? <MockTag requires={['timeline']} /> : null}
      </div>
      {chat?.lastMessage ? (
        <p className="font-mono text-xs text-muted-foreground tabular-nums">
          {`Last message ${formatSimDate(chat.lastMessage.timestamp)} · ${formatSimTime(chat.lastMessage.timestamp)}`}
        </p>
      ) : null}
      <div className="-mx-2 flex flex-col">
        {members.map((id) => {
          const character = byId.get(id)
          return character ? (
            <CharacterRow
              key={id}
              character={character}
              selected={false}
              starred={watchSet.has(id)}
              onSelect={(next) => select({ kind: 'character', id: next })}
            />
          ) : id === config.userId ? null : (
            <CharacterChip key={id} id={id} className="mx-2 self-start" />
          )
        })}
      </div>
      {mine ? (
        <Button size="sm" variant="outline" className="self-start" onClick={() => navigate({ view: 'chats', 'chats.id': entity.id })}>
          <MessagesSquareIcon data-icon="inline-start" />
          Open in Chats
        </Button>
      ) : (
        <p className="text-xs leading-relaxed text-muted-foreground">
          Reading this chat needs <span className="font-mono">observe</span>.
        </p>
      )}
    </div>
  )
}
