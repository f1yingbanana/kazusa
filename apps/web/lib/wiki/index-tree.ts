import type { WikiListItem } from "@kazusa/client";

/** The shelves a wiki's index is in, in the order they are shown. */
export const SHELVES = [
  "places",
  "people",
  "groups",
  "concepts",
  "days",
] as const;
export type Shelf = (typeof SHELVES)[number];

export const SHELF_LABEL: Readonly<Record<Shelf, string>> = {
  places: "Places",
  people: "People",
  groups: "Groups",
  concepts: "Concepts",
  days: "Diary",
};

/** A shelf's row in the tree; never a page's id, which has no `§`. */
const shelfValue = (shelf: Shelf) => `§${shelf}`;
export const isShelfValue = (value: string) => value.startsWith("§");

/** A page's first shelf: a place that is also a group is first a place. */
export function shelfOf(page: WikiListItem): Shelf {
  return shelvesOf(page)[0];
}

/** Every shelf a page is on: a place can be a group too, and is on both. */
export function shelvesOf(page: WikiListItem): Shelf[] {
  if (page.kind === "person") return ["people"];
  if (page.kind === "day") return ["days"];
  const shelves: Shelf[] = [];
  if (page.place) shelves.push("places");
  if (page.group) shelves.push("groups");
  return shelves.length ? shelves : ["concepts"];
}

/**
 * A page's row on a shelf. On its first shelf, its id; on another, the shelf
 * and the id, since a tree's rows each need their own.
 */
const rowValue = (shelf: Shelf, page: WikiListItem) =>
  shelfOf(page) === shelf ? page.id : `§${shelf}:${page.id}`;

export interface IndexNode {
  readonly value: string;
  readonly label: string;
  /** The page the row opens; none for a shelf. */
  readonly page?: string;
  readonly children?: IndexNode[];
}

export interface WikiIndex {
  readonly items: IndexNode[];
  /** How many pages each shelf holds, matches only while searching. */
  readonly counts: Readonly<Partial<Record<Shelf, number>>>;
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
  for (const page of found)
    for (const shelf of shelvesOf(page))
      onShelf.set(shelf, [...(onShelf.get(shelf) ?? []), page]);
  const parents = new Map<string, string>();
  const places = new Set(
    pages
      .filter((page) => page.place && page.kind === "concept")
      .map((page) => page.id),
  );
  for (const page of pages)
    if (page.parent && places.has(page.parent) && page.parent !== page.id)
      parents.set(page.id, page.parent);

  const leaf =
    (shelf: Shelf) =>
    (page: WikiListItem): IndexNode => ({
      value: rowValue(shelf, page),
      label: page.name,
      page: page.id,
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
        ? { ...leaf("places")(page), children: children.map(grow).sort(byName) }
        : leaf("places")(page);
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
          ? list.map(leaf(shelf)).sort((a, b) => b.value.localeCompare(a.value))
          : list.map(leaf(shelf)).sort(byName);
    items.push({
      value: shelfValue(shelf),
      label: SHELF_LABEL[shelf],
      children,
    });
  }
  return { items, counts };
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
