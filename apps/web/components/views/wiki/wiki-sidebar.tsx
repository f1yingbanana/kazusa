"use client";

import { useQueryStates, type inferParserType } from "nuqs";
import { wikiParsers } from "./search-params";
import { useMemo, useState } from "react";
import { AlertTriangleIcon, FilePlusIcon, MoonIcon, XIcon } from "lucide-react";
import type { WikiListItem } from "@kazusa/client";
import { PanelToolbar } from "@/components/shell/panel-toolbar";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAccess } from "@/hooks/use-access";
import { useCharacters } from "@/hooks/use-characters";
import { useWikiLint, useWikiList } from "@/hooks/use-wiki";
import { useWikiBackdrops } from "@/hooks/use-wiki-editor";
import type { SectionSidebarProps } from "@/lib/registry/types";
import { NewPageDialog } from "./new-page-dialog";
import { PageTree } from "./page-tree";
import { toPictureName } from "./parts";

/** Leaving a page leaves its editor too. */
const CLOSED = {
  "wiki.edit": null,
  "wiki.kind": null,
  "wiki.name": null,
  "wiki.raw": null,
};

/** A new backdrop set is a name; it exists once its first picture is in. */
function NewBackdropDialog({
  open,
  onOpenChange,
  taken,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taken: ReadonlySet<string>;
  onCreate: (name: string) => void;
}) {
  const [words, setWords] = useState("");
  const name = toPictureName(words);
  const clash = taken.has(name);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New backdrop set</DialogTitle>
          <DialogDescription>
            Pictures of one kind of place, one for each time of day. Many places
            can share a set: a place shows it once its page names it as its
            backdrop.
          </DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor="wiki-new-backdrop">Name</FieldLabel>
          <Input
            id="wiki-new-backdrop"
            value={words}
            autoFocus
            placeholder="Rooftop garden"
            onChange={(event) => setWords(event.target.value)}
          />
          <FieldDescription>
            {clash
              ? `There is already a set called ${name}.`
              : name
                ? `Saved as ${name}.`
                : "Lowercase words joined by dashes."}
          </FieldDescription>
        </Field>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>
            Cancel
          </DialogClose>
          <Button
            disabled={!name || clash}
            onClick={() => {
              onCreate(name);
              setWords("");
            }}
          >
            Make set
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The World Wiki's pages and backdrops, or one character's own pages while in
 * their view. Each character of the cast has a button for their view.
 */
export function WikiSidebar({ onNavigated }: SectionSidebarProps) {
  const [queryState, setParams] = useQueryStates(wikiParsers);
  const agent = queryState["wiki.agent"] ?? undefined;
  const open = queryState["wiki.page"];
  const tab = queryState["wiki.tab"];
  const backdrop = queryState["wiki.backdrop"] ?? undefined;
  const { canManage } = useAccess();
  const { characters, byId } = useCharacters();
  const { data } = useWikiList(agent);
  const { data: lint } = useWikiLint(agent);
  const { data: library } = useWikiBackdrops(canManage && !agent);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [newBackdrop, setNewBackdrop] = useState(false);
  const viewer = agent ? byId.get(agent) : undefined;
  const viewable = useMemo(
    () =>
      new Map(
        characters
          .filter((one) => one.kind === "agent" && !one.isSystemAgent)
          .map((one) => [one.id, one.name]),
      ),
    [characters],
  );
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
  const sets = useMemo(() => {
    if (agent || !library) return undefined;
    const pending =
      backdrop && !library.sets.some((set) => set.name === backdrop)
        ? [{ name: backdrop, preview: undefined }]
        : [];
    return [
      ...library.sets
        .filter((set) => !needle || set.name.includes(needle))
        .map((set) => ({
          name: set.name,
          preview: (set.files.find((file) => !file.state) ?? set.files[0])?.url,
        })),
      ...pending,
    ];
  }, [agent, library, backdrop, needle]);

  const go = (patch: Partial<inferParserType<typeof wikiParsers>>) => {
    void setParams({ ...CLOSED, ...patch });
    onNavigated?.();
  };
  const problems = lint?.findings.length ?? 0;

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
        whose={viewer ? `${viewer.name}'s wiki` : "the World Wiki"}
        existing={existing}
        onCreate={(page) =>
          go({
            "wiki.page": page.id,
            "wiki.tab": null,
            "wiki.backdrop": null,
            "wiki.part": null,
            "wiki.edit": agent ? "own" : "world",
            "wiki.kind": page.kind,
            "wiki.name": page.name,
          })
        }
      />
      <NewBackdropDialog
        open={newBackdrop}
        onOpenChange={setNewBackdrop}
        taken={new Set((library?.sets ?? []).map((set) => set.name))}
        onCreate={(name) => {
          setNewBackdrop(false);
          go({ "wiki.backdrop": name, "wiki.page": null, "wiki.tab": null });
        }}
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {pages.length || sets?.length ? (
          <PageTree
            // A search opens every folder again, so no match is hidden.
            key={needle ? "search" : "browse"}
            pages={pages}
            selected={tab || backdrop ? undefined : (open ?? undefined)}
            onSelect={(id) =>
              go({
                "wiki.page": id,
                "wiki.tab": null,
                "wiki.backdrop": null,
                "wiki.part": null,
              })
            }
            {...(agent
              ? {}
              : {
                  viewable,
                  onView: (id: string) =>
                    go({
                      "wiki.agent": id,
                      "wiki.page": null,
                      "wiki.tab": null,
                      "wiki.backdrop": null,
                      "wiki.part": null,
                    }),
                })}
            {...(sets
              ? {
                  backdrops: sets,
                  backdrop,
                  onBackdrop: (name: string) =>
                    go({
                      "wiki.backdrop": name,
                      "wiki.page": null,
                      "wiki.tab": null,
                    }),
                  onNewBackdrop: () => setNewBackdrop(true),
                }
              : {})}
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
