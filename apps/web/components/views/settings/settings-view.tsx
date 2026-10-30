'use client'

import { ChevronLeftIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useNavigate } from '@/hooks/use-url-state'
import { SettingsSidebar, useSettingsTab } from './settings-sidebar'

/**
 * The open settings page (`settings.tab`). The category list is this
 * section's sidebar; on narrow screens it is this screen until one is opened.
 */
export function SettingsView() {
  const category = useSettingsTab()
  const navigate = useNavigate()

  if (!category) {
    return (
      <div className="flex min-h-0 flex-1 flex-col bg-sidebar">
        <SettingsSidebar />
      </div>
    )
  }

  const Page = category.component
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4 lg:px-6">
        <Button
          variant="ghost"
          size="icon-sm"
          className="-ml-2 lg:hidden"
          onClick={() => navigate({ 'settings.tab': null })}
        >
          <ChevronLeftIcon />
          <span className="sr-only">Back to settings</span>
        </Button>
        <h2 className="text-sm font-semibold">{category.label}</h2>
      </header>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="w-full max-w-2xl px-4 py-6 lg:px-6">
          <Page key={category.id} />
        </div>
      </div>
    </div>
  )
}
