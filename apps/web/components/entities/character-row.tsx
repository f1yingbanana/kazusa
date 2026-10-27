'use client'

import { memo } from 'react'
import { StarIcon } from 'lucide-react'
import type { CharacterSummary } from '@kazusa/client'
import { useCharacterStatus } from '@/hooks/use-characters'
import { useSimNow } from '@/hooks/use-clock'
import { toggleWatch } from '@/lib/state/watchlist'
import { formatSimDuration } from '@/lib/time/sim'
import { cn } from '@/lib/utils'
import { PresenceAvatar } from './presence-avatar'
import { taskIcon } from './task-icon'

const KIND_LABEL = { agent: 'Simulated', npc: 'NPC', player: 'Player' } as const

/** ≈44px character row, used by the World folder list, World search, and anywhere else a roster is shown. */
export const CharacterRow = memo(function CharacterRow({
  character,
  selected,
  starred,
  onSelect,
  className,
}: {
  character: CharacterSummary
  selected: boolean
  starred: boolean
  onSelect: (id: string) => void
  className?: string
}) {
  const status = useCharacterStatus(character.kind === 'agent' ? character.id : undefined)
  const now = useSimNow()
  const task = status?.task
  const TaskIcon = taskIcon(task?.type)
  const activity = task
    ? task.description
    : character.kind === 'agent'
      ? (character.occupation ?? 'No current task')
      : (character.occupation ?? KIND_LABEL[character.kind])

  return (
    <div
      className={cn(
        'group/row flex h-11 items-center gap-2.5 rounded-md px-2 hover:bg-accent/70',
        selected && 'bg-accent hover:bg-accent',
        className,
      )}
    >
      <button
        type="button"
        onClick={() => onSelect(character.id)}
        aria-current={selected ? 'true' : undefined}
        className="flex min-w-0 flex-1 items-center gap-2.5 text-left outline-none focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-ring"
      >
        <PresenceAvatar
          id={character.id}
          name={character.name}
          avatarUrl={character.avatarUrl}
          kind={character.kind}
          size="sm"
        />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm leading-tight font-medium">{character.name}</span>
          <span className="flex min-w-0 items-center gap-1 text-xs leading-tight text-muted-foreground">
            {task ? <TaskIcon aria-label={task.type} className="size-3 shrink-0" /> : null}
            <span className="truncate">{activity}</span>
          </span>
        </span>
        {task && now > 0 ? (
          <span className="shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">
            {task.endAt > now ? formatSimDuration(task.endAt - now) : 'due'}
          </span>
        ) : null}
      </button>
      <button
        type="button"
        onClick={() => toggleWatch(character.id)}
        aria-pressed={starred}
        className={cn(
          'flex size-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring',
          !starred && 'opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100',
        )}
      >
        <StarIcon className={cn('size-3.5', starred && 'fill-current text-foreground')} />
        <span className="sr-only">{starred ? `Unstar ${character.name}` : `Star ${character.name}`}</span>
      </button>
    </div>
  )
})
