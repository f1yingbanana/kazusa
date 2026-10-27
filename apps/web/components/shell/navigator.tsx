'use client'

import { MockTag } from '@/components/entities/source-state'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ChatsPanel } from '@/components/views/chats/chats-panel'
import { useRealtime } from '@/lib/live/realtime-provider'
import { RosterPanel } from './roster-panel'

export type NavigatorTab = 'chats' | 'characters'

/**
 * The single left sidebar: the player's chats and every character in the
 * world, as two tabs. Both panels stay mounted so search text and scroll
 * position survive tab switches.
 */
export function Navigator({
  tab,
  onTabChange,
  onNavigated,
}: {
  tab: NavigatorTab
  onTabChange: (tab: NavigatorTab) => void
  onNavigated?: () => void
}) {
  const { unreadByChat } = useRealtime()
  const unread = Object.values(unreadByChat).reduce((sum, count) => sum + count, 0)

  return (
    <Tabs
      value={tab}
      onValueChange={(value) => onTabChange(value as NavigatorTab)}
      className="flex min-h-0 flex-1 flex-col gap-0"
    >
      <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b px-3">
        <TabsList variant="line" aria-label="Sidebar">
          <TabsTrigger value="chats" className="px-2">
            Chats
            {unread > 0 ? (
              <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 font-mono text-[10px] leading-none text-primary-foreground tabular-nums">
                {unread > 99 ? '99+' : unread}
                <span className="sr-only"> unread</span>
              </span>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="characters" className="px-2">
            Characters
          </TabsTrigger>
        </TabsList>
        {tab === 'characters' ? <MockTag requires={['characters', 'status']} /> : null}
      </div>
      <TabsContent value="chats" keepMounted className="flex min-h-0 flex-col data-hidden:hidden">
        <ChatsPanel onOpened={onNavigated} />
      </TabsContent>
      <TabsContent value="characters" keepMounted className="flex min-h-0 flex-col data-hidden:hidden">
        <RosterPanel onSelected={onNavigated} />
      </TabsContent>
    </Tabs>
  )
}
