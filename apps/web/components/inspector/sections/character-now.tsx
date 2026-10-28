'use client'

import { BrainIcon, InboxIcon, PenLineIcon } from 'lucide-react'
import { ChatChip } from '@/components/entities/chips'
import { Fact } from '@/components/entities/fact'
import { taskIcon, taskLabel } from '@/components/entities/task-icon'
import { useCharacter, useCharacterStatus } from '@/hooks/use-characters'
import { useSimNow } from '@/hooks/use-clock'
import type { EntityRef } from '@/lib/state/entity-ref'
import { formatSimDuration, formatSimTime, progress } from '@/lib/time/sim'

const BRAIN_LABEL = { idle: 'Idle', thinking: 'Thinking', unknown: 'Unknown' } as const

export function CharacterNowSection({ entity }: { entity: EntityRef }) {
  const character = useCharacter(entity.id)
  const status = useCharacterStatus(character?.kind === 'agent' ? entity.id : undefined)
  const now = useSimNow()

  if (character?.kind !== 'agent') {
    return <p className="text-sm text-muted-foreground">No live status: only simulated characters have one.</p>
  }
  if (!status) return <p className="text-sm text-muted-foreground">No status reported yet.</p>

  const task = status.task
  const Icon = taskIcon(task?.type)
  const fraction = task && now > 0 ? progress(task.startedAt, task.endAt, now) : 0

  return (
    <div className="flex flex-col gap-3">
      {task ? (
        <div className="flex flex-col gap-2 rounded-lg border bg-card p-3">
          <div className="flex flex-col gap-1">
            <span className="inline-flex items-center gap-1.5 font-mono text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
              <Icon aria-hidden className="size-3.5 shrink-0" />
              {taskLabel(task.type)}
            </span>
            <p className="text-sm leading-snug font-medium text-pretty">{task.description}</p>
          </div>
          <div
            className="h-1 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-label="Task progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(fraction * 100)}
          >
            <div className="h-full bg-primary transition-[width] duration-700" style={{ width: `${fraction * 100}%` }} />
          </div>
          <div className="flex items-center justify-between font-mono text-xs text-muted-foreground tabular-nums">
            <span>{`${formatSimTime(task.startedAt)} → ${formatSimTime(task.endAt)}`}</span>
            <span className="text-foreground">
              {now > 0 && task.endAt > now ? `${formatSimDuration(task.endAt - now)} left` : 'Due'}
            </span>
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No current task.</p>
      )}
      <div className="flex flex-col gap-1.5">
        <Fact icon={BrainIcon}>{BRAIN_LABEL[status.brain]}</Fact>
        {status.queued > 0 ? (
          <Fact icon={InboxIcon}>
            <span className="font-mono tabular-nums">{status.queued}</span> queued{' '}
            {status.queued === 1 ? 'stimulus' : 'stimuli'}
          </Fact>
        ) : null}
        {status.composingIn.length > 0 ? (
          <Fact icon={PenLineIcon}>
            Composing in{' '}
            {status.composingIn.map((chatId) => (
              <ChatChip key={chatId} id={chatId} />
            ))}
          </Fact>
        ) : null}
      </div>
    </div>
  )
}
