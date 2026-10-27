'use client'

import { useEffect, useRef } from 'react'
import { MessagesSquareIcon } from 'lucide-react'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { useCharacters } from '@/hooks/use-characters'
import { useChatActions, useChats } from '@/hooks/use-chats'
import { useNavigate, useParam } from '@/hooks/use-url-state'
import { useRealtime } from '@/lib/live/realtime-provider'
import { setDraftChat, useDraftChat } from '@/lib/state/chat-draft'
import { useKazusaConfig } from '@/lib/state/config-store'
import { ChatView } from './chat-view'
import { ChatsPanel } from './chats-panel'

/**
 * The open conversation. The chat list lives in the sidebar's Chats tab; on
 * narrow screens (sidebar is a sheet) it renders inline here instead.
 *
 * Params: `chats.id` (open chat), `chats.dm` (start/open a direct chat with a
 * character, then replaced by `chats.id`). `chats.msg` deep-link highlighting
 * is on the roadmap.
 */
export function ChatsView() {
  const config = useKazusaConfig()
  const { chats } = useChats()
  const { byId } = useCharacters()
  const { createChat } = useChatActions()
  const { setActiveChat } = useRealtime()
  const navigate = useNavigate()
  const chatId = useParam('chats.id')
  const dmTarget = useParam('chats.dm')
  const draft = useDraftChat()

  const selected = chats.find((chat) => chat.id === chatId) ?? (draft?.id === chatId ? draft : null)

  useEffect(() => {
    setActiveChat(selected?.id ?? null)
  }, [selected?.id, setActiveChat])

  useEffect(() => {
    if (draft && !draft.draft && chats.some((chat) => chat.id === draft.id)) setDraftChat(null)
  }, [chats, draft])

  const handledDm = useRef<string | null>(null)
  useEffect(() => {
    if (!dmTarget) {
      handledDm.current = null
      return
    }
    if (handledDm.current === dmTarget) return
    handledDm.current = dmTarget
    const existing = chats.find(
      (chat) =>
        chat.type === 'direct' &&
        chat.members.includes(dmTarget) &&
        chat.members.every((member) => member === dmTarget || member === config.userId),
    )
    if (existing) {
      navigate({ 'chats.id': existing.id, 'chats.dm': null }, 'replace')
      return
    }
    const next = createChat({
      type: 'direct',
      name: byId.get(dmTarget)?.name ?? dmTarget,
      members: [dmTarget],
    })
    setDraftChat(next)
    navigate({ 'chats.id': next.id, 'chats.dm': null }, 'replace')
  }, [dmTarget, chats, config.userId, byId, createChat, navigate])

  if (selected) {
    return (
      <div className="flex min-h-0 flex-1">
        <ChatView
          key={selected.id}
          chat={selected}
          onBack={() => navigate({ 'chats.id': null })}
          onSent={(chat) => {
            setDraftChat(chat)
            navigate({ 'chats.id': chat.id })
          }}
        />
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-h-0 flex-1 flex-col lg:hidden">
        <ChatsPanel />
      </div>
      <Empty className="hidden border-none lg:flex">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <MessagesSquareIcon />
          </EmptyMedia>
          <EmptyTitle>Pick a conversation</EmptyTitle>
          <EmptyDescription>
            Choose one from Chats, or open a character and choose Message. A group lets several characters
            answer side by side.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  )
}
