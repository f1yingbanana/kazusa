'use client'

import { MousePointerClickIcon, XIcon } from 'lucide-react'
import { MockTag } from '@/components/entities/source-state'
import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { useSelection } from '@/hooks/use-url-state'
import { INSPECTOR_SECTIONS } from '@/lib/registry/inspector'
import { satisfies } from '@/lib/source/capabilities'
import { useSources } from '@/lib/source/provider'

const KIND_LABEL = { character: 'Character', chat: 'Chat', place: 'Place' } as const

/** Entity-polymorphic and slim: depth belongs in stage views. */
export function Inspector() {
  const [selection, select] = useSelection()
  const { resolved } = useSources()

  if (!selection) {
    return (
      <Empty className="border-none">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <MousePointerClickIcon />
          </EmptyMedia>
          <EmptyTitle>Nothing selected</EmptyTitle>
          <EmptyDescription>Pick a character in the roster, or any name in a view.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  const sections = INSPECTOR_SECTIONS.filter(
    (section) => section.entity === selection.kind && satisfies(resolved, section.requires),
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b px-4">
        <span className="font-mono text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          {KIND_LABEL[selection.kind]}
        </span>
        <Button variant="ghost" size="icon-sm" onClick={() => select(null)}>
          <XIcon />
          <span className="sr-only">Clear selection</span>
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {sections.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">{`Nothing to show for this ${selection.kind} yet.`}</p>
        ) : (
          sections.map((section) => (
            <section
              key={section.id}
              aria-label={section.title || KIND_LABEL[selection.kind]}
              className="flex flex-col gap-2 border-b px-4 py-4 last:border-b-0"
            >
              {section.title ? (
                <h3 className="flex items-center justify-between gap-2 font-mono text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                  {section.title}
                  <MockTag requires={section.requires} />
                </h3>
              ) : null}
              <section.component entity={selection} />
            </section>
          ))
        )}
      </div>
    </div>
  )
}
