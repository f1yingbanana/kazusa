'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { useAgents, useChatActions } from '@/hooks/use-kazusa'
import type { Chat } from '@/lib/kazusa/types'
import { AgentChecklist } from './agent-checklist'

export function NewGroupDialog({
  open,
  onOpenChange,
  onCreated,
  initialAgentIds = [],
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (chat: Chat) => void
  initialAgentIds?: string[]
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {open ? (
          <NewGroupForm
            initialAgentIds={initialAgentIds}
            onCreated={(chatId) => {
              onOpenChange(false)
              onCreated(chatId)
            }}
            onCancel={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function NewGroupForm({
  initialAgentIds,
  onCreated,
  onCancel,
}: {
  initialAgentIds: string[]
  onCreated: (chat: Chat) => void
  onCancel: () => void
}) {
  const { agents } = useAgents()
  const { createChat } = useChatActions()
  const [name, setName] = useState('')
  const [selected, setSelected] = useState(() => new Set(initialAgentIds))
  const [submitted, setSubmitted] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const nameInvalid = submitted && name.trim().length === 0
  const membersInvalid = submitted && selected.size === 0

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitted(true)
    if (!name.trim() || selected.size === 0) return

    setIsSubmitting(true)
    try {
      const chatId = createChat({
        type: 'group',
        name: name.trim(),
        members: [...selected],
      })
      if (chatId) onCreated(chatId)
      else onCancel()
    } catch (error) {
      toast.error('Could not create group', {
        description: error instanceof Error ? error.message : undefined,
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6" noValidate>
      <DialogHeader>
        <DialogTitle>New group</DialogTitle>
        <DialogDescription>
          Bring several agents into one conversation. Everyone sees every reply.
        </DialogDescription>
      </DialogHeader>

      <FieldGroup>
        <Field data-invalid={nameInvalid || undefined}>
          <FieldLabel htmlFor="group-name">Group name</FieldLabel>
          <Input
            id="group-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Project Alpha"
            autoComplete="off"
            autoFocus
            aria-invalid={nameInvalid || undefined}
          />
          {nameInvalid ? <FieldError>Give the group a name.</FieldError> : null}
        </Field>

        <FieldSet data-invalid={membersInvalid || undefined}>
          <FieldLegend variant="label">Agents</FieldLegend>
          <FieldDescription>
            {selected.size === 0
              ? 'Pick the agents to include.'
              : `${selected.size} selected`}
          </FieldDescription>
          {agents.length === 0 ? (
            <p className="text-sm text-muted-foreground">No agents are available.</p>
          ) : (
            <AgentChecklist
              agents={agents}
              selected={selected}
              idPrefix="new-group"
              onToggle={(agentId, checked) =>
                setSelected((current) => {
                  const next = new Set(current)
                  if (checked) next.add(agentId)
                  else next.delete(agentId)
                  return next
                })
              }
            />
          )}
          {membersInvalid ? <FieldError>Select at least one agent.</FieldError> : null}
        </FieldSet>
      </FieldGroup>

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? <Spinner data-icon="inline-start" /> : null}
          Start chat
        </Button>
      </DialogFooter>
    </form>
  )
}
