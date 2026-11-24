"use client";

import { SearchIcon } from "lucide-react";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";

/**
 * Same shape in every sidebar tab: search, the tab's own action (new chat,
 * filters…) on the right, and optionally a filter before the search. The count
 * is in the placeholder, so it takes no space of its own.
 */
export function PanelToolbar({
  query,
  onQueryChange,
  placeholder,
  label,
  leading,
  children,
}: {
  query: string;
  onQueryChange: (query: string) => void;
  placeholder: string;
  label: string;
  /** A control before the search (a filter menu). */
  leading?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1.5 p-2">
      {leading}
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
  );
}
