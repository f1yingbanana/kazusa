'use client'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { useCharacterStatus } from '@/hooks/use-characters'
import { initials } from '@/lib/format'
import type { CharacterKind, CharacterStatus } from '@kazusa/client'
import { cn } from '@/lib/utils'

const SIZES = {
  xs: 'size-5 text-[10px]',
  sm: 'size-7 text-xs',
  md: 'size-9 text-sm',
  lg: 'size-14 text-base',
} as const

export type PresenceSize = keyof typeof SIZES

export type PresenceState = 'idle' | 'thinking' | 'composing' | 'unknown'

/** Ring state from structured fields only (D7). Never from task text. */
export function presenceState(
  kind: CharacterKind | undefined,
  status: CharacterStatus | undefined,
): PresenceState {
  if (kind === 'npc' || !status || status.brain === 'unknown') return 'unknown'
  if (status.composingIn.length > 0) return 'composing'
  if (status.brain === 'thinking') return 'thinking'
  return 'idle'
}

const LABELS: Record<PresenceState, string> = {
  idle: 'Idle',
  thinking: 'Thinking',
  composing: 'Composing',
  unknown: 'State unknown',
}

/**
 * The signature element: one ring encoding reused everywhere an avatar
 * appears. The player has no ring; nobody simulates them.
 */
export function PresenceAvatar({
  id,
  name,
  avatarUrl,
  kind,
  size = 'sm',
  className,
}: {
  id: string
  name: string
  avatarUrl?: string
  kind?: CharacterKind
  size?: PresenceSize
  className?: string
}) {
  const status = useCharacterStatus(kind === 'agent' ? id : undefined)
  const state = presenceState(kind, status)
  const showRing = kind !== 'player'
  const queued = status?.queued ?? 0

  return (
    <span
      className={cn('relative inline-flex shrink-0 rounded-full', SIZES[size], className)}
      role="img"
      aria-label={showRing ? `${name}, ${LABELS[state].toLowerCase()}` : name}
    >
      <Avatar className="size-full">
        {avatarUrl ? <AvatarImage src={avatarUrl} alt="" /> : null}
        <AvatarFallback className="text-[length:inherit]">{initials(name)}</AvatarFallback>
      </Avatar>
      {showRing ? (
        <>
          <span
            aria-hidden
            className={cn(
              'pointer-events-none absolute -inset-0.5 rounded-full border',
              state === 'idle' && 'border-muted-foreground/35',
              state === 'unknown' && 'border-dashed border-muted-foreground/50',
              state === 'thinking' && 'border-primary/25',
              state === 'composing' && 'border-2 border-primary',
            )}
          />
          {state === 'thinking' ? (
            <span
              aria-hidden
              className="pointer-events-none absolute -inset-0.5 animate-spin rounded-full border-2 border-transparent border-t-primary [animation-duration:2.4s] motion-reduce:animate-none motion-reduce:border-primary"
            />
          ) : null}
          {state === 'composing' && size !== 'xs' ? (
            <span
              aria-hidden
              className="pointer-events-none absolute -bottom-1 left-1/2 flex -translate-x-1/2 items-center gap-px rounded-full bg-primary px-1 py-0.5"
            >
              <span className="size-0.5 rounded-full bg-primary-foreground" />
              <span className="size-0.5 rounded-full bg-primary-foreground" />
              <span className="size-0.5 rounded-full bg-primary-foreground" />
            </span>
          ) : null}
          {queued > 0 && size !== 'xs' ? (
            <span
              aria-hidden
              className="pointer-events-none absolute -right-1 -bottom-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full border border-background bg-foreground px-0.5 font-mono text-[9px] leading-none text-background tabular-nums"
            >
              {queued}
            </span>
          ) : null}
        </>
      ) : null}
    </span>
  )
}
