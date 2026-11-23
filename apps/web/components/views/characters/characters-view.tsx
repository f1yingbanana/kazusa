"use client";

import { useMemo, useState } from "react";
import { MenuIcon, UserRoundPlusIcon, UsersRoundIcon } from "lucide-react";
import { parseAsString, useQueryState, useQueryStates } from "nuqs";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Unavailable } from "@/components/entities/source-state";
import { PanelToolbar } from "@/components/shell/panel-toolbar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { usePlainText } from "@/components/views/wiki/page-link";
import { useAccess } from "@/hooks/use-access";
import { useWikiList } from "@/hooks/use-wiki";
import { NewCharacterDialog } from "./new-character-dialog";
import { WorldPage } from "@/components/views/wiki/wiki-view";
import { wikiParsers } from "@/components/views/wiki/search-params";
import { useCast, useCharacters } from "@/hooks/use-characters";
import type { SectionSidebarProps } from "@/lib/registry/types";
import { useSources } from "@/lib/source/provider";
import { requestSidebar } from "@/lib/state/ui-store";
import { cn } from "@/lib/utils";

const characterParser = parseAsString;

/** The cast this world simulates: the system agent isn't one of them. */

/** Each character of the cast, by name, with the line people know them by. */
export function CharactersSidebar({ onNavigated }: SectionSidebarProps) {
  const cast = useCast();
  const [selected, setSelected] = useQueryState("character", characterParser);
  const [, setWiki] = useQueryStates(wikiParsers);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const { canManage } = useAccess();
  const { characters } = useCharacters();
  const { data: pages } = useWikiList();
  // Ids already taken: every page in the World Wiki and every character.
  const taken = useMemo(
    () =>
      new Set([
        ...(pages?.pages ?? []).map(({ id }) => id),
        ...characters.map(({ id }) => id.replace(/^user:/, "")),
      ]),
    [pages, characters],
  );
  const plain = usePlainText();
  const needle = query.trim().toLowerCase();
  const shown = cast.filter(
    (one) =>
      !needle ||
      one.name.toLowerCase().includes(needle) ||
      (one.summary ?? "").toLowerCase().includes(needle),
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PanelToolbar
        query={query}
        onQueryChange={setQuery}
        placeholder={`Search ${cast.length} characters`}
        label="Search characters"
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
            <UserRoundPlusIcon />
            <span className="sr-only">New character</span>
          </TooltipTrigger>
          <TooltipContent>New character</TooltipContent>
        </Tooltip>
      </PanelToolbar>
      <NewCharacterDialog
        open={creating}
        onOpenChange={setCreating}
        existing={taken}
        onCreated={(id) => {
          void setSelected(id);
          void setWiki({
            "wiki.part": null,
            "wiki.edit": "world",
            "wiki.raw": null,
          });
          onNavigated?.();
        }}
      />
      <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {shown.map((one) => (
          <li key={one.id}>
            <button
              type="button"
              aria-current={selected === one.id ? "true" : undefined}
              className={cn(
                "flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
                selected === one.id && "bg-accent text-accent-foreground",
              )}
              onClick={() => {
                void setSelected(one.id);
                // A character's tabs start on their page.
                void setWiki({
                  "wiki.part": null,
                  "wiki.edit": null,
                  "wiki.raw": null,
                  "wiki.kind": null,
                  "wiki.name": null,
                });
                onNavigated?.();
              }}
            >
              <Avatar className="size-8">
                {one.avatarUrl ? (
                  <AvatarImage src={one.avatarUrl} alt="" />
                ) : null}
                <AvatarFallback className="text-xs">
                  {one.name.slice(0, 1)}
                </AvatarFallback>
              </Avatar>
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-medium">{one.name}</span>
                {one.summary ? (
                  <span className="truncate text-xs text-muted-foreground">
                    {plain(one.summary)}
                  </span>
                ) : null}
              </span>
            </button>
          </li>
        ))}
        {!shown.length ? (
          <li className="px-2 py-4 text-sm text-muted-foreground">
            {needle ? "No one matches." : "No characters yet."}
          </li>
        ) : null}
      </ul>
    </div>
  );
}

/** One character: who they are, their memory, looks and stickers. */
export function CharactersView() {
  const { resolved } = useSources();
  const [selected] = useQueryState("character", characterParser);
  if (resolved.wiki !== "live")
    return <Unavailable requires={["wiki"]} className="m-auto" />;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4 lg:hidden">
        <Button variant="outline" size="sm" onClick={requestSidebar}>
          <MenuIcon />
          Characters
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {selected ? (
          <WorldPage key={selected} id={selected} />
        ) : (
          <Empty className="h-full">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <UsersRoundIcon />
              </EmptyMedia>
              <EmptyTitle>Pick a character</EmptyTitle>
            </EmptyHeader>
          </Empty>
        )}
      </div>
    </div>
  );
}
