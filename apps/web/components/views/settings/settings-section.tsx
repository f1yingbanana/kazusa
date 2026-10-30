import { cn } from '@/lib/utils'

/** One titled block on a settings page. Pages stack these; nothing nests deeper. */
export function SettingsSection({
  title,
  description,
  action,
  className,
  children,
}: {
  title: string
  description?: React.ReactNode
  /** One trailing control beside the title (e.g. Refresh). */
  action?: React.ReactNode
  className?: string
  children: React.ReactNode
}) {
  return (
    <section className={cn('flex flex-col gap-4 border-b py-6 first:pt-0 last:border-b-0', className)}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className="text-sm font-semibold">{title}</h3>
          {description ? (
            <p className="text-sm leading-relaxed text-pretty text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}
