"use client";

import {
  Listbox,
  ListboxGroup,
  ListboxGroupLabel,
  ListboxItem,
  ListboxItemIndicator,
} from "@ui-sdk/react/listbox";
import { useState } from "react";
import { cx } from "./cx";
import { SearchInput } from "./input";
import { filterPickGroups, type PickGroup } from "./pick-list";

/**
 * Choose one from a list that stays in view, found by typing; the chosen row is
 * marked with a dot. Arrow keys move and choose as they go, as a single list
 * does. `PickList`'s sibling for one answer.
 */
export function ChooseList({
  label,
  groups,
  value,
  onValueChange,
  placeholder,
  empty = "Nobody by that name.",
  autoFocus,
  className,
}: {
  label: string;
  groups: readonly PickGroup[];
  value: string | null;
  onValueChange: (value: string) => void;
  placeholder: string;
  empty?: string;
  autoFocus?: boolean;
  className?: string;
}) {
  const [query, setQuery] = useState("");
  const shown = filterPickGroups(groups, query);

  return (
    <div className={cx("flex min-h-0 flex-col gap-2", className)}>
      <SearchInput
        aria-label="Search by name"
        placeholder={placeholder}
        value={query}
        autoFocus={autoFocus}
        onChange={(event) => setQuery(event.target.value)}
        className="flex-none bg-ui-ground"
      />
      {shown.length === 0 ? (
        <p className="px-3 py-6 text-center text-sm text-ui-soft">{empty}</p>
      ) : (
        <Listbox
          aria-label={label}
          value={value}
          onValueChange={(next) => next !== null && onValueChange(next)}
          className="-mx-1 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-1 outline-none"
        >
          {shown.map((group) => (
            <ListboxGroup key={group.label} className="flex flex-col">
              {group.label ? (
                <ListboxGroupLabel className="sticky top-0 z-1 bg-ui-surface px-2 py-1 text-xs font-bold text-ui-soft">
                  {group.label}
                </ListboxGroupLabel>
              ) : null}
              {group.items.map((item) => (
                <ListboxItem
                  key={item.value}
                  value={item.value}
                  label={item.label}
                  disabled={item.disabled}
                  className="group/choose flex min-h-12 cursor-default items-center gap-3 rounded-[0.875rem] px-2 py-1.5 outline-none data-highlighted:bg-ui-tint data-selected:bg-ui-accent-tint data-disabled:opacity-55"
                >
                  {item.media}
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span
                      className={cx(
                        "truncate text-[0.9375rem] font-bold",
                        item.muted && "text-ui-soft",
                      )}
                    >
                      {item.label}
                    </span>
                    {item.sub ? (
                      <span className="truncate text-[0.8125rem] text-ui-soft">
                        {item.sub}
                      </span>
                    ) : null}
                  </span>
                  <span className="grid size-5 shrink-0 place-items-center rounded-full inset-ring-2 inset-ring-ui-line group-data-selected/choose:inset-ring-ui-primary">
                    <ListboxItemIndicator className="size-2.5 rounded-full bg-ui-primary motion-safe:animate-ui-pop" />
                  </span>
                </ListboxItem>
              ))}
            </ListboxGroup>
          ))}
        </Listbox>
      )}
    </div>
  );
}
