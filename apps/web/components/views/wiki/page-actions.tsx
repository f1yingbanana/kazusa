"use client";

import { useState } from "react";
import { CopyIcon, EllipsisIcon, MapIcon, Trash2Icon } from "lucide-react";
import { parseAsString, useQueryStates } from "nuqs";
import { toast } from "sonner";
import type { WikiEditResult, WikiKind } from "@kazusa/client";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { worldParsers } from "@/components/views/world/search-params";
import { PLACE_PREFIX } from "@/components/views/world/world-state";
import { useCastChange } from "@/hooks/use-characters";
import { useDeleteWikiPage, useWikiSource } from "@/hooks/use-wiki";
import { deleteCharacter } from "@/lib/source/characters/http";
import { fetchWikiSource } from "@/lib/source/wiki/http";
import { entityRefParser } from "@/lib/state/entity-ref";

/** "Moved Airi to School · rewrote 3 pages", or nothing worth saying. */
function describeResult(result: WikiEditResult): string | undefined {
  const parts = [
    ...result.relocated.map(({ id, to }) => `${id} is now at ${to}`),
    ...(result.changed.length
      ? [
          `updated ${result.changed.length} other page${result.changed.length === 1 ? "" : "s"}`,
        ]
      : []),
  ];
  return parts.length ? parts.join(" · ") : undefined;
}

/** Opens a place on the World map, with the place picked. */
export function ShowOnMapButton({ id }: { id: string }) {
  const [, setParams] = useQueryStates({
    view: parseAsString,
    "world.by": worldParsers["world.by"],
    "world.in": worldParsers["world.in"],
    "world.as": worldParsers["world.as"],
    sel: entityRefParser,
  });
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() =>
        void setParams({
          view: "world",
          "world.by": "place",
          "world.in": `${PLACE_PREFIX}${id}`,
          "world.as": "map",
          sel: { kind: "place", id },
        })
      }
    >
      <MapIcon />
      Show on map
    </Button>
  );
}

/**
 * More for a page: copy its Markdown, and delete it, after asking; a place
 * takes the map's links to it along.
 */
export function PageMenu({
  id,
  name,
  agent,
  kind,
  place,
  canDelete,
  onDeleted,
  size = "sm",
  character = false,
}: {
  id: string;
  name: string;
  /** Their wiki; absent: the World Wiki. */
  agent?: string;
  kind?: WikiKind | undefined;
  /** A World Wiki place, whose removal changes the map. */
  place: boolean;
  canDelete: boolean;
  onDeleted: () => void;
  /** Matches the buttons beside it. */
  size?: "sm" | "xs";
  /** A character in the cast: deleting takes them out of it. */
  character?: boolean;
}) {
  const remove = useDeleteWikiPage();
  const castChange = useCastChange();
  const [open, setOpen] = useState(false);
  // Read with the page, so the text is at hand when the click comes.
  const source = useWikiSource(id, agent, kind);

  const copy = async () => {
    // Handed to the clipboard within the click, even while it still loads:
    // browsers only let a page write there while answering a click.
    const text = source.data
      ? Promise.resolve(source.data.text)
      : fetchWikiSource(id, agent, kind).then(({ text: page }) => page);
    try {
      if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write)
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/plain": text.then(
              (page) => new Blob([page], { type: "text/plain" }),
            ),
          }),
        ]);
      else await navigator.clipboard.writeText(await text);
      toast.success("Copied as Markdown");
    } catch (failure) {
      // Clipboard access refused: the older way, from a selection.
      const area = document.createElement("textarea");
      area.value = await text.catch(() => "");
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.append(area);
      area.select();
      const copied = area.value !== "" && document.execCommand("copy");
      area.remove();
      if (copied) toast.success("Copied as Markdown");
      else
        toast.error("Couldn't copy the page", {
          description:
            failure instanceof Error ? failure.message : String(failure),
        });
    }
  };
  const confirm = async () => {
    try {
      if (character) {
        await castChange(() => deleteCharacter(id));
        toast.success(`${name} left the cast`, {
          description: "Their page and workspace are deleted.",
        });
        onDeleted();
        return;
      }
      const result = await remove({ id, ...(agent ? { agent } : {}) });
      toast.success(`Deleted ${name}`, { description: describeResult(result) });
      onDeleted();
    } catch (failure) {
      toast.error("Couldn't delete the page", {
        description:
          failure instanceof Error ? failure.message : String(failure),
      });
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="outline"
              size={size === "xs" ? "icon-xs" : "icon-sm"}
            />
          }
        >
          <EllipsisIcon />
          <span className="sr-only">{`More for ${name}`}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem onClick={() => void copy()}>
            <CopyIcon />
            Copy Markdown
          </DropdownMenuItem>
          {canDelete ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onClick={() => setOpen(true)}
              >
                <Trash2Icon />
                {character ? "Delete character" : "Delete page"}
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {name}?</AlertDialogTitle>
            <AlertDialogDescription>
              {character
                ? "They leave the cast: they stop, go offstage and come out of the world's setup. Their page and workspace, with their memories and own wiki, are deleted. This can't be undone. Other pages that mention them stay as they are."
                : place
                  ? "It comes off the map. Places inside it move up to the area it was in, connections to it go, and anyone there, or whose home it was, ends up in that area. Characters' own pages about it stay: they remember it. This can't be undone."
                  : "The page is deleted. This can't be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => void confirm()}
            >
              {character ? "Delete character" : "Delete page"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
