import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Tool-grounded state: upright, iconified, solid (D7). */
export function Fact({
  icon: Icon,
  children,
  className,
}: {
  icon?: LucideIcon
  children: React.ReactNode
  className?: string
}) {
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1.5 text-sm text-foreground', className)}>
      {Icon ? <Icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" /> : null}
      <span className="min-w-0">{children}</span>
    </span>
  )
}

/** Subjective content: italic, attributed, never styled as a fact (D7). */
export function Thought({
  by,
  children,
  confidence,
  className,
}: {
  by: string
  children: React.ReactNode
  confidence?: number
  className?: string
}) {
  return (
    <p className={cn('text-sm leading-relaxed text-muted-foreground italic', className)}>
      <span className="font-medium not-italic">{by} thinks</span>{' '}
      <span>{children}</span>
      {confidence !== undefined ? (
        <span className="ml-2 inline-flex items-center gap-1 align-middle not-italic">
          <span className="h-1 w-10 overflow-hidden rounded-full bg-muted">
            <span className="block h-full bg-muted-foreground" style={{ width: `${Math.round(confidence * 100)}%` }} />
          </span>
          <span className="sr-only">{`Confidence ${Math.round(confidence * 100)}%`}</span>
        </span>
      ) : null}
    </p>
  )
}
