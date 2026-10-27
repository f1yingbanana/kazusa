'use client'

import { useEffect, useRef, useState } from 'react'
import { CircleAlertIcon, EyeIcon, MessagesSquareIcon, SearchIcon, SquarePenIcon } from 'lucide-react'
import { NeedsLine } from '@/components/entities/source-state'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useCharacters } from '@/hooks/use-characters'
import { useChatActions, useChats } from '@/hooks/use-chats'
import { useNavigate, useParam } from '@/hooks/use-url-state'
import { useRealtime } from '@/lib/live/realtime-provider'
import type { Chat } from '@/lib/source/chats/types'
import { useKazusaConfig } from '@/lib/state/config-store'
import { cn } from '@/lib/utils'
import { ChatList } from './chat-list'
import { ChatView } from './chat-view'
import { NewGroupDialog } from './new-group-dialog'

/**
 * Params: `chats.id` (open chat), `chats.dm` (start/open a direct chat with a
 * character, then replaced by `chats.id`). `chats.msg` deep-link highlighting
 * is on the roadmap.
 */
export function ChatsView() {
  const config = useKazusaConfig()
  const { chats, error, reload } = useChats()
  const { byId } = useCharacters()
  const { createChat } = useChatActions()
  const { setActiveChat } = useRealtime()
  const navigate = useNavigate()
  const chatId = useParam('chats.id')
  const dmTarget = useParam('chats.dm')
  const [draft, setDraft] = useState<Chat | null>(null)
  const [query, setQuery] = useState('')
  const [newGroupOpen, setNewGroupOpen] = useState(false)

  const selected = chats.find((chat) => chat.id === chatId) ?? (draft?.id === chatId ? draft : null)

  useEffect(() => {
    setActiveChat(selected?.id ?? null)
  }, [selected?.id, setActiveChat])

  useEffect(() => {
    if (draft && !draft.draft && chats.some((chat) => chat.id === draft.id)) setDraft(null)
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
    setDraft(next)
    navigate({ 'chats.id': next.id, 'chats.dm': null }, 'replace')
  }, [dmTarget, chats, config.userId, byId, createChat, navigate])

  function openChat(id: string | null) {
    navigate({ 'chats.id': id })
  }

  return (
    <div className="flex min-h-0 flex-1">
      <aside
        aria-label="Conversations"
        className={cn('flex min-h-0 w-full flex-col border-r md:w-72 md:shrink-0', selected && 'hidden md:flex')}
      >
        <div className="flex shrink-0 flex-col gap-2 p-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">Mine</h2>
            <Tooltip>
              <TooltipTrigger render={<Button variant="ghost" size="icon-sm" onClick={() => setNewGroupOpen(true)} />}>
                <SquarePenIcon />
                <span className="sr-only">New group</span>
              </TooltipTrigger>
              <TooltipContent>New group</TooltipContent>
            </Tooltip>
          </div>
          <InputGroup className="h-8">
            <InputGroupAddon>
              <SearchIcon />
            </InputGroupAddon>
            <InputGroupInput
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search conversations"
              aria-label="Search conversations"
            />
          </InputGroup>
        </div>

        {error ? (
          <div className="px-3 pb-3">
            <Alert variant="destructive">
              <CircleAlertIcon />
              <AlertTitle>{"Can't reach the server"}</AlertTitle>
              <AlertDescription>
                <p>{error.message}</p>
                <Button size="xs" variant="outline" className="mt-2" onClick={() => void reload()}>
                  Retry
                </Button>
              </AlertDescription>
            </Alert>
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto">
          <ChatList
            chats={chats}
            agentsById={byId}
            userId={config.userId}
            isLoading={false}
            query={query}
            selectedChatId={selected?.id ?? null}
            onSelect={openChat}
            onNewGroup={() => setNewGroupOpen(true)}
          />
        </div>

        <section aria-label="Observed chats" className="flex shrink-0 flex-col gap-1 border-t p-3">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold">
            <EyeIcon className="size-3.5 text-muted-foreground" />
            Observed
          </h2>
          <NeedsLine requires={['observe']}>Read-only view of every other chat.</NeedsLine>
        </section>
      </aside>

      <main className={cn('min-w-0 flex-1', selected ? 'flex' : 'hidden md:flex')}>
        {selected ? (
          <ChatView
            key={selected.id}
            chat={selected}
            onBack={() => openChat(null)}
            onSent={(chat) => {
              setDraft(chat)
              openChat(chat.id)
            }}
          />
        ) : (
          <Empty className="border-none">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <MessagesSquareIcon />
              </EmptyMedia>
              <EmptyTitle>Pick a conversation</EmptyTitle>
              <EmptyDescription>
                Select a character and choose Message to talk one-on-one, or start a group where several
                characters answer side by side.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </main>

      <NewGroupDialog
        open={newGroupOpen}
        onOpenChange={setNewGroupOpen}
        onCreated={(chat) => {
          setDraft(chat)
          openChat(chat.id)
        }}
      />
    </div>
  )
}
