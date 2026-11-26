"use client";

import type { WikiListItem } from "@kazusa/client";
import {
  ChevronDownIcon,
  FilePlusIcon,
  GlobeIcon,
  MoonIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";
import { useQueryStates } from "nuqs";
import { useMemo, useState, type ReactNode } from "react";
import { useAccess } from "@/hooks/use-access";
import { isCast, useCharacters } from "@/hooks/use-characters";
import { useWikiLint, useWikiList } from "@/hooks/use-wiki";
import type { SectionSidebarProps } from "@/lib/registry/types";
import {
  buildIndex,
  isShelfValue,
  type IndexNode,
  type Shelf,
} from "@/lib/wiki/index-tree";
import { IconButton } from "@/ui/button";
import {
  Combobox,
  ComboboxInput,
  ComboboxOption,
  ComboboxPopup,
  ComboboxTrigger,
} from "@/ui/combobox";
import { cx } from "@/ui/cx";
import { SearchInput } from "@/ui/input";
import { Badge, ListPane, ListRow } from "@/ui/list";
import { Note } from "@/ui/note";
import { createTreeController, Tree, TreeRow } from "@/ui/tree";
import { CharacterAvatar } from "../characters/character-avatar";
import { usePageTarget } from "./links";
import { NewPageDialog } from "./new-page-dialog";
import { wikiPatch } from "./open";
import { wikiParsers } from "./search-params";
import { SHELF_ICON } from "./shelf-icon";

const WORLD = "";

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
  const data = list.data;
  const { data: lint } = useWikiLint();
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const { byId } = useCharacters();
  const viewer = agent ? byId.get(agent) : undefined;
  const pages = data?.pages ?? [];
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
              pages.length ? `Search ${pages.length} pages` : "Search pages"
            }
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <IconButton
            label="New page"
            title={
              canManage
                ? "New page"
                : "Only whoever runs the world writes pages"
            }
            disabled={!canManage}
            onClick={() => setCreating(true)}
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
        {list.isLoading ? (
          <Note inset="list">Opening the shelves…</Note>
        ) : list.error ? (
          <Note inset="list">{"Couldn't read this wiki."}</Note>
        ) : index.items.length === 0 ? (
          <Note inset="list">
            {searching
              ? `No page matches “${query.trim()}”.`
              : viewer
                ? `${viewer.name} hasn't written anything of their own yet.`
                : "No pages yet."}
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
            title="What each night changed"
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
            sub={problems ? undefined : "None found"}
            trailing={
              problems ? <Badge count={problems} label="problems" /> : null
            }
            onClick={() => go(wikiPatch(null, { tab: "lint" }))}
          />
        )}
      </div>

      <NewPageDialog
        open={creating}
        onOpenChange={setCreating}
        agent={agent}
        ownerName={viewer?.name}
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
 * each page beside what that character makes of it.
 */
function WhoseWiki({
  agent,
  onChange,
}: {
  agent: string | undefined;
  onChange: (agent: string | undefined) => void;
}) {
  const { characters, byId } = useCharacters();
  const cast = useMemo(
    () =>
      characters
        .filter((c) => c.kind === "agent" && !c.isSystemAgent)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [characters],
  );
  const items = useMemo(
    () => [
      { value: WORLD, label: "World Wiki" },
      ...cast.map((c) => ({ value: c.id, label: `${c.name}'s wiki` })),
    ],
    [cast],
  );
  const viewer = agent ? byId.get(agent) : undefined;
  return (
    <Combobox<string>
      items={items}
      value={agent ?? WORLD}
      onValueChange={(next) => {
        if (next === null) return;
        onChange(next === WORLD ? undefined : next);
      }}
      autoHighlight="always"
    >
      <div
        className={cx(
          "group/whose mb-3 flex h-11 shrink-0 items-center gap-2 rounded-[1rem] ps-2 pe-1 transition-colors duration-200 focus-within:inset-ring-2 focus-within:inset-ring-ui-primary",
          viewer
            ? "bg-ui-accent-tint text-ui-accent-ink"
            : "bg-ui-surface inset-ring inset-ring-ui-line",
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
        <ComboboxInput
          aria-label="Whose wiki"
          className="h-full min-w-0 flex-1 bg-transparent text-sm font-extrabold outline-none placeholder:font-semibold placeholder:text-ui-soft"
          placeholder="Read as someone…"
          onFocus={(event) => event.currentTarget.select()}
        />
        {viewer ? (
          <IconButton
            label="Back to the World Wiki"
            size="sm"
            tone="ghost"
            className="text-current"
            onClick={() => onChange(undefined)}
          >
            <XIcon aria-hidden />
          </IconButton>
        ) : null}
        <ComboboxTrigger
          aria-label="Choose whose wiki"
          className="grid size-7.5 shrink-0 place-items-center rounded-full text-ui-soft hover:bg-ui-tint [&_svg]:size-4"
        >
          <ChevronDownIcon aria-hidden />
        </ComboboxTrigger>
      </div>
      <ComboboxPopup
        emptyText="Nobody by that name."
        className="max-h-[min(24rem,var(--available-height))]"
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

/**
 * The shelves as a tree: one tab stop, arrows to move, typing to jump. A shelf
 * opens and closes; a page opens, and an area's chevron shows what is in it. A
 * link underneath, so a page opens in a new tab too.
 */
function IndexTree({
  index,
  pages,
  agent,
  current,
  searching,
  onOpen,
}: {
  index: ReturnType<typeof buildIndex>;
  pages: readonly WikiListItem[];
  agent: string | undefined;
  current: string | null;
  searching: boolean;
  onOpen?: (() => void) | undefined;
}) {
  const [controller] = useState(createTreeController);
  const [, setParams] = useQueryStates(wikiParsers);
  const target = usePageTarget();
  const { byId } = useCharacters();
  const byPage = useMemo(
    () => new Map(pages.map((page) => [page.id, page])),
    [pages],
  );
  const open = (id: string) => {
    const page = byPage.get(id);
    if (!page) return;
    if (agent) void setParams(wikiPatch(id, { agent }));
    else target(page).open();
    onOpen?.();
  };
  const href = (page: WikiListItem) =>
    agent
      ? `?view=wiki&wiki.agent=${encodeURIComponent(agent)}&wiki.page=${encodeURIComponent(page.id)}`
      : target(page).href;

  const rows = (nodes: readonly IndexNode[]): ReactNode =>
    nodes.map((node) => {
      const shelf = isShelfValue(node.value)
        ? (node.value.slice(1) as Shelf)
        : undefined;
      const page = shelf ? undefined : byPage.get(node.value);
      const who = page?.kind === "person" ? byId.get(page.id) : undefined;
      return (
        <TreeRow
          key={node.value}
          value={node.value}
          label={node.label}
          heading={Boolean(shelf)}
          render={page ? <a href={href(page)} /> : undefined}
          leading={
            shelf ? (
              <span aria-hidden className="text-ui-primary [&_svg]:size-4">
                {SHELF_ICON[shelf]}
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
            shelf ? (
              <span className="text-xs font-bold text-ui-soft tabular-nums">
                {index.counts[shelf]}
              </span>
            ) : node.children ? (
              <span className="text-xs font-semibold text-ui-soft tabular-nums opacity-0 transition-opacity group-hover/row:opacity-100">
                {node.children.length}
              </span>
            ) : null
          }
        >
          {node.children ? rows(node.children) : undefined}
        </TreeRow>
      );
    });

  return (
    <Tree
      items={index.items}
      aria-label={agent ? "Their pages" : "Pages"}
      mode="none"
      controller={controller}
      current={current}
      defaultExpanded={
        searching || index.items.length === 1
          ? index.items.map((item) => item.value)
          : []
      }
      onAction={(value, { event }) => {
        if (isShelfValue(value)) {
          controller.toggle(value);
          return;
        }
        if (
          event instanceof MouseEvent &&
          (event.metaKey ||
            event.ctrlKey ||
            event.shiftKey ||
            event.button !== 0)
        )
          return;
        event?.preventDefault();
        open(value);
      }}
    >
      {rows(index.items)}
    </Tree>
  );
}
