'use client'

import { BotIcon, MessageCircleIcon } from 'lucide-react'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item'
import { Spinner } from '@/components/ui/spinner'
import type { Agent } from '@kazusa/client'
import { ParticipantAvatar } from './chat-avatar'
import { ListSkeleton } from './chat-list'

export function AgentList({
  agents,
  isLoading,
  query,
  pendingAgentId,
  onMessage,
}: {
  agents: Agent[]
  isLoading: boolean
  query: string
  pendingAgentId: string | null
  onMessage: (agent: Agent) => void
}) {
  if (isLoading) return <ListSkeleton />

  if (agents.length === 0) {
    return (
      <Empty className="border-none">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <BotIcon />
          </EmptyMedia>
          <EmptyTitle>No agents configured</EmptyTitle>
          <EmptyDescription>
            Agents registered on the server will appear here.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  const normalized = query.trim().toLowerCase()
  const filtered = normalized
    ? agents.filter(
        (agent) =>
          agent.name.toLowerCase().includes(normalized) ||
          agent.id.toLowerCase().includes(normalized),
      )
    : agents

  if (filtered.length === 0) {
    return (
      <p className="px-4 py-8 text-center text-sm text-muted-foreground">
        {'No agents match “'}
        {query}
        {'”.'}
      </p>
    )
  }

  return (
    <ItemGroup className="gap-0.5 px-2 pb-2">
      {filtered.map((agent) => (
        <Item
          key={agent.id}
          size="sm"
          render={<button type="button" disabled={pendingAgentId !== null} />}
          onClick={() => onMessage(agent)}
          className="group/agent w-full cursor-pointer text-left hover:bg-sidebar-accent/70"
        >
          <ItemMedia aria-hidden>
            <ParticipantAvatar participant={agent} size="lg" />
          </ItemMedia>
          <ItemContent className="min-w-0">
            <ItemTitle className="truncate">{agent.name}</ItemTitle>
            <ItemDescription className="truncate font-mono text-xs">
              {agent.id}
            </ItemDescription>
          </ItemContent>
          <ItemActions className="text-muted-foreground">
            {pendingAgentId === agent.id ? (
              <Spinner />
            ) : (
              <MessageCircleIcon
                aria-hidden
                className="size-4 opacity-0 transition-opacity group-hover/agent:opacity-100 group-focus-visible/agent:opacity-100"
              />
            )}
            <span className="sr-only">Message {agent.name}</span>
          </ItemActions>
        </Item>
      ))}
    </ItemGroup>
  )
}
