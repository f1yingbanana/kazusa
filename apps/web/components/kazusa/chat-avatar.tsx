import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { initials } from '@/lib/kazusa/format'
import type { Agent } from '@kazusa/client'
import type { Chat } from '@/lib/kazusa/types'
import { cn } from '@/lib/utils'

export type Participant = {
  id: string
  name: string
  avatarUrl?: string
  isSelf: boolean
  isAgent: boolean
}

export function resolveParticipant(
  id: string,
  agentsById: Map<string, Agent>,
  self: { userId: string; userName: string },
): Participant {
  if (id === self.userId) {
    return { id, name: self.userName || 'You', isSelf: true, isAgent: false }
  }
  const agent = agentsById.get(id)
  if (agent) {
    return { id, name: agent.name, avatarUrl: agent.avatarUrl, isSelf: false, isAgent: true }
  }
  return { id, name: id, isSelf: false, isAgent: false }
}

export function ParticipantAvatar({
  participant,
  size = 'default',
  className,
}: {
  participant: Pick<Participant, 'name' | 'avatarUrl'>
  size?: 'default' | 'sm' | 'lg'
  className?: string
}) {
  return (
    <Avatar size={size} className={className}>
      {participant.avatarUrl ? (
        <AvatarImage src={participant.avatarUrl} alt="" />
      ) : null}
      <AvatarFallback>{initials(participant.name)}</AvatarFallback>
    </Avatar>
  )
}

export function ChatAvatar({
  chat,
  agentsById,
  userId,
  className,
}: {
  chat: Chat
  agentsById: Map<string, Agent>
  userId: string
  className?: string
}) {
  const others = chat.members.filter((member) => member !== userId)
  const self = { userId, userName: 'You' }

  if (chat.type === 'direct' || others.length <= 1) {
    const participant = others[0]
      ? resolveParticipant(others[0], agentsById, self)
      : { name: chat.name }
    return <ParticipantAvatar participant={participant} size="lg" className={className} />
  }

  const [first, second] = others.map((id) => resolveParticipant(id, agentsById, self))

  return (
    <div aria-hidden className={cn('relative size-10 shrink-0', className)}>
      <ParticipantAvatar
        participant={first}
        size="sm"
        className="absolute top-0 left-0 size-7"
      />
      <ParticipantAvatar
        participant={second}
        size="sm"
        className="absolute right-0 bottom-0 size-7 ring-2 ring-sidebar"
      />
    </div>
  )
}
