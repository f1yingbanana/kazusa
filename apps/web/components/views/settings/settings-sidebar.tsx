'use client'

import { useMediaQuery } from '@/hooks/use-media-query'
import { useNavigate, useParam } from '@/hooks/use-url-state'
import type { SectionSidebarProps } from '@/lib/registry/types'
import { DEFAULT_SETTINGS_CATEGORY, SETTINGS_CATEGORIES } from '@/lib/registry/settings'
import { cn } from '@/lib/utils'

/**
 * Settings categories. On wide screens a missing `settings.tab` means the
 * first one is open; on narrow screens this list is the first screen instead.
 */
export function useSettingsTab() {
  const tab = useParam('settings.tab')
  const docked = useMediaQuery('(min-width: 1024px)')
  return (
    SETTINGS_CATEGORIES.find((category) => category.id === tab) ??
    (docked ? SETTINGS_CATEGORIES.find((category) => category.id === DEFAULT_SETTINGS_CATEGORY) : undefined)
  )
}

export function SettingsSidebar({ onNavigated }: SectionSidebarProps) {
  const navigate = useNavigate()
  const active = useSettingsTab()

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center px-3.5">
        <h2 className="text-sm font-semibold">Settings</h2>
      </div>
      <nav aria-label="Settings categories" className="flex flex-col gap-0.5 px-1.5 pb-3">
        {SETTINGS_CATEGORIES.map((category) => {
          const current = category.id === active?.id
          return (
            <button
              key={category.id}
              type="button"
              aria-current={current ? 'page' : undefined}
              onClick={() => {
                navigate({ view: 'settings', 'settings.tab': category.id })
                onNavigated?.()
              }}
              className={cn(
                'flex items-center gap-3 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-sidebar-accent/70 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                current && 'bg-sidebar-accent text-sidebar-accent-foreground',
              )}
            >
              <category.icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-medium">{category.label}</span>
                <span className="truncate text-xs text-muted-foreground">{category.description}</span>
              </span>
            </button>
          )
        })}
      </nav>
    </div>
  )
}
