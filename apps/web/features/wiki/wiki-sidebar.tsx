"use client";

import type { WikiListItem } from "@kazusa/client";
import {
  ChevronDownIcon,
  CopyIcon,
  ExternalLinkIcon,
  FilePlusIcon,
  GlobeIcon,
  MapPinPlusIcon,
  MoonIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useQueryStates } from "nuqs";
import { useMemo, useState, type ReactNode } from "react";
import { useAccess } from "@/hooks/use-access";
import { isCast, useCharacters } from "@/hooks/use-characters";
import { usePageName, useWikiLint, useWikiList } from "@/hooks/use-wiki";
import type { SectionSidebarProps } from "@/lib/registry/types";
import {
  buildIndex,
  isShelfValue,
  shelvesOf,
  type IndexNode,
  type Shelf,
} from "@/lib/wiki/index-tree";
import { IconButton } from "@/ui/button";
import {
  Combobox,
  ComboboxOption,
  ComboboxPopup,
  ComboboxTrigger,
} from "@/ui/combobox";
import { cx } from "@/ui/cx";
import { SearchInput } from "@/ui/input";
import { Badge, ListPane, ListRow } from "@/ui/list";
import {
  Menu,
  MenuContent,
  MenuContextTrigger,
  MenuItem,
  MenuSeparator,
} from "@/ui/menu";
import { Note } from "@/ui/note";
import { Tree, TreeRow } from "@/ui/tree";
import { CharacterAvatar } from "../characters/character-avatar";
import { usePageTarget } from "./links";
import {
  NewPageDialog,
  type NewKind,
  type NewPagePreset,
} from "./new-page-dialog";
import { wikiPatch } from "./open";
import { copyMarkdown } from "./page-menu";
import { wikiParsers } from "./search-params";
import { SHELF_ICON } from "./shelf-icon";

const WORLD = "";

const SHELF_KIND: Readonly<Partial<Record<Shelf, NewKind>>> = {
  places: "place",
  people: "person",
  groups: "group",
  concepts: "concept",
};

const NEW_WORD: Readonly<Record<NewKind, string>> = {
  place: "New place",
  person: "New person",
  group: "New group",
  concept: "New concept",
};

/**
 * The index of one wiki: the World Wiki's, or one character's own while reading
 * as them. Pages stand on shelves, places inside their areas; a search lays the
 * matches out flat. Problems and each night's changes sit at the foot.
 */
export function WikiSidebar({ onNavigated }: SectionSidebarProps) {
  const [params, setParams] = useQueryStates(wikiParsers);
  const agent = params["wiki.agent"] ?? undefined;
  const { canManage } = useAccess();
  const list = useWikiList(agent);
  const { data: lint } = useWikiLint();
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState<NewPagePreset>();
  const { byId } = useCharacters();
  const pageName = usePageName();
  const viewer = agent ? byId.get(agent) : undefined;
  const pages = useMemo(() => list.data?.pages ?? [], [list.data]);
  const index = useMemo(() => buildIndex(pages, query), [pages, query]);
  const searching = query.trim() !== "";
  const problems = lint?.findings.length ?? 0;

  const go = (patch: ReturnType<typeof wikiPatch>) => {
    void setParams(patch);
    onNavigated?.();
  };

  return (
    <ListPane
      head={
        <>
          <SearchInput
            aria-label="Search pages"
            placeholder={
              pages.length ? `Search ${pages.length} pages` : "Search"
            }
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <IconButton
            label="New page"
            disabled={!canManage}
            onClick={() => setCreating({})}
          >
            <FilePlusIcon aria-hidden />
          </IconButton>
        </>
      }
    >
      <WhoseWiki
        agent={agent}
        onChange={(next) => {
          setQuery("");
          go(wikiPatch(params["wiki.page"], { agent: next ?? null }));
        }}
      />

      <div className="-mx-1 flex min-h-0 flex-1 flex-col overflow-y-auto px-1 pb-2">
        {list.isLoading ? null : list.error ? (
          <Note inset="list">{"Couldn't read this wiki."}</Note>
        ) : index.items.length === 0 ? (
          <Note inset="list">
            {searching
              ? `Nothing matches “${query.trim()}”.`
              : `${viewer ? viewer.name.split(" ")[0] : pageName(agent ?? "")} has no pages yet.`}
          </Note>
        ) : (
          <IndexTree
            key={`${agent ?? WORLD}:${searching ? "search" : "browse"}`}
            index={index}
            pages={pages}
            agent={agent}
            current={params["wiki.tab"] ? null : params["wiki.page"]}
            searching={searching}
            onOpen={onNavigated}
            onCreate={canManage ? setCreating : undefined}
          />
        )}
      </div>

      <div className="flex flex-col border-t border-ui-line pt-2">
        {agent ? (
          <ListRow
            current={params["wiki.tab"] === "nights"}
            leading={
              <FootIcon>
                <MoonIcon />
              </FootIcon>
            }
            title="Nights"
            onClick={() => go(wikiPatch(null, { agent, tab: "nights" }))}
          />
        ) : (
          <ListRow
            current={params["wiki.tab"] === "lint"}
            leading={
              <FootIcon>
                <TriangleAlertIcon />
              </FootIcon>
            }
            title="Problems"
            trailing={
              problems ? <Badge count={problems} label="problems" /> : null
            }
            onClick={() => go(wikiPatch(null, { tab: "lint" }))}
          />
        )}
      </div>

      <NewPageDialog
        open={creating !== undefined}
        onOpenChange={(open) => !open && setCreating(undefined)}
        agent={agent}
        ownerName={viewer?.name}
        preset={creating}
        existing={new Set(pages.map((page) => page.id))}
        onCreated={(page) =>
          go(
            wikiPatch(page.id, {
              agent: agent ?? null,
              edit: agent ? "own" : "world",
              kind: page.kind,
              name: page.name,
            }),
          )
        }
      />
    </ListPane>
  );
}

function FootIcon({ children }: { children: ReactNode }) {
  return (
    <span
      aria-hidden
      className="grid size-8 shrink-0 place-items-center rounded-[0.75rem] bg-ui-tint text-ui-soft [&_svg]:size-4"
    >
      {children}
    </span>
  );
}

/**
 * Which wiki the index shows: the world's, or one character's own, which opens
 * each page beside what they make of it. A button with the wiki's name; its
 * list opens with a search at the top.
 */
function WhoseWiki({
  agent,
  onChange,
}: {
  agent: string | undefined;
  onChange: (agent: string | undefined) => void;
}) {
  const { characters, byId } = useCharacters();
  const pageName = usePageName();
  const [query, setQuery] = useState("");
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const items = useMemo(
    () => [
      { value: WORLD, label: "World Wiki" },
      ...characters
        .filter((c) => c.kind === "agent" && !c.isSystemAgent)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((c) => ({ value: c.id, label: c.name })),
    ],
    [characters],
  );
  const viewer = agent ? byId.get(agent) : undefined;
  const label = agent
    ? `${(viewer?.name ?? pageName(agent)).split(" ")[0]}'s wiki`
    : "World Wiki";
  return (
    <Combobox<string>
      items={items}
      value={agent ?? WORLD}
      query={query}
      onQueryChange={setQuery}
      onOpenChange={(open) => open && setQuery("")}
      onOpenChangeComplete={(open) => !open && anchor?.focus()}
      onValueChange={(next) => {
        if (next === null) return;
        onChange(next === WORLD ? undefined : next);
      }}
      autoHighlight="always"
    >
      <ComboboxTrigger
        ref={setAnchor}
        aria-label={`Whose wiki: ${label}`}
        className={cx(
          "mb-3 flex h-11 shrink-0 items-center gap-2.5 rounded-[1rem] ps-2 pe-3 text-start text-sm font-extrabold transition-colors duration-200 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ui-primary data-open:inset-ring-2 data-open:inset-ring-ui-primary",
          agent
            ? "bg-ui-accent-tint text-ui-accent-ink"
            : "bg-ui-surface inset-ring inset-ring-ui-line hover:bg-ui-tint",
        )}
      >
        {viewer ? (
          <CharacterAvatar
            id={viewer.id}
            name={viewer.name}
            avatarUrl={viewer.avatarUrl}
            kind={viewer.kind}
            size="sm"
            decorative
          />
        ) : (
          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-ui-tint text-ui-primary [&_svg]:size-4">
            <GlobeIcon aria-hidden />
          </span>
        )}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <ChevronDownIcon aria-hidden className="size-4 shrink-0 opacity-70" />
      </ComboboxTrigger>
      <ComboboxPopup
        anchor={anchor}
        search="Read as…"
        emptyText="Nobody by that name."
        className="max-h-[min(26rem,var(--available-height))]"
      >
        {(state) =>
          (state.items as readonly { value: string; label: string }[]).map(
            (item) => {
              const who = item.value ? byId.get(item.value) : undefined;
              return (
                <ComboboxOption
                  key={item.value || "world"}
                  value={item.value}
                  label={item.label}
                  className="min-h-10 data-selected:text-ui-primary"
                >
                  {who ? (
                    <CharacterAvatar
                      id={who.id}
                      name={who.name}
                      avatarUrl={who.avatarUrl}
                      kind={who.kind}
                      size="xs"
                      decorative
                    />
                  ) : (
                    <GlobeIcon aria-hidden className="size-5 text-ui-primary" />
                  )}
                  <span className="min-w-0 truncate">{item.label}</span>
                </ComboboxOption>
              );
            },
          )
        }
      </ComboboxPopup>
    </Combobox>
  );
}

/** The rows that hold a page's own row, outermost first. */
function pathTo(nodes: readonly IndexNode[], page: string | null): string[] {
  if (!page) return [];
  for (const node of nodes) {
    if (node.value === page) return [];
    if (node.children) {
      const below = pathTo(node.children, page);
      if (below.length || node.children.some((child) => child.value === page))
        return [node.value, ...below];
    }
  }
  return [];
}

/** What a right click landed on: a page's row, or a shelf. */
type Pressed = { page: WikiListItem } | { shelf: Shelf } | undefined;

/**
 * The shelves as a tree: one tab stop, arrows to move, typing to jump. A shelf
 * opens and closes on a press; a page opens, and an area's chevron shows what
 * is in it. A page on two shelves (a place that is a group) stands on both,
 * with a mark for the other. A right click, or Shift+F10, offers what can be
 * made there.
 */
function IndexTree({
  index,
  pages,
  agent,
  current,
  searching,
  onOpen,
  onCreate,
}: {
  index: ReturnType<typeof buildIndex>;
  pages: readonly WikiListItem[];
  agent: string | undefined;
  current: string | null;
  searching: boolean;
  onOpen?: (() => void) | undefined;
  onCreate?: ((preset: NewPagePreset) => void) | undefined;
}) {
  const [, setParams] = useQueryStates(wikiParsers);
  const target = usePageTarget();
  const { byId } = useCharacters();
  const byPage = useMemo(
    () => new Map(pages.map((page) => [page.id, page])),
    [pages],
  );
  const [expanded, setExpanded] = useState<string[]>(() => [
    ...(searching || index.items.length === 1
      ? index.items.map((item) => item.value)
      : []),
    ...pathTo(index.items, current),
  ]);
  // Opening a page from elsewhere (a link, the palette) unfolds the way to it.
  const [shownFor, setShownFor] = useState(current);
  if (shownFor !== current) {
    setShownFor(current);
    const path = pathTo(index.items, current);
    if (path.some((value) => !expanded.includes(value)))
      setExpanded([...new Set([...expanded, ...path])]);
  }
  const [pressed, setPressed] = useState<Pressed>();

  const href = (page: WikiListItem) =>
    agent
      ? `?view=wiki&wiki.agent=${encodeURIComponent(agent)}&wiki.page=${encodeURIComponent(page.id)}`
      : target(page).href;
  const open = (page: WikiListItem) => {
    if (agent) void setParams(wikiPatch(page.id, { agent }));
    else target(page).open();
    onOpen?.();
  };
  const pageOf = (node: IndexNode) =>
    node.page ? byPage.get(node.page) : undefined;
  const values = new Map<string, IndexNode>();
  const walk = (nodes: readonly IndexNode[]) => {
    for (const node of nodes) {
      values.set(node.value, node);
      if (node.children) walk(node.children);
    }
  };
  walk(index.items);

  const rows = (nodes: readonly IndexNode[], shelf?: Shelf): ReactNode =>
    nodes.map((node) => {
      const own =
        isShelfValue(node.value) && !node.page
          ? (node.value.slice(1) as Shelf)
          : undefined;
      const on = own ?? shelf;
      const page = pageOf(node);
      const who = page?.kind === "person" ? byId.get(page.id) : undefined;
      const others = page
        ? shelvesOf(page).filter((other) => other !== on)
        : [];
      return (
        <TreeRow
          key={node.value}
          value={node.value}
          label={node.label}
          heading={Boolean(own)}
          marked={Boolean(
            page && page.id === current && node.value !== page.id,
          )}
          data={page ? { "data-page": page.id } : { "data-shelf": own ?? "" }}
          render={page ? <a href={href(page)} /> : undefined}
          leading={
            own ? (
              <span aria-hidden className="text-ui-primary [&_svg]:size-4">
                {SHELF_ICON[own]}
              </span>
            ) : who && isCast(who) ? (
              <CharacterAvatar
                id={who.id}
                name={who.name}
                avatarUrl={who.avatarUrl}
                kind={who.kind}
                size="xs"
                decorative
              />
            ) : null
          }
          trailing={
            own ? (
              <span className="text-xs font-bold text-ui-soft tabular-nums">
                {index.counts[own]}
              </span>
            ) : others.length ? (
              <span
                className="flex shrink-0 gap-1 text-ui-soft [&_svg]:size-3.5"
                title={`Also a ${others.map((o) => (o === "places" ? "place" : "group")).join(" and ")}`}
              >
                {others.map((other) => (
                  <span key={other}>{SHELF_ICON[other]}</span>
                ))}
              </span>
            ) : null
          }
        >
          {node.children ? rows(node.children, on) : undefined}
        </TreeRow>
      );
    });

  const placeOf = (target: Pressed) =>
    target && "page" in target && target.page.place ? target.page : undefined;

  return (
    <Menu>
      <MenuContextTrigger
        render={<div />}
        onContextMenuCapture={(event) => {
          const element = event.target as HTMLElement;
          const row = element.closest<HTMLElement>("[data-page],[data-shelf]");
          const page = row?.dataset.page
            ? byPage.get(row.dataset.page)
            : undefined;
          setPressed(
            page
              ? { page }
              : row?.dataset.shelf
                ? { shelf: row.dataset.shelf as Shelf }
                : undefined,
          );
        }}
      >
        <Tree
          items={index.items}
          aria-label={agent ? "Their pages" : "Pages"}
          mode="none"
          current={current}
          expanded={expanded}
          onExpandedChange={setExpanded}
          expandOnPress
          onAction={(value, { event }) => {
            const node = values.get(value);
            const page = node ? pageOf(node) : undefined;
            if (!page) return;
            if (
              event instanceof MouseEvent &&
              (event.metaKey ||
                event.ctrlKey ||
                event.shiftKey ||
                event.button !== 0)
            )
              return;
            event?.preventDefault();
            open(page);
          }}
        >
          {rows(index.items)}
        </Tree>
      </MenuContextTrigger>
      <MenuContent>
        {pressed && "page" in pressed ? (
          <>
            <MenuItem
              icon={<ExternalLinkIcon aria-hidden />}
              onClick={() => window.open(href(pressed.page), "_blank")}
            >
              Open in new tab
            </MenuItem>
            <MenuItem
              icon={<CopyIcon aria-hidden />}
              onClick={() => void copyMarkdown(pressed.page.id, agent)}
            >
              Copy as Markdown
            </MenuItem>
            {onCreate && !agent && placeOf(pressed) ? (
              <>
                <MenuSeparator />
                <MenuItem
                  icon={<MapPinPlusIcon aria-hidden />}
                  onClick={() =>
                    onCreate({ kind: "place", parent: pressed.page.id })
                  }
                >
                  New place inside
                </MenuItem>
              </>
            ) : null}
          </>
        ) : pressed && "shelf" in pressed && onCreate ? (
          <MenuItem
            icon={<FilePlusIcon aria-hidden />}
            onClick={() => {
              const kind = SHELF_KIND[pressed.shelf];
              onCreate(kind ? { kind } : {});
            }}
          >
            {SHELF_KIND[pressed.shelf]
              ? NEW_WORD[SHELF_KIND[pressed.shelf]!]
              : "New page"}
          </MenuItem>
        ) : (
          <MenuItem disabled>Nothing here</MenuItem>
        )}
      </MenuContent>
    </Menu>
  );
}
