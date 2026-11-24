"use client";

import {
  CalendarIcon,
  MapPinIcon,
  UserRoundIcon,
  UsersRoundIcon,
  type LucideIcon,
} from "lucide-react";
import type { WikiListItem } from "@kazusa/client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { usePlainText } from "./page-link";

/** What a page is, for the filters: a page can be both a place and a group. */
export type Category = "people" | "places" | "groups";

export const CATEGORY_LABEL: Readonly<Record<Category, string>> = {
  people: "People",
  places: "Places",
  groups: "Groups",
};

export function categoriesOf(page: WikiListItem): Category[] {
  if (page.kind === "person") return ["people"];
  const found: Category[] = [];
  if (page.place) found.push("places");
  if (page.group) found.push("groups");
  return found;
}

/** Every category a page is in, each with its icon: a page can be several. */
const markersOf = (
  page: WikiListItem,
): { icon: LucideIcon; label: string }[] => [
  ...(page.kind === "person"
    ? [{ icon: UserRoundIcon, label: "Character" }]
    : []),
  ...(page.kind === "day" ? [{ icon: CalendarIcon, label: "Diary day" }] : []),
  ...(page.place ? [{ icon: MapPinIcon, label: "Place" }] : []),
  ...(page.group ? [{ icon: UsersRoundIcon, label: "Group" }] : []),
];

const rowClass = (selected: boolean) =>
  cn(
    "w-full justify-start font-normal",
    selected && "bg-accent text-accent-foreground",
  );

/** All, then one toggle per category the list has. */
export function CategoryFilter({
  categories,
  value,
  onChange,
}: {
  categories: readonly Category[];
  value: Category | undefined;
  onChange: (value: Category | undefined) => void;
}) {
  if (!categories.length) return null;
  const chip = (pressed: boolean) =>
    cn(
      "h-6 rounded-full border px-2.5 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
      pressed && "border-foreground/20 bg-accent text-accent-foreground",
    );
  return (
    <div
      role="group"
      aria-label="Show"
      className="flex flex-wrap gap-1 px-3 pb-2"
    >
      <button
        type="button"
        aria-pressed={!value}
        className={chip(!value)}
        onClick={() => onChange(undefined)}
      >
        All
      </button>
      {categories.map((category) => (
        <button
          key={category}
          type="button"
          aria-pressed={value === category}
          className={chip(value === category)}
          onClick={() => onChange(category)}
        >
          {CATEGORY_LABEL[category]}
        </button>
      ))}
    </div>
  );
}

/**
 * A wiki's pages as one list by name (days, newest first), each with the icon
 * of what it is.
 */
export function PageTree({
  pages,
  selected,
  onSelect,
}: {
  pages: readonly WikiListItem[];
  selected?: string | undefined;
  onSelect: (id: string) => void;
}) {
  const plain = usePlainText();
  const sorted = [...pages].sort((a, b) =>
    a.kind === "day" && b.kind === "day"
      ? b.id.localeCompare(a.id)
      : a.name.localeCompare(b.name),
  );
  return (
    <div className="flex flex-col text-sm">
      {sorted.map((page) => {
        const markers = markersOf(page);
        return (
          <div key={page.id} className="group/row flex items-center">
            <Button
              variant="ghost"
              size="sm"
              className={cn(rowClass(selected === page.id), "min-w-0 flex-1")}
              aria-current={selected === page.id ? "true" : undefined}
              title={plain(page.summary) || page.name}
              onClick={() => onSelect(page.id)}
            >
              <span className="min-w-0 flex-1 truncate text-left">
                {page.name}
              </span>
              {markers.length ? (
                <span
                  className="flex shrink-0 items-center gap-1 text-muted-foreground"
                  aria-label={markers.map(({ label }) => label).join(", ")}
                >
                  {markers.map(({ icon: Marker, label }) => (
                    <Marker key={label} aria-hidden className="size-3.5">
                      <title>{label}</title>
                    </Marker>
                  ))}
                </span>
              ) : null}
            </Button>
          </div>
        );
      })}
    </div>
  );
}
