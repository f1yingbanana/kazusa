'use client'

import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldContent, FieldLabel, FieldTitle } from '@/components/ui/field'
import type { Agent } from '@kazusa/client'
import { ParticipantAvatar } from './chat-avatar'

export function AgentChecklist({
  agents,
  selected,
  onToggle,
  idPrefix,
}: {
  agents: Agent[]
  selected: Set<string>
  onToggle: (agentId: string, checked: boolean) => void
  idPrefix: string
}) {
  return (
    <div className="flex max-h-72 flex-col gap-1 overflow-y-auto pr-1">
      {agents.map((agent) => {
        const id = `${idPrefix}-${agent.id}`
        return (
          <FieldLabel key={agent.id} htmlFor={id}>
            <Field orientation="horizontal" className="items-center">
              <span aria-hidden className="flex">
                <ParticipantAvatar participant={agent} size="sm" />
              </span>
              <FieldContent className="min-w-0">
                <FieldTitle className="truncate">{agent.name}</FieldTitle>
                <span className="truncate font-mono text-xs text-muted-foreground">
                  {agent.id}
                </span>
              </FieldContent>
              <Checkbox
                id={id}
                checked={selected.has(agent.id)}
                onCheckedChange={(checked) => onToggle(agent.id, checked === true)}
              />
            </Field>
          </FieldLabel>
        )
      })}
    </div>
  )
}
