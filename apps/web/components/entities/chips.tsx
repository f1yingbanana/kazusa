'use client'

import { MapPinIcon, MessageCircleIcon, SpeechIcon, UsersIcon, type LucideIcon } from 'lucide-react'
import type { ChatType } from '@kazusa/client'
import { useChats } from '@/hooks/use-chats'
import { useCharacter } from '@/hooks/use-characters'
import { usePlace } from '@/hooks/use-location'
import { useNavigate } from '@/hooks/use-url-state'
import { useSources } from '@/lib/source/provider'
import { serializeEntityRef } from '@/lib/state/entity-ref'
import { cn } from '@/lib/utils'
import { PresenceAvatar } from './presence-avatar'

const chipClass =
  'inline-flex max-w-40 min-w-0 items-center sm:max-w-48 gap-1.5 rounded-md px-1 py-0.5 align-middle text-sm font-medium text-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring'

export function CharacterChip({ id, className }: { id: string; className?: string }) {
  const character = useCharacter(id)
  const navigate = useNavigate()
  const name = character?.name ?? id
  return (
    <button
      type="button"
      className={cn(chipClass, className)}
      onClick={() => navigate({ sel: serializeEntityRef({ kind: 'character', id }) })}
    >
      <PresenceAvatar id={id} name={name} avatarUrl={character?.avatarUrl} kind={character?.kind} size="xs" />
      <span className="truncate">{name}</span>
    </button>
  )
}

const CHAT_ICON: Record<ChatType, LucideIcon> = {
  direct: MessageCircleIcon,
  group: UsersIcon,
  huddle: SpeechIcon,
}

/** Text chats are on the phone; a huddle is people talking face to face. */
export function chatIcon(type: ChatType): LucideIcon {
  return CHAT_ICON[type]
}

/** Resolves a chat title from the player's chats, then the mock world, then the id. */
export function useChatTitle(id: string): {
  title: string
  type: ChatType
  mine: boolean
  placeId?: string
} {
  const { chats } = useChats()
  const { world } = useSources()
  const mine = chats.find((chat) => chat.id === id)
  if (mine) return { title: mine.name, type: mine.type, mine: true, placeId: mine.placeId }
  const mocked = world?.chats.find((chat) => chat.id === id)
  if (mocked) return { title: mocked.title, type: mocked.type, mine: false }
  return { title: id, type: id.startsWith('direct') ? ('direct' as const) : ('group' as const), mine: false }
}

export function ChatChip({ id, className }: { id: string; className?: string }) {
  const { title, type } = useChatTitle(id)
  const navigate = useNavigate()
  const Icon = chatIcon(type)
  return (
    <button
      type="button"
      className={cn(chipClass, className)}
      onClick={() => navigate({ sel: serializeEntityRef({ kind: 'chat', id }) })}
    >
      <Icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate">{title}</span>
    </button>
  )
}

/** `bare` drops the pin where the context already says it is a place. */
export function PlaceChip({ id, bare, className }: { id: string; bare?: boolean; className?: string }) {
  const place = usePlace(id)
  const navigate = useNavigate()
  return (
    <button
      type="button"
      title={place?.summary}
      className={cn(chipClass, className)}
      onClick={() => navigate({ sel: serializeEntityRef({ kind: 'place', id }) })}
    >
      {bare ? null : <MapPinIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />}
      <span className="truncate">{place?.name ?? id}</span>
    </button>
  )
}
