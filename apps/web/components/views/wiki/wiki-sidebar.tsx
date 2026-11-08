"use client";

import { useQueryStates, type inferParserType } from "nuqs";
import { wikiParsers } from "./search-params";
import { useMemo, useState } from "react";
import { AlertTriangleIcon, FilePlusIcon, MoonIcon } from "lucide-react";
import type { WikiListItem } from "@kazusa/client";
import { PanelToolbar } from "@/components/shell/panel-toolbar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAccess } from "@/hooks/use-access";
import { useCharacters } from "@/hooks/use-characters";
import { useWikiLint, useWikiList } from "@/hooks/use-wiki";
import type { SectionSidebarProps } from "@/lib/registry/types";
import { NewPageDialog } from "./new-page-dialog";
import { PageTree } from "./page-tree";

/** Leaving a page leaves its editor too. */
const CLOSED = { "wiki.edit": null, "wiki.kind": null, "wiki.name": null };

/** Pick a wiki (the world's, or one character's mind), then a page in it. */
export function WikiSidebar({ onNavigated }: SectionSidebarProps) {
  const [queryState, setParams] = useQueryStates(wikiParsers);
  const agent = queryState["wiki.agent"] ?? undefined;
  const open = queryState["wiki.page"];
  const tab = queryState["wiki.tab"];
  const { canManage } = useAccess();
  const { characters } = useCharacters();
  const { data } = useWikiList(agent);
  const { data: lint } = useWikiLint(agent);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const wikis = useMemo(
    () => [
      { label: "The world", value: null },
      ...characters.map((character) => ({
        label: character.name,
        value: character.id,
      })),
    ],
    [characters],
  );
  const agentName = characters.find(
    (character) => character.id === agent,
  )?.name;
  const existing = useMemo(
    () => new Set((data?.pages ?? []).map((page: WikiListItem) => page.id)),
    [data],
  );
  const needle = query.trim().toLowerCase();
  const pages = useMemo(
    () =>
      (data?.pages ?? []).filter(
        (page: WikiListItem) =>
          !needle ||
          page.name.toLowerCase().includes(needle) ||
          page.summary.toLowerCase().includes(needle),
      ),
    [data, needle],
  );

  const go = (patch: Partial<inferParserType<typeof wikiParsers>>) => {
    void setParams({ ...CLOSED, ...patch });
    onNavigated?.();
  };
  const problems = lint?.findings.length ?? 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-2 pt-2">
        <Select
          items={wikis}
          value={agent ?? null}
          onValueChange={(value) =>
            go({ "wiki.agent": value ?? null, "wiki.tab": null })
          }
        >
          <SelectTrigger className="w-full" aria-label="Whose wiki">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {wikis.map((wiki) => (
              <SelectItem key={wiki.value ?? ""} value={wiki.value}>
                {wiki.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <PanelToolbar
        query={query}
        onQueryChange={setQuery}
        placeholder={`Search ${data?.pages.length ?? 0} pages`}
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
        whose={agentName ? `${agentName}'s wiki` : "the World Wiki"}
        existing={existing}
        onCreate={(page) =>
          go({
            "wiki.page": page.id,
            "wiki.tab": null,
            "wiki.edit": agent ? "own" : "world",
            "wiki.kind": page.kind,
            "wiki.name": page.name,
          })
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {pages.length ? (
          <PageTree
            // A search opens every folder again, so no match is hidden.
            key={needle ? "search" : "browse"}
            pages={pages}
            selected={tab ? undefined : (open ?? undefined)}
            onSelect={(id) => go({ "wiki.page": id, "wiki.tab": null })}
          />
        ) : (
          <p className="px-2 py-4 text-sm text-muted-foreground">
            {needle ? "No pages match." : "No pages yet."}
          </p>
        )}
      </div>
      <div className="flex shrink-0 flex-col border-t p-2">
        {agent ? (
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
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          className={`w-full justify-start font-normal ${
            tab === "lint" ? "bg-accent text-accent-foreground" : ""
          }`}
          aria-current={tab === "lint" ? "page" : undefined}
          onClick={() => go({ "wiki.tab": "lint" })}
        >
          <AlertTriangleIcon />
          Problems
          <Badge variant="secondary" className="ml-auto">
            {problems}
          </Badge>
        </Button>
      </div>
    </div>
  );
}
