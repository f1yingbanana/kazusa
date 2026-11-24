"use client";

import { parseAsString, useQueryStates, type inferParserType } from "nuqs";
import { wikiParsers } from "./search-params";
import { useMemo, useState } from "react";
import { FilePlusIcon, MoonIcon, XIcon } from "lucide-react";
import type { WikiListItem } from "@kazusa/client";
import { PanelToolbar } from "@/components/shell/panel-toolbar";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAccess } from "@/hooks/use-access";
import { useCharacters, isCast } from "@/hooks/use-characters";
import { useWikiList } from "@/hooks/use-wiki";
import type { SectionSidebarProps } from "@/lib/registry/types";
import { NewPageDialog } from "./new-page-dialog";
import {
  CategoryFilter,
  PageTree,
  categoriesOf,
  type Category,
} from "./page-tree";

/** Leaving a page leaves its editor too. */
const CLOSED = {
  "wiki.edit": null,
  "wiki.kind": null,
  "wiki.name": null,
  "wiki.raw": null,
};

/**
 * The World Wiki's pages, or one character's own pages while in their view.
 * Each character of the cast has a button for their view.
 */
export function WikiSidebar({ onNavigated }: SectionSidebarProps) {
  const [queryState, setParams] = useQueryStates(wikiParsers);
  const [, setView] = useQueryStates({
    view: parseAsString,
    character: parseAsString,
  });
  const agent = queryState["wiki.agent"] ?? undefined;
  const open = queryState["wiki.page"];
  const tab = queryState["wiki.tab"];
  const { canManage } = useAccess();
  const { byId } = useCharacters();
  const { data } = useWikiList(agent);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<Category>();
  // A filter belongs to the wiki it was chosen in.
  const [filteredIn, setFilteredIn] = useState(agent);
  if (filteredIn !== agent) {
    setFilteredIn(agent);
    setCategory(undefined);
  }
  const [creating, setCreating] = useState(false);
  const viewer = agent ? byId.get(agent) : undefined;
  const existing = useMemo(
    () => new Set((data?.pages ?? []).map((page: WikiListItem) => page.id)),
    [data],
  );
  const needle = query.trim().toLowerCase();
  // The cast has its own tab; anyone else with a page (the system agent, a
  // character who isn't simulated) stays here, as do a character's own pages.
  const listed = useMemo(
    () =>
      (data?.pages ?? []).filter(
        (page: WikiListItem) =>
          agent ||
          page.kind !== "person" ||
          byId.get(page.id)?.kind !== "agent" ||
          byId.get(page.id)?.isSystemAgent === true,
      ),
    [data, agent, byId],
  );
  const categories = useMemo(
    () =>
      (["people", "places", "groups"] as const).filter((one) =>
        listed.some((page) => categoriesOf(page).includes(one)),
      ),
    [listed],
  );
  // A search finds every page, the cast's too: a name typed is never a dead end.
  const pages = useMemo(
    () =>
      (needle ? (data?.pages ?? []) : listed).filter(
        (page: WikiListItem) =>
          (!category || categoriesOf(page).includes(category)) &&
          (!needle ||
            page.name.toLowerCase().includes(needle) ||
            page.summary.toLowerCase().includes(needle)),
      ),
    [data, listed, category, needle],
  );

  const go = (patch: Partial<inferParserType<typeof wikiParsers>>) => {
    void setParams({ ...CLOSED, ...patch });
    onNavigated?.();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {agent ? (
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <Avatar className="size-6">
            {viewer?.avatarUrl ? (
              <AvatarImage src={viewer.avatarUrl} alt="" />
            ) : null}
            <AvatarFallback className="text-[0.65rem]">
              {(viewer?.name ?? agent).slice(0, 1)}
            </AvatarFallback>
          </Avatar>
          <span className="min-w-0 flex-1 truncate text-sm font-medium">
            {viewer?.name ?? agent}&apos;s view
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Back to the world"
            title="Back to the world"
            onClick={() =>
              go({
                "wiki.agent": null,
                "wiki.page": agent,
                "wiki.tab": null,
                "wiki.part": null,
              })
            }
          >
            <XIcon />
          </Button>
        </div>
      ) : null}
      <PanelToolbar
        query={query}
        onQueryChange={setQuery}
        placeholder={`Search ${listed.length} pages`}
        label="Search pages"
      >
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={!canManage}
                onClick={() => setCreating(true)}
              />
            }
          >
            <FilePlusIcon />
            <span className="sr-only">New page</span>
          </TooltipTrigger>
          <TooltipContent>New page</TooltipContent>
        </Tooltip>
      </PanelToolbar>
      <NewPageDialog
        open={creating}
        onOpenChange={setCreating}
        whose={viewer ? `${viewer.name}'s wiki` : "the World Wiki"}
        personal={Boolean(viewer)}
        {...(agent ? { agent } : {})}
        existing={existing}
        onCreate={(page) =>
          go({
            "wiki.page": page.id,
            "wiki.tab": null,
            "wiki.part": null,
            "wiki.edit": agent ? "own" : "world",
            "wiki.kind": page.kind,
            "wiki.name": page.name,
          })
        }
        onCharacter={
          viewer
            ? undefined
            : (id) => {
                // Simulated, they are the cast's: their page opens there.
                void setView({ view: "characters", character: id });
                void setParams({
                  ...CLOSED,
                  "wiki.page": null,
                  "wiki.edit": "world",
                });
                onNavigated?.();
              }
        }
      />
      <CategoryFilter
        categories={categories}
        value={category}
        onChange={setCategory}
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {pages.length ? (
          <PageTree
            // A search opens every folder again, so no match is hidden.
            key={needle ? "search" : "browse"}
            pages={pages}
            selected={tab ? undefined : (open ?? undefined)}
            onSelect={(id) =>
              // One of the cast opens where the cast lives.
              isCast(byId.get(id)) && !agent
                ? (void setView({ view: "characters", character: id }),
                  void setParams({ ...CLOSED, "wiki.page": null }),
                  onNavigated?.())
                : go({
                    "wiki.page": id,
                    "wiki.tab": null,
                    "wiki.part": null,
                  })
            }
          />
        ) : (
          <p className="px-2 py-4 text-sm text-muted-foreground">
            {needle ? "No pages match." : "No pages yet."}
          </p>
        )}
      </div>
      {agent ? (
        <div className="flex shrink-0 flex-col border-t p-2">
          <Button
            variant="ghost"
            size="sm"
            className={`w-full justify-start font-normal ${
              tab === "nights" ? "bg-accent text-accent-foreground" : ""
            }`}
            aria-current={tab === "nights" ? "page" : undefined}
            onClick={() => go({ "wiki.tab": "nights" })}
          >
            <MoonIcon />
            What each night changed
          </Button>
        </div>
      ) : null}
    </div>
  );
}
