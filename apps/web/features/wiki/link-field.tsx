"use client";

import type { WikiListItem } from "@kazusa/client";
import { useMemo, type ComponentProps } from "react";
import { shelfOf } from "@/lib/wiki/index-tree";
import { SuggestTextarea } from "@/ui/suggest-textarea";
import { SHELF_ICON } from "./shelf-icon";

/** The pages that answer a link being typed, names that start with it first. */
export function linkMatches(
  pages: readonly WikiListItem[],
  query: string,
  max = 8,
): WikiListItem[] {
  const needle = query.trim().toLowerCase();
  return pages
    .filter(
      (page) =>
        page.name.toLowerCase().includes(needle) ||
        page.aliases.some((alias) => alias.toLowerCase().includes(needle)) ||
        page.id.includes(needle),
    )
    .sort(
      (a, b) =>
        Number(b.name.toLowerCase().startsWith(needle)) -
          Number(a.name.toLowerCase().startsWith(needle)) ||
        a.name.localeCompare(b.name),
    )
    .slice(0, max);
}

/**
 * A text of a page, where typing `[[` offers the wiki's pages and choosing one
 * writes a link to it, `[[id]]`, which readers see as its name.
 */
export function LinkField({
  pages,
  ...props
}: Omit<
  ComponentProps<typeof SuggestTextarea>,
  "trigger" | "suggest" | "insert" | "renderItem" | "emptyText"
> & {
  pages: readonly WikiListItem[];
}) {
  const byId = useMemo(
    () => new Map(pages.map((page) => [page.id, page])),
    [pages],
  );
  return (
    <SuggestTextarea
      {...props}
      trigger="[["
      emptyText="No page by that name."
      suggest={(query) =>
        linkMatches(pages, query).map((page) => ({
          value: page.id,
          label: page.name,
        }))
      }
      insert={(id) => `[[${id}]]`}
      renderItem={(item) => {
        const page = byId.get(item.value);
        return (
          <>
            {page ? SHELF_ICON[shelfOf(page)] : null}
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            <span className="max-w-24 truncate font-[ui-monospace,monospace] text-[0.6875rem] font-normal text-ui-soft">
              {item.value}
            </span>
          </>
        );
      }}
    />
  );
}
