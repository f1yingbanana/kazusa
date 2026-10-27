'use client'

import { useState } from 'react'
import { UserMinusIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item'
import { Separator } from '@/components/ui/separator'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Spinner } from '@/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useChatActions } from '@/hooks/use-chats'
import type { Agent } from '@kazusa/client'
import type { Chat } from '@/lib/source/chats/types'
import { AgentChecklist } from './agent-checklist'
import { ParticipantAvatar, type Participant } from './chat-avatar'

export function MembersSheet({
  open,
  onOpenChange,
  chat,
  agents,
  resolve,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  chat: Chat
  agents: Agent[]
  resolve: (id: string) => Participant
}) {
  const { changeMembers } = useChatActions()
  const [toAdd, setToAdd] = useState<Set<string>>(new Set())
  const [isAdding, setIsAdding] = useState(false)
  const [removingId, setRemovingId] = useState<string | null>(null)

  const members = chat.members.map((id) => resolve(id))
  const candidates = agents.filter((agent) => !chat.members.includes(agent.id))

  async function handleAdd() {
    if (toAdd.size === 0) return
    setIsAdding(true)
    try {
      await changeMembers(chat.sessionKey, 'add_members', [...toAdd])
      toast.success(
        toAdd.size === 1 ? 'Agent added' : `${toAdd.size} agents added`,
      )
      setToAdd(new Set())
    } catch (error) {
      toast.error('Could not add members', {
        description: error instanceof Error ? error.message : undefined,
      })
    } finally {
      setIsAdding(false)
    }
  }

  async function handleRemove(member: Participant) {
    setRemovingId(member.id)
    try {
      await changeMembers(chat.sessionKey, 'remove_members', [member.id])
      toast.success(`${member.name} removed`)
    } catch (error) {
      toast.error(`Could not remove ${member.name}`, {
        description: error instanceof Error ? error.message : undefined,
      })
    } finally {
      setRemovingId(null)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 sm:max-w-sm">
        <SheetHeader>
          <SheetTitle>Members</SheetTitle>
          <SheetDescription>
            {members.length} in {chat.name}
          </SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-4 pb-4">
          <ItemGroup className="gap-1">
            {members.map((member) => (
              <Item key={member.id} size="sm" className="px-2">
                <ItemMedia>
                  <ParticipantAvatar participant={member} />
                </ItemMedia>
                <ItemContent className="min-w-0">
                  <ItemTitle className="truncate">{member.name}</ItemTitle>
                  <ItemDescription className="truncate font-mono text-xs">
                    {member.id}
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  {member.isSelf ? (
                    <Badge variant="secondary">You</Badge>
                  ) : (
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            disabled={removingId !== null}
                            onClick={() => handleRemove(member)}
                          />
                        }
                      >
                        {removingId === member.id ? <Spinner /> : <UserMinusIcon />}
                        <span className="sr-only">Remove {member.name}</span>
                      </TooltipTrigger>
                      <TooltipContent>Remove from group</TooltipContent>
                    </Tooltip>
                  )}
                </ItemActions>
              </Item>
            ))}
          </ItemGroup>

          <Separator />

          <section aria-labelledby="add-agents-heading" className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <h3 id="add-agents-heading" className="text-sm font-medium">
                Add agents
              </h3>
              <p className="text-sm text-muted-foreground">
                {candidates.length === 0
                  ? 'Every available agent is already here.'
                  : 'New members see messages sent from now on.'}
              </p>
            </div>
            {candidates.length > 0 ? (
              <AgentChecklist
                agents={candidates}
                selected={toAdd}
                idPrefix={`add-${chat.id}`}
                onToggle={(agentId, checked) =>
                  setToAdd((current) => {
                    const next = new Set(current)
                    if (checked) next.add(agentId)
                    else next.delete(agentId)
                    return next
                  })
                }
              />
            ) : null}
          </section>
        </div>

        {candidates.length > 0 ? (
          <SheetFooter className="border-t">
            <Button onClick={handleAdd} disabled={toAdd.size === 0 || isAdding}>
              {isAdding ? <Spinner data-icon="inline-start" /> : null}
              {toAdd.size > 1 ? `Add ${toAdd.size} agents` : 'Add agent'}
            </Button>
          </SheetFooter>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}
