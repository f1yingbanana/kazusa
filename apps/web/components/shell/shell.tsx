'use client'

import { useEffect, useState } from 'react'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { useActiveView } from '@/hooks/use-active-view'
import { useMediaQuery } from '@/hooks/use-media-query'
import { useParam, useSelection } from '@/hooks/use-url-state'
import { RealtimeProvider } from '@/lib/live/realtime-provider'
import { SourcesProvider } from '@/lib/source/provider'
import { serializeEntityRef } from '@/lib/state/entity-ref'
import { isQuietSelection, onInspectorRequest, settleQuietSelection } from '@/lib/state/inspector-request'
import { onSidebarRequest } from '@/lib/state/sidebar-request'
import { CommandPalette } from './command-palette'
import { Inspector } from './inspector'
import { SectionRail, SectionTabs } from './section-nav'
import { SettingsDialog } from './settings-dialog'
import { Stage } from './stage'
import { StatusBar } from './status-bar'
import { TopBar } from './top-bar'

export function Shell() {
  return (
    <SourcesProvider fallback={<ShellSkeleton />}>
      <RealtimeProvider>
        <Layout />
      </RealtimeProvider>
    </SourcesProvider>
  )
}

/**
 * rail (where) → section sidebar (which) → stage (what) → inspector (details).
 * Below `lg` the sidebar isn't docked: sections show it as their first screen,
 * or open it as a sheet on request. Below `md` the rail becomes a bottom tab bar.
 */
function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [selection, select] = useSelection()
  const active = useActiveView()
  const view = useParam('view')
  const wide = useMediaQuery('(min-width: 1280px)')
  const Sidebar = active.sidebar

  // Narrow screens: the inspector sheet opens on a new selection (unless it was
  // made quietly), closes when a link changes the view (keeping the
  // selection), and dismissing it clears it.
  const selKey = selection ? serializeEntityRef(selection) : null
  const [sheetOpen, setSheetOpen] = useState(Boolean(selKey))
  const [seen, setSeen] = useState({ selKey, view })
  if (seen.selKey !== selKey || seen.view !== view) {
    setSeen({ selKey, view })
    setSheetOpen(seen.selKey !== selKey ? Boolean(selKey) && !isQuietSelection(selKey) : false)
  }
  useEffect(() => settleQuietSelection(selKey), [selKey])
  useEffect(() => onInspectorRequest(() => setSheetOpen(true)), [])
  useEffect(() => onSidebarRequest(() => setSidebarOpen(true)), [])

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <TopBar onOpenPalette={() => setPaletteOpen(true)} onOpenSettings={() => setSettingsOpen(true)} />
      <div className="flex min-h-0 flex-1">
        <SectionRail onOpenPalette={() => setPaletteOpen(true)} />
        {Sidebar ? (
          <aside aria-label={`${active.label} sidebar`} className="hidden w-72 shrink-0 flex-col border-r bg-sidebar lg:flex">
            <Sidebar key={active.id} />
          </aside>
        ) : null}
        <main className="flex min-w-0 flex-1 flex-col">
          <Stage />
        </main>
        <aside aria-label="Inspector" className="hidden w-80 shrink-0 flex-col border-l xl:flex">
          <Inspector />
        </aside>
      </div>
      <SectionTabs />
      <StatusBar />

      {Sidebar ? (
        <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
          <SheetContent side="left" className="w-80 gap-0 bg-sidebar p-0 lg:hidden" showCloseButton={false}>
            <SheetHeader className="sr-only">
              <SheetTitle>{`${active.label} sidebar`}</SheetTitle>
              <SheetDescription>{`Narrow what the ${active.label} section shows.`}</SheetDescription>
            </SheetHeader>
            <Sidebar key={active.id} onNavigated={() => setSidebarOpen(false)} />
          </SheetContent>
        </Sheet>
      ) : null}

      <Sheet
        open={!wide && selection !== null && sheetOpen}
        onOpenChange={(open) => {
          if (!open) select(null)
        }}
      >
        <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-sm" showCloseButton={false}>
          <SheetHeader className="sr-only">
            <SheetTitle>Inspector</SheetTitle>
            <SheetDescription>Details for the selected entity.</SheetDescription>
          </SheetHeader>
          <Inspector />
        </SheetContent>
      </Sheet>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  )
}

function ShellSkeleton() {
  return (
    <div className="flex h-dvh flex-col" aria-busy="true" aria-label="Connecting to Kazusa">
      <div className="flex h-12 items-center gap-3 border-b bg-sidebar px-3">
        <Skeleton className="h-4 w-16" />
        <Skeleton className="mx-auto h-4 w-40" />
      </div>
      <div className="flex flex-1">
        <div className="hidden w-14 flex-col items-center gap-2 border-r py-2 md:flex">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="size-10 rounded-lg" />
          ))}
        </div>
        <div className="hidden w-72 flex-col gap-3 border-r bg-sidebar p-3 lg:flex">
          {Array.from({ length: 10 }).map((_, index) => (
            <Skeleton key={index} className="h-9" />
          ))}
        </div>
        <div className="flex-1" />
      </div>
    </div>
  )
}
