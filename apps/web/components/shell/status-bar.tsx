'use client'

import { Fragment } from 'react'
import { STATUS_ITEMS } from '@/lib/registry/status'
import { satisfies } from '@/lib/source/capabilities'
import { useSources } from '@/lib/source/provider'
import type { StatusItem } from '@/lib/registry/types'

function Slot({ items }: { items: readonly StatusItem[] }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      {[...items]
        .sort((a, b) => a.order - b.order)
        .map((item, index) => (
          <Fragment key={item.id}>
            {index > 0 ? <span aria-hidden className="h-3 w-px bg-border" /> : null}
            <item.component />
          </Fragment>
        ))}
    </div>
  )
}

/** Small, global, glanceable signals only. Never controls that change the simulation. */
export function StatusBar() {
  const { resolved } = useSources()
  const items = STATUS_ITEMS.filter((item) => satisfies(resolved, item.requires))
  return (
    <footer className="hidden h-7 shrink-0 items-center justify-between gap-4 border-t bg-sidebar px-3 font-mono text-[11px] text-muted-foreground md:flex">
      <Slot items={items.filter((item) => item.side === 'start')} />
      <Slot items={items.filter((item) => item.side === 'end')} />
    </footer>
  )
}
