"use client";

import { useState } from "react";
import {
  ArrowLeftRightIcon,
  CopyIcon,
  EllipsisIcon,
  Trash2Icon,
} from "lucide-react";
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
import { useAccess } from "@/hooks/use-access";
import { useCastChange } from "@/hooks/use-characters";
import { useSources } from "@/lib/source/provider";
import { openPlayDialog } from "@/lib/state/ui-store";
import { useDeleteWikiPage, useWikiSource } from "@/hooks/use-wiki";
import { deleteCharacter } from "@/lib/source/characters/http";
import { fetchWikiSource } from "@/lib/source/wiki/http";

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
  const { canPlay } = useAccess();
  const { player, watching } = useSources();
  // A simulated character, and not already the one played.
  const playable = character && canPlay && (watching || player.id !== id);
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
        <DropdownMenuContent align="end" className="w-auto max-w-64">
          {playable ? (
            <DropdownMenuItem onClick={() => openPlayDialog(id)}>
              <ArrowLeftRightIcon />
              Play as character
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onClick={() => void copy()}>
            <CopyIcon />
            Copy markdown
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
                ? "Their page and workspace, with their memories and own wiki, are deleted. Other pages that mention them stay as they are. This can't be undone."
                : place
                  ? "It is deleted from the map. Places inside it move up. Characters that still mention it stay as they are. This can't be undone."
                  : "The page is deleted. Other pages that mention them stay as they are. This can't be undone."}
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
