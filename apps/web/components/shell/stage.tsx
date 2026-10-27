'use client'

import { Unavailable } from '@/components/entities/source-state'
import { useActiveView } from '@/hooks/use-active-view'
import { satisfies } from '@/lib/source/capabilities'
import { useSources } from '@/lib/source/provider'

/** Renders exactly one registered view. Never imports feature components directly. */
export function Stage() {
  const { resolved } = useSources()
  const active = useActiveView()
  const View = active.component

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {satisfies(resolved, active.requires) ? (
        <View />
      ) : (
        <Unavailable requires={active.requires} className="flex-1" />
      )}
    </div>
  )
}
