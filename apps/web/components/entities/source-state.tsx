'use client'

import { PlugZapIcon, UnplugIcon } from 'lucide-react'
import type { Domain } from '@kazusa/client'
import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { LEGACY_CAPABILITIES } from '@/lib/source/capabilities'
import { useSources } from '@/lib/source/provider'
import { cn } from '@/lib/utils'

/** Visible marker on any panel that reads a mocked domain (D10). */
export function MockTag({ requires, className }: { requires: readonly Domain[]; className?: string }) {
  const { resolved } = useSources()
  const mocked = requires.filter((domain) => resolved[domain] === 'mock')
  if (mocked.length === 0) return null
  return (
    <Tooltip>
      <TooltipTrigger
        render={<span />}
        className={cn(
          'inline-flex h-4 shrink-0 items-center rounded-sm border border-dashed border-muted-foreground/50 px-1 font-mono text-[10px] font-medium tracking-wide text-muted-foreground uppercase',
          className,
        )}
      >
        Mock
      </TooltipTrigger>
      <TooltipContent>
        Placeholder data. Not served by the backend yet: {mocked.join(', ')}
      </TooltipContent>
    </Tooltip>
  )
}

/** Honest empty state for a domain the backend doesn't provide. Never a blank panel. */
export function Unavailable({
  requires,
  title = 'Not available from this backend yet',
  className,
}: {
  requires: readonly Domain[]
  title?: string
  className?: string
}) {
  const { resolved, reachable, backendError, retryBackend } = useSources()
  const missing = requires.filter((domain) => resolved[domain] === 'unavailable')
  const offline = !reachable && missing.some((domain) => LEGACY_CAPABILITIES[domain] === 'live')

  if (offline) {
    return (
      <Empty className={cn('border-none', className)}>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <UnplugIcon />
          </EmptyMedia>
          <EmptyTitle>{"Can't reach the Kazusa server"}</EmptyTitle>
          <EmptyDescription>
            {backendError?.message ?? 'The Gateway did not answer.'} Start the Gateway, or point Settings at it.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button size="sm" variant="outline" onClick={retryBackend}>
            Retry
          </Button>
        </EmptyContent>
      </Empty>
    )
  }

  return (
    <Empty className={cn('border-none', className)}>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <PlugZapIcon />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>
          Needs: <span className="font-mono">{(missing.length ? missing : requires).join(', ')}</span>
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

/** Inline variant for small slots (inspector rows, list footers). */
export function NeedsLine({ requires, children }: { requires: readonly Domain[]; children?: React.ReactNode }) {
  return (
    <p className="text-xs leading-relaxed text-muted-foreground">
      {children ?? 'Not available yet.'} Needs: <span className="font-mono">{requires.join(', ')}</span>
    </p>
  )
}
