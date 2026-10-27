'use client'

import { Unavailable } from '@/components/entities/source-state'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useNavigate, useParam } from '@/hooks/use-url-state'
import { satisfies } from '@/lib/source/capabilities'
import { useSources } from '@/lib/source/provider'
import { DEFAULT_VIEW, STAGE_VIEWS } from '@/lib/registry/views'

/** Renders exactly one registered view. Never imports feature components directly. */
export function Stage() {
  const navigate = useNavigate()
  const { resolved } = useSources()
  const requested = useParam('view')
  const active = STAGE_VIEWS.find((view) => view.id === requested) ?? STAGE_VIEWS.find((view) => view.id === DEFAULT_VIEW)!
  const View = active.component

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-11 shrink-0 items-center border-b px-3">
        <Tabs value={active.id} onValueChange={(value) => navigate({ view: String(value) })}>
          <TabsList variant="line" aria-label="Views">
            {STAGE_VIEWS.map((view) => (
              <TabsTrigger key={view.id} value={view.id} className="px-2">
                <view.icon />
                {view.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
      {satisfies(resolved, active.requires) ? (
        <View />
      ) : (
        <Unavailable requires={active.requires} className="flex-1" />
      )}
    </div>
  )
}
