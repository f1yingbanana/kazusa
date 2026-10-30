'use client'

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useNavigate } from '@/hooks/use-url-state'
import { useRealtime } from '@/lib/live/realtime-provider'
import { useKazusaConfig } from '@/lib/state/config-store'
import { cn } from '@/lib/utils'

const LABELS = {
  open: 'Live',
  connecting: 'Reconnecting…',
  error: 'Offline',
} as const

/** Gateway SSE health. SSE errors surface only here (UX §11). */
export function ConnectionStatusItem() {
  const { status } = useRealtime()
  const { baseUrl } = useKazusaConfig()
  const navigate = useNavigate()

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button type="button" onClick={() => navigate({ view: 'settings', 'settings.tab': 'connection' })} />
        }
        className="inline-flex items-center gap-1.5 rounded-sm hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <span
          aria-hidden
          className={cn(
            'size-1.5 rounded-full',
            status === 'open' && 'bg-online',
            status === 'connecting' && 'animate-pulse bg-muted-foreground motion-reduce:animate-none',
            status === 'error' && 'bg-destructive',
          )}
        />
        <span role="status">{LABELS[status]}</span>
      </TooltipTrigger>
      <TooltipContent>
        <span className="font-mono text-xs">{`${baseUrl || 'same origin'} /kazusa/events`}</span>
      </TooltipContent>
    </Tooltip>
  )
}
