'use client'

import { ChevronLeftIcon, MapPinIcon, UsersIcon } from 'lucide-react'
import type { CharacterSummary } from '@kazusa/client'
import { PresenceAvatar } from '@/components/entities/presence-avatar'
import { taskIcon } from '@/components/entities/task-icon'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useCharacterStatus, useCharacters } from '@/hooks/use-characters'
import { useSimNow } from '@/hooks/use-clock'
import { usePlace } from '@/hooks/use-location'
import { useSelection } from '@/hooks/use-url-state'
import { formatTypingLabel } from '@/lib/format'
import type { Typist } from '@/lib/live/realtime-provider'
import { chatSubject, listNames } from '@/lib/source/chats/display'
import type { Chat } from '@/lib/source/chats/types'
import { sameEntity } from '@/lib/state/entity-ref'
import { requestInspector } from '@/lib/state/inspector-request'
import { formatSimDuration } from '@/lib/time/sim'
import { cn } from '@/lib/utils'

const MAX_STACK = 3

/**
 * What a reply that hasn't come yet is waiting on: "Reading · 34m left".
 * Task text is shown verbatim, never parsed (D7).
 */
function Activity({ character }: { character: CharacterSummary | undefined }) {
  const status = useCharacterStatus(character?.kind === 'agent' ? character.id : undefined)
  const now = useSimNow()
  const task = status?.task
  if (!task) {
    return <span className="truncate">{character?.occupation ?? 'Direct message'}</span>
  }
  const Icon = taskIcon(task.type)
  return (
    <>
      <Icon aria-hidden className="size-3 shrink-0" />
      <span className="truncate">{task.description}</span>
      {now > 0 && task.endAt > now ? (
        <span className="shrink-0 font-mono tabular-nums">{`· ${formatSimDuration(task.endAt - now)} left`}</span>
      ) : null}
    </>
  )
}

/**
 * Tapping the identity area reopens the inspector on the chat's subject: the
 * character for a DM, the chat (each member's activity) otherwise. A huddle
 * names where it is happening: it is face to face, not on the phone.
 */
export function ChatHeader({
  chat,
  userId,
  typists,
  onBack,
  onOpenMembers,
}: {
  chat: Chat
  userId: string
  typists: readonly Typist[]
  onBack: () => void
  onOpenMembers: () => void
}) {
  const { byId } = useCharacters()
  const [selection, select] = useSelection()
  const place = usePlace(chat.placeId)
  const isDirect = chat.type === 'direct'
  const others = chat.members.filter((id) => id !== userId)
  const partner = isDirect ? byId.get(others[0] ?? '') : undefined
  const known = others.map((id) => byId.get(id)).filter((c): c is CharacterSummary => Boolean(c))

  const target = chatSubject(chat, userId)
  const isSelected = target !== null && sameEntity(target, selection)
  const typing = typists.length > 0

  const identity = (
    <>
      {!isDirect ? (
        <span aria-hidden className="flex shrink-0 items-center pl-0.5">
          {known.slice(0, MAX_STACK).map((member, index) => (
            <PresenceAvatar
              key={member.id}
              id={member.id}
              name={member.name}
              avatarUrl={member.avatarUrl}
              kind={member.kind}
              size="sm"
              className={cn('ring-2 ring-background', index > 0 && '-ml-2')}
            />
          ))}
        </span>
      ) : (
        <PresenceAvatar
          id={others[0] ?? chat.id}
          name={partner?.name ?? chat.name}
          avatarUrl={partner?.avatarUrl}
          kind={partner?.kind}
          size="md"
        />
      )}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm leading-tight font-semibold">{chat.name}</span>
        <span
          className={cn(
            'flex min-w-0 items-center gap-1 text-xs leading-tight text-muted-foreground',
            typing && 'shimmer text-primary',
          )}
        >
          {typing ? (
            <span className="truncate">
              {isDirect
                ? 'typing…'
                : formatTypingLabel(
                    typists.map((t) => t.senderName),
                    chat.type === 'huddle' ? 'about to speak' : undefined,
                  )}
            </span>
          ) : chat.type === 'huddle' ? (
            <>
              <MapPinIcon aria-hidden className="size-3 shrink-0" />
              <span className="truncate">{`In person at ${place?.name ?? 'the same place'}`}</span>
            </>
          ) : chat.type === 'group' ? (
            <span className="truncate">{listNames(known.map((member) => member.name)) || 'Just you'}</span>
          ) : (
            <Activity character={partner} />
          )}
        </span>
      </span>
    </>
  )

  return (
    <header className="flex h-14 shrink-0 items-center gap-1 border-b px-2">
      <Button variant="ghost" size="icon-sm" className="lg:hidden" onClick={onBack}>
        <ChevronLeftIcon />
        <span className="sr-only">Back to chats</span>
      </Button>

      {target ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                onClick={() => {
                  select(target)
                  requestInspector()
                }}
                aria-pressed={isSelected}
              />
            }
            className={cn(
              'flex h-11 min-w-0 flex-1 items-center gap-2.5 rounded-md px-2 text-left outline-none hover:bg-accent/60 focus-visible:outline-2 focus-visible:outline-ring',
              isSelected && 'bg-accent/60',
            )}
          >
            {identity}
          </TooltipTrigger>
          <TooltipContent>{isDirect ? `About ${partner?.name ?? chat.name}` : 'Chat details'}</TooltipContent>
        </Tooltip>
      ) : (
        <div className="flex h-11 min-w-0 flex-1 items-center gap-2.5 px-2">{identity}</div>
      )}

      {chat.type === 'group' && !chat.draft ? (
        <Tooltip>
          <TooltipTrigger render={<Button variant="ghost" size="sm" onClick={onOpenMembers} />}>
            <UsersIcon data-icon="inline-start" />
            <span className="font-mono text-xs tabular-nums">{chat.members.length}</span>
            <span className="sr-only">Manage members</span>
          </TooltipTrigger>
          <TooltipContent>Manage members</TooltipContent>
        </Tooltip>
      ) : null}
    </header>
  )
}
