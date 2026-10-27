'use client'

import { SearchIcon } from 'lucide-react'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'

/**
 * Same shape in every sidebar tab: search on the left, the tab's own action
 * (new group, filters…) on the right. The count is in the placeholder, so it
 * takes no space of its own.
 */
export function PanelToolbar({
  query,
  onQueryChange,
  placeholder,
  label,
  children,
}: {
  query: string
  onQueryChange: (query: string) => void
  placeholder: string
  label: string
  children?: React.ReactNode
}) {
  return (
    <div className="flex shrink-0 items-center gap-1.5 px-2 py-2">
      <InputGroup className="h-8 flex-1">
        <InputGroupAddon>
          <SearchIcon />
        </InputGroupAddon>
        <InputGroupInput
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={placeholder}
          aria-label={label}
        />
      </InputGroup>
      {children}
    </div>
  )
}
