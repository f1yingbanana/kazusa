'use client'

import { HashIcon, MessagesSquareIcon, UsersIcon } from 'lucide-react'
import { CharacterChip, useChatTitle } from '@/components/entities/chips'
import { MockTag } from '@/components/entities/source-state'
import { Button } from '@/components/ui/button'
import { useChats } from '@/hooks/use-chats'
import { useNavigate } from '@/hooks/use-url-state'
import { useSources } from '@/lib/source/provider'
import type { EntityRef } from '@/lib/state/entity-ref'
import { formatSimDate, formatSimTime } from '@/lib/time/sim'

export function ChatSummarySection({ entity }: { entity: EntityRef }) {
  const { chats } = useChats()
  const { world } = useSources()
  const navigate = useNavigate()
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
      <div className="flex flex-wrap gap-1">
        {members.map((id) => (
          <CharacterChip key={id} id={id} />
        ))}
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
