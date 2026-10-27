'use client'

import { useState } from 'react'
import { SquarePenIcon, UnplugIcon } from 'lucide-react'
import { PanelToolbar } from '@/components/shell/panel-toolbar'
import { NeedsLine } from '@/components/entities/source-state'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useCharacters } from '@/hooks/use-characters'
import { useChats } from '@/hooks/use-chats'
import { useNavigate, useParam } from '@/hooks/use-url-state'
import type { SectionSidebarProps } from '@/lib/registry/types'
import { setDraftChat } from '@/lib/state/chat-draft'
import { useKazusaConfig } from '@/lib/state/config-store'
import { ChatList } from './chat-list'
import { NewGroupDialog } from './new-group-dialog'

/**
 * The player's conversations: the Chats section's sidebar, and the Chats
 * view's first screen on narrow screens.
 */
export function ChatsPanel({ onNavigated: onOpened }: SectionSidebarProps) {
  const config = useKazusaConfig()
  const { chats, error, isLoading, reload } = useChats()
  const { byId } = useCharacters()
  const navigate = useNavigate()
  const chatId = useParam('chats.id')
  const [query, setQuery] = useState('')
  const [newGroupOpen, setNewGroupOpen] = useState(false)

  function openChat(id: string) {
    navigate({ view: 'chats', 'chats.id': id })
    onOpened?.()
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PanelToolbar
        query={query}
        onQueryChange={setQuery}
        placeholder={chats.length > 0 ? `Search ${chats.length} chats` : 'Search chats'}
        label="Search chats"
      >
        <Tooltip>
          <TooltipTrigger render={<Button variant="ghost" size="icon-sm" onClick={() => setNewGroupOpen(true)} />}>
            <SquarePenIcon />
            <span className="sr-only">New group</span>
          </TooltipTrigger>
          <TooltipContent>New group</TooltipContent>
        </Tooltip>
      </PanelToolbar>

      {error ? (
        <div className="flex items-start gap-2 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
          <UnplugIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          <p className="flex-1">{"Can't reach the Kazusa server, so your chats aren't loaded."}</p>
          <Button size="xs" variant="ghost" onClick={() => void reload()}>
            Retry
          </Button>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ChatList
            chats={chats}
            agentsById={byId}
            userId={config.userId}
            isLoading={isLoading}
            query={query}
            selectedChatId={chatId}
            onSelect={openChat}
            onNewGroup={() => setNewGroupOpen(true)}
          />
          <div className="px-4 pt-2 pb-4">
            <NeedsLine requires={['observe']}>Other characters&apos; chats appear here, read-only.</NeedsLine>
          </div>
        </div>
      )}

      <NewGroupDialog
        open={newGroupOpen}
        onOpenChange={setNewGroupOpen}
        onCreated={(chat) => {
          setDraftChat(chat)
          openChat(chat.id)
        }}
      />
    </div>
  )
}
