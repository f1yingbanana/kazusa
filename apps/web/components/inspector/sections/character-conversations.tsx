'use client'

import { HashIcon, UsersIcon } from 'lucide-react'
import { NeedsLine } from '@/components/entities/source-state'
import { useChats } from '@/hooks/use-chats'
import { useNavigate } from '@/hooks/use-url-state'
import { useRealtime } from '@/lib/live/realtime-provider'
import type { EntityRef } from '@/lib/state/entity-ref'

/** The player's chats this character is in. Observed chats need the `observe` domain. */
export function CharacterConversationsSection({ entity }: { entity: EntityRef }) {
  const { chats } = useChats()
  const { typingByChat } = useRealtime()
  const navigate = useNavigate()
  const shared = chats.filter((chat) => chat.members.includes(entity.id))

  return (
    <div className="flex flex-col gap-2">
      {shared.length === 0 ? (
        <p className="text-sm text-muted-foreground">No chats with you yet.</p>
      ) : (
        <ul className="-mx-2 flex flex-col">
          {shared.map((chat) => {
            const live = (typingByChat[chat.id] ?? []).length > 0
            const Icon = chat.type === 'group' ? UsersIcon : HashIcon
            return (
              <li key={chat.id}>
                <button
                  type="button"
                  onClick={() => navigate({ view: 'chats', 'chats.id': chat.id })}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
                >
                  <Icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{chat.name}</span>
                  {live ? (
                    <span className="flex items-center gap-1 text-xs text-primary">
                      <span aria-hidden className="size-1.5 rounded-full bg-primary" />
                      typing
                    </span>
                  ) : null}
                </button>
              </li>
            )
          })}
        </ul>
      )}
      <NeedsLine requires={['observe']}>Chats you are not in:</NeedsLine>
    </div>
  )
}
