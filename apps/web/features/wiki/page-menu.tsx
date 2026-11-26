"use client";

import type { WikiKind } from "@kazusa/client";
import {
  CopyIcon,
  EllipsisIcon,
  MapPinPlusIcon,
  Trash2Icon,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useAccess } from "@/hooks/use-access";
import { fetchWikiSource } from "@/lib/source/wiki/http";
import { IconButton } from "@/ui/button";
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
} from "@/ui/menu";
import { DeletePageDialog } from "./page-dialogs";

/** Puts a page's Markdown on the clipboard, even while it still loads. */
export async function copyMarkdown(
  id: string,
  agent?: string,
  kind?: WikiKind,
) {
  const text = fetchWikiSource(id, agent, kind).then((page) => page.text);
  try {
    // Handed over within the press: browsers only let a page write there then.
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
    toast.error("Couldn't copy the page", {
      description: failure instanceof Error ? failure.message : String(failure),
    });
  }
}

/**
 * More for a page: edit its Markdown, copy it, and delete it after asking. A
 * place takes the map's links to it along.
 */
export function PageMenu({
  id,
  name,
  agent,
  kind,
  place = false,
  onNewInside,
  onDeleted,
}: {
  id: string;
  /** How the question names it: "Gehenna School", "Hina's page on Ako". */
  name: string;
  agent?: string | undefined;
  kind?: WikiKind | undefined;
  place?: boolean;
  /** For a place: make another inside it. */
  onNewInside?: (() => void) | undefined;
  onDeleted: () => void;
}) {
  const { canManage } = useAccess();
  const [asking, setAsking] = useState(false);
  return (
    <>
      <Menu>
        <MenuTrigger
          render={
            <IconButton label={`More for ${name}`} title="More" size="md" />
          }
        >
          <EllipsisIcon aria-hidden />
        </MenuTrigger>
        <MenuContent align="end">
          {canManage && onNewInside ? (
            <MenuItem
              icon={<MapPinPlusIcon aria-hidden />}
              onClick={onNewInside}
            >
              New place inside
            </MenuItem>
          ) : null}
          <MenuItem
            icon={<CopyIcon aria-hidden />}
            onClick={() => void copyMarkdown(id, agent, kind)}
          >
            Copy as Markdown
          </MenuItem>
          {canManage ? (
            <>
              <MenuSeparator />
              <MenuItem
                danger
                icon={<Trash2Icon aria-hidden />}
                onClick={() => setAsking(true)}
              >
                Delete page
              </MenuItem>
            </>
          ) : null}
        </MenuContent>
      </Menu>
      <DeletePageDialog
        page={asking ? { id, name, place } : undefined}
        agent={agent}
        onOpenChange={setAsking}
        onDeleted={() => onDeleted()}
      />
    </>
  );
}
