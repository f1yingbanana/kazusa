'use client'

import { memo } from 'react'
import { ArrowUpRightIcon } from 'lucide-react'
import type { JournalEvent } from '@kazusa/client'
import { CharacterChip } from '@/components/entities/chips'
import { Thought } from '@/components/entities/fact'
import { Button } from '@/components/ui/button'
import { useCharacter } from '@/hooks/use-characters'
import { useNavigate } from '@/hooks/use-url-state'
import { kindOf } from '@/lib/registry/timeline-kinds'
import { serializeEntityRef } from '@/lib/state/entity-ref'
import { formatSimTime } from '@/lib/time/sim'
import { cn } from '@/lib/utils'

const MAX_CHIPS = 3

function ThoughtAttribution({ by, text }: { by: string; text: string }) {
  const character = useCharacter(by)
  return <Thought by={character?.name ?? by}>{text}</Thought>
}

export const TimelineRow = memo(function TimelineRow({
  event,
  compact = false,
  omitActor,
  className,
}: {
  event: JournalEvent
  compact?: boolean
  /** Hides this actor's chip, e.g. in the inspector for that same character. */
  omitActor?: string
  className?: string
}) {
  const kind = kindOf(event)
  const navigate = useNavigate()
  const Icon = kind.icon
  const actors = (kind.actors?.(event) ?? event.actors).filter((id) => id !== omitActor)
  const thought = kind.thought?.(event)
  const target = kind.target?.(event)
  const link = target && 'view' in target ? target : undefined

  return (
    <article
      className={cn('flex gap-3 px-3 py-2', className)}
      aria-label={`${kind.label} at ${formatSimTime(event.simTime)}`}
    >
      <time className="w-11 shrink-0 pt-1 font-mono text-xs text-muted-foreground tabular-nums">
        {formatSimTime(event.simTime)}
      </time>
      <Icon aria-label={kind.label} className="mt-1.5 size-3.5 shrink-0 text-muted-foreground" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5 text-sm leading-relaxed">
          {actors.slice(0, MAX_CHIPS).map((id) => (
            <CharacterChip key={id} id={id} className="-ml-1" />
          ))}
          {actors.length > MAX_CHIPS ? (
            <span className="font-mono text-xs text-muted-foreground">{`+${actors.length - MAX_CHIPS}`}</span>
          ) : null}
          <span className="min-w-0">{kind.fact(event)}</span>
        </div>
        {thought && !compact ? <ThoughtAttribution by={thought.by} text={thought.text} /> : null}
      </div>
      {link && !compact ? (
        <Button
          variant="ghost"
          size="xs"
          className="shrink-0 self-start text-muted-foreground"
          onClick={() =>
            navigate({
              view: link.view,
              ...link.params,
              sel: event.chatId ? serializeEntityRef({ kind: 'chat', id: event.chatId }) : undefined,
            })
          }
        >
          {link.label}
          <ArrowUpRightIcon data-icon="inline-end" />
        </Button>
      ) : null}
    </article>
  )
})
