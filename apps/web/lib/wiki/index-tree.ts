import type { WikiListItem } from "@kazusa/client";

/** The shelves a wiki's index is in, in the order they are shown. */
export const SHELVES = [
  "places",
  "people",
  "groups",
  "things",
  "days",
] as const;
export type Shelf = (typeof SHELVES)[number];

export const SHELF_LABEL: Readonly<Record<Shelf, string>> = {
  places: "Places",
  people: "People",
  groups: "Groups",
  things: "Things",
  days: "Diary",
};

/** A shelf's row in the tree; never a page's id, which has no `§`. */
export const shelfValue = (shelf: Shelf) => `§${shelf}`;
export const isShelfValue = (value: string) => value.startsWith("§");

/** The one shelf a page is on: a place that is also a group is a place. */
export function shelfOf(page: WikiListItem): Shelf {
  if (page.kind === "person") return "people";
  if (page.kind === "day") return "days";
  if (page.place) return "places";
  if (page.group) return "groups";
  return "things";
}

export interface IndexNode {
  readonly value: string;
  readonly label: string;
  readonly children?: IndexNode[];
}

export interface WikiIndex {
  readonly items: IndexNode[];
  /** How many pages each shelf holds, matches only while searching. */
  readonly counts: Readonly<Partial<Record<Shelf, number>>>;
  /** Each page's area, for the rows that open it. */
  readonly parents: ReadonlyMap<string, string>;
}

/** Whether a page answers a search, by its name, other names or summary. */
export function matches(page: WikiListItem, needle: string): boolean {
  if (!needle) return true;
  return (
    page.name.toLowerCase().includes(needle) ||
    page.aliases.some((alias) => alias.toLowerCase().includes(needle)) ||
    page.summary.toLowerCase().includes(needle)
  );
}

const byName = (a: IndexNode, b: IndexNode) =>
  a.label.localeCompare(b.label, undefined, { sensitivity: "base" });

/**
 * A wiki's pages as shelves: places nested by the area each is in, diary days
 * newest first, everything else by name. While searching, the matches stand
 * flat on their shelves, so none is hidden in a closed area.
 */
export function buildIndex(
  pages: readonly WikiListItem[],
  query = "",
): WikiIndex {
  const needle = query.trim().toLowerCase();
  const found = pages.filter((page) => matches(page, needle));
  const onShelf = new Map<Shelf, WikiListItem[]>();
  for (const page of found) {
    const shelf = shelfOf(page);
    onShelf.set(shelf, [...(onShelf.get(shelf) ?? []), page]);
  }
  const parents = new Map<string, string>();
  const places = new Set(
    pages.filter((page) => shelfOf(page) === "places").map((page) => page.id),
  );
  for (const page of pages)
    if (page.parent && places.has(page.parent) && page.parent !== page.id)
      parents.set(page.id, page.parent);

  const leaf = (page: WikiListItem): IndexNode => ({
    value: page.id,
    label: page.name,
  });

  const nest = (list: readonly WikiListItem[]): IndexNode[] => {
    const ids = new Set(list.map((page) => page.id));
    const kids = new Map<string, WikiListItem[]>();
    const roots: WikiListItem[] = [];
    for (const page of list) {
      const parent = parents.get(page.id);
      if (parent && ids.has(parent) && !circles(page.id, parents))
        kids.set(parent, [...(kids.get(parent) ?? []), page]);
      else roots.push(page);
    }
    const grow = (page: WikiListItem): IndexNode => {
      const children = kids.get(page.id);
      return children?.length
        ? { ...leaf(page), children: children.map(grow).sort(byName) }
        : leaf(page);
    };
    return roots.map(grow).sort(byName);
  };

  const items: IndexNode[] = [];
  const counts: Partial<Record<Shelf, number>> = {};
  for (const shelf of SHELVES) {
    const list = onShelf.get(shelf);
    if (!list?.length) continue;
    counts[shelf] = list.length;
    const children =
      shelf === "places" && !needle
        ? nest(list)
        : shelf === "days"
          ? list.map(leaf).sort((a, b) => b.value.localeCompare(a.value))
          : list.map(leaf).sort(byName);
    items.push({
      value: shelfValue(shelf),
      label: SHELF_LABEL[shelf],
      children,
    });
  }
  return { items, counts, parents };
}

/** Whether following areas up from a page comes back to it. */
function circles(id: string, parents: ReadonlyMap<string, string>): boolean {
  const seen = new Set<string>();
  for (let at = parents.get(id); at; at = parents.get(at)) {
    if (at === id) return true;
    if (seen.has(at)) return false;
    seen.add(at);
  }
  return false;
}

/** The areas a place is in, nearest last, as far as the index knows them. */
export function areasOf(
  id: string,
  parents: ReadonlyMap<string, string>,
): string[] {
  const chain: string[] = [];
  const seen = new Set([id]);
  for (let at = parents.get(id); at && !seen.has(at); at = parents.get(at)) {
    chain.unshift(at);
    seen.add(at);
  }
  return chain;
}
