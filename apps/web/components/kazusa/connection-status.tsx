'use client'

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useRealtime } from './realtime-provider'

const LABELS = {
  open: 'Live',
  connecting: 'Connecting',
  error: 'Offline',
} as const

export function ConnectionStatus({ baseUrl }: { baseUrl: string }) {
  const { status } = useRealtime()

  return (
    <Tooltip>
      <TooltipTrigger
        render={<span />}
        className="inline-flex items-center gap-1.5 rounded-full px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground"
      >
        <span className="relative flex size-2" aria-hidden>
          {status === 'open' ? (
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-online opacity-60 motion-reduce:hidden" />
          ) : null}
          <span
            className={cn(
              'relative inline-flex size-2 rounded-full',
              status === 'open' && 'bg-online',
              status === 'connecting' && 'animate-pulse bg-muted-foreground',
              status === 'error' && 'bg-destructive',
            )}
          />
        </span>
        <span role="status">{LABELS[status]}</span>
      </TooltipTrigger>
      <TooltipContent>
        <span className="font-mono text-xs">{baseUrl}</span>
      </TooltipContent>
    </Tooltip>
  )
}
