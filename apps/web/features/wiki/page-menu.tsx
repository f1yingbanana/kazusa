"use client";

import type { WikiEditResult, WikiKind } from "@kazusa/client";
import { CopyIcon, EllipsisIcon, FileCodeIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useAccess } from "@/hooks/use-access";
import { useDeleteWikiPage } from "@/hooks/use-wiki";
import { fetchWikiSource } from "@/lib/source/wiki/http";
import { IconButton } from "@/ui/button";
import { AlertDialog, AlertPanel } from "@/ui/dialog";
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
} from "@/ui/menu";

/** "Moved Airi to School · updated 3 other pages", or nothing worth saying. */
export function describeResult(result: WikiEditResult): string | undefined {
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

/** Puts a page's Markdown on the clipboard, even while it still loads. */
async function copyMarkdown(id: string, agent?: string, kind?: WikiKind) {
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
  onRaw,
  onDeleted,
}: {
  id: string;
  /** How the question names it: "Gehenna School", "Hina's page on Ako". */
  name: string;
  agent?: string | undefined;
  kind?: WikiKind | undefined;
  place?: boolean;
  onRaw?: (() => void) | undefined;
  onDeleted: () => void;
}) {
  const { canManage } = useAccess();
  const remove = useDeleteWikiPage();
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
          {canManage && onRaw ? (
            <MenuItem icon={<FileCodeIcon aria-hidden />} onClick={onRaw}>
              Edit as Markdown
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
      <AlertDialog open={asking} onOpenChange={setAsking}>
        <AlertPanel
          danger
          title={`Delete ${name}?`}
          description={
            place
              ? "It goes from the map too: places inside it move up to its area, and anyone there with them. This can't be undone."
              : "Pages that mention it stay as they are. This can't be undone."
          }
          agentConfirm={`Deletes ${name} for good`}
          onConfirm={() =>
            void remove({ id, ...(agent ? { agent } : {}) })
              .then((result) => {
                toast.success(`Deleted ${name}`, {
                  description: describeResult(result),
                });
                onDeleted();
              })
              .catch((failure: unknown) =>
                toast.error("Couldn't delete the page", {
                  description:
                    failure instanceof Error
                      ? failure.message
                      : String(failure),
                }),
              )
          }
        />
      </AlertDialog>
    </>
  );
}
