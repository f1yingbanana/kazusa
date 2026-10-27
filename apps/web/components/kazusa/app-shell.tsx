'use client'

import { useEffect, useState } from 'react'
import { MessagesSquareIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { useChatActions, useChats } from '@/hooks/use-kazusa'
import { useKazusaConfig } from '@/lib/kazusa/config-store'
import type { Agent } from '@kazusa/client'
import type { Chat } from '@/lib/kazusa/types'
import { cn } from '@/lib/utils'
import { ChatView } from './chat-view'
import { NewGroupDialog } from './new-group-dialog'
import { RealtimeProvider, useRealtime } from './realtime-provider'
import { SettingsDialog } from './settings-dialog'
import { Sidebar, type SidebarTab } from './sidebar'

export function AppShell() {
  return (
    <RealtimeProvider>
      <Workspace />
    </RealtimeProvider>
  )
}

function Workspace() {
  const config = useKazusaConfig()
  const { chats } = useChats()
  const { createChat } = useChatActions()
  const { setActiveChat } = useRealtime()
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Chat | null>(null)
  const [tab, setTab] = useState<SidebarTab>('chats')
  const [newGroupOpen, setNewGroupOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [pendingAgentId, setPendingAgentId] = useState<string | null>(null)

  const selectedChat = chats.find((chat) => chat.id === selectedChatId) ?? (draft?.id === selectedChatId ? draft : null)

  useEffect(() => {
    if (draft && !draft.draft && chats.some((chat) => chat.id === draft.id)) setDraft(null)
  }, [chats, draft])

  function selectChat(chatId: string | null) {
    setSelectedChatId(chatId)
    setActiveChat(chatId)
  }

  async function messageAgent(agent: Agent) {
    const existing = chats.find(
      (chat) =>
        chat.type === 'direct' &&
        chat.members.includes(agent.id) &&
        chat.members.every((member) => member === agent.id || member === config.userId),
    )
    if (existing) {
      selectChat(existing.id)
      setTab('chats')
      return
    }

    setPendingAgentId(agent.id)
    try {
      const chat = createChat({
        type: 'direct',
        name: agent.name,
        members: [agent.id],
      })
      if (chat) {
        setDraft(chat)
        selectChat(chat.id)
        setTab('chats')
      }
    } catch (error) {
      toast.error(`Could not start a chat with ${agent.name}`, {
        description: error instanceof Error ? error.message : undefined,
      })
    } finally {
      setPendingAgentId(null)
    }
  }

  return (
    <div className="flex h-dvh overflow-hidden">
      <Sidebar
        config={config}
        tab={tab}
        onTabChange={setTab}
        selectedChatId={selectedChatId}
        pendingAgentId={pendingAgentId}
        onSelectChat={selectChat}
        onMessageAgent={messageAgent}
        onNewGroup={() => setNewGroupOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
        className={cn('w-full md:w-80 md:shrink-0', selectedChat && 'hidden md:flex')}
      />

      <main className={cn('min-w-0 flex-1', selectedChat ? 'flex' : 'hidden md:flex')}>
        {selectedChat ? (
          <ChatView
            key={selectedChat.id}
            chat={selectedChat}
            onBack={() => selectChat(null)}
            onSent={(chat) => { setDraft(chat); selectChat(chat.id) }}
          />
        ) : (
          <Empty className="border-none">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <MessagesSquareIcon />
              </EmptyMedia>
              <EmptyTitle>Pick a conversation</EmptyTitle>
              <EmptyDescription>
                Message a single agent directly, or open a group where several agents
                answer side by side.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent className="flex-row justify-center">
              <Button size="sm" onClick={() => setTab('agents')}>
                Browse agents
              </Button>
              <Button size="sm" variant="outline" onClick={() => setNewGroupOpen(true)}>
                New group
              </Button>
            </EmptyContent>
          </Empty>
        )}
      </main>

      <NewGroupDialog
        open={newGroupOpen}
        onOpenChange={setNewGroupOpen}
        onCreated={(chat) => {
          setDraft(chat)
          selectChat(chat.id)
          setTab('chats')
        }}
      />
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  )
}
