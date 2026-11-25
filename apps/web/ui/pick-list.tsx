"use client";

import {
  Listbox,
  ListboxGroup,
  ListboxGroupLabel,
  ListboxItem,
  ListboxItemIndicator,
} from "@ui-sdk/react/listbox";
import { CheckIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cx } from "./cx";
import { SearchInput } from "./input";
import { Tooltip } from "./tooltip";

export interface PickItem {
  readonly value: string;
  readonly label: string;
  /** Under the name: what they're doing, or why they can't be picked. */
  readonly sub?: string;
  readonly media?: ReactNode;
  /** Other words that find it, like aliases. */
  readonly keywords?: readonly string[];
  readonly disabled?: boolean;
  /** Quieter: there but not around, like someone offstage. */
  readonly muted?: boolean;
}

export interface PickGroup {
  readonly label: string;
  readonly items: readonly PickItem[];
}

const matches = (item: PickItem, q: string) =>
  !q ||
  item.label.toLowerCase().includes(q) ||
  (item.keywords ?? []).some((word) => word.toLowerCase().includes(q));

/**
 * Pick any number from a list that stays in view, found by typing: what's
 * picked shows as one row of chips above, each removable, scrolling sideways to
 * the newest once they outgrow it, and the list ticks it. Arrow keys move
 * through the list; Space or Enter picks.
 */
export function PickList({
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
  value: readonly string[];
  onValueChange: (value: string[]) => void;
  placeholder: string;
  empty?: string;
  autoFocus?: boolean;
  className?: string;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => matches(item, q)),
    }))
    .filter((group) => group.items.length > 0);
  const byValue = new Map(
    groups.flatMap((group) => group.items.map((item) => [item.value, item])),
  );
  const picked = value
    .map((v) => byValue.get(v))
    .filter((item): item is PickItem => Boolean(item));
  const chips = useRef<HTMLUListElement>(null);
  const count = useRef(picked.length);
  useEffect(() => {
    const grew = picked.length > count.current;
    count.current = picked.length;
    const row = chips.current;
    if (!row) return;
    // The end is the newest, in either writing direction.
    if (grew)
      row.scrollLeft =
        getComputedStyle(row).direction === "rtl"
          ? -row.scrollWidth
          : row.scrollWidth;
    edges(row);
  }, [picked.length]);

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
      {picked.length > 0 ? (
        <ul
          ref={chips}
          aria-label="Picked"
          onScroll={(event) => edges(event.currentTarget)}
          className="-mx-1 flex flex-none gap-1.5 overflow-x-auto motion-safe:scroll-smooth px-1 py-0.5 [scrollbar-width:none] transition-[--ui-fade-start,--ui-fade-end] duration-200 [mask-image:linear-gradient(to_right,transparent,black_var(--ui-fade-start),black_calc(100%-var(--ui-fade-end)),transparent)] data-[more-end]:[--ui-fade-end:1.5rem] data-[more-start]:[--ui-fade-start:1.5rem] motion-reduce:transition-none rtl:[mask-image:linear-gradient(to_left,transparent,black_var(--ui-fade-start),black_calc(100%-var(--ui-fade-end)),transparent)]"
        >
          {picked.map((item) => (
            <li
              key={item.value}
              className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full bg-ui-primary px-1 text-[0.8125rem] font-bold text-ui-on-primary motion-safe:animate-ui-pop [&>span:first-child]:scale-80"
            >
              {item.media}
              <span className="ps-0.5">{item.label}</span>
              <Tooltip label={`Remove ${item.label}`} names>
                <button
                  type="button"
                  className="grid size-5 place-items-center rounded-full hover:bg-ui-on-primary/20 focus-visible:outline-2 focus-visible:outline-ui-on-primary"
                  onClick={() =>
                    onValueChange(value.filter((v) => v !== item.value))
                  }
                >
                  <XIcon aria-hidden className="size-3" />
                </button>
              </Tooltip>
            </li>
          ))}
        </ul>
      ) : null}
      {shown.length === 0 ? (
        <p className="px-3 py-6 text-center text-sm text-ui-soft">{empty}</p>
      ) : (
        <Listbox
          multiple
          aria-label={label}
          value={[...value]}
          onValueChange={(next) => onValueChange([...next])}
          className="-mx-1 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-1 outline-none"
        >
          {shown.map((group) => (
            <ListboxGroup key={group.label} className="flex flex-col">
              {groups.length > 1 ? (
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
                  className="group/pick flex min-h-12 cursor-default items-center gap-3 rounded-[0.875rem] px-2 py-1.5 outline-none data-[disabled]:opacity-55 data-[highlighted]:bg-ui-tint data-[selected]:bg-ui-accent-tint"
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
                  <span className="grid size-6 shrink-0 place-items-center rounded-full inset-ring-2 inset-ring-ui-line group-data-[selected]/pick:bg-ui-primary group-data-[selected]/pick:inset-ring-0">
                    <ListboxItemIndicator className="grid place-items-center text-ui-on-primary motion-safe:animate-ui-pop">
                      <CheckIcon
                        aria-hidden
                        className="size-3.5"
                        strokeWidth={3}
                      />
                    </ListboxItemIndicator>
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

/**
 * Marks which ends of a scrolling row have more past them, so only those fade.
 * `scrollLeft` runs negative in right-to-left rows, hence its size.
 */
function edges(row: HTMLElement) {
  const before = Math.abs(row.scrollLeft);
  const after = row.scrollWidth - row.clientWidth - before;
  row.toggleAttribute("data-more-start", before > 1);
  row.toggleAttribute("data-more-end", after > 1);
}
