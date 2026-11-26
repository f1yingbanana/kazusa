"use client";

import type { WikiEditResult, WikiListItem } from "@kazusa/client";
import { useState } from "react";
import { toast } from "@/ui/toast";
import { useDeleteWikiPage, useSaveWikiPage } from "@/hooks/use-wiki";
import { fetchWikiSource } from "@/lib/source/wiki/http";
import { idProblem, pageId } from "@/lib/wiki/page-id";
import { duplicateSource } from "@/lib/wiki/text";
import { Button } from "@/ui/button";
import {
  AlertDialog,
  AlertPanel,
  Dialog,
  DialogClose,
  DialogFoot,
  DialogPanel,
} from "@/ui/dialog";
import { TextField } from "@/ui/field";
import { failureText } from "./failure";
import { useRefreshWiki } from "./refresh";

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

/** Asks, then deletes a page for good; a place takes its map links along. */
export function DeletePageDialog({
  page,
  agent,
  onOpenChange,
  onDeleted,
}: {
  /** The page to delete; none while closed. */
  page: Pick<WikiListItem, "id" | "name" | "place"> | undefined;
  agent?: string | undefined;
  onOpenChange: (open: boolean) => void;
  onDeleted: (id: string) => void;
}) {
  const remove = useDeleteWikiPage();
  return (
    <AlertDialog open={page !== undefined} onOpenChange={onOpenChange}>
      {page ? (
        <AlertPanel
          danger
          title={`Delete ${page.name}?`}
          description={
            page.place && !agent
              ? "Places inside move up to its area. This can't be undone."
              : "This can't be undone."
          }
          agentConfirm={`Deletes ${page.name} for good`}
          onConfirm={() =>
            void remove({ id: page.id, ...(agent ? { agent } : {}) })
              .then((result) => {
                toast.success(`Deleted ${page.name}`, {
                  description: describeResult(result),
                });
                onDeleted(page.id);
              })
              .catch((failure: unknown) =>
                toast.error("Couldn't delete it", {
                  description: failureText(failure),
                }),
              )
          }
        />
      ) : null}
    </AlertDialog>
  );
}

/**
 * Makes a copy of a page under a new name and id: all its words, its place on
 * the map, who knows it; only its other names stay behind.
 */
export function DuplicatePageDialog({
  page,
  agent,
  existing,
  onOpenChange,
  onDuplicated,
}: {
  page: Pick<WikiListItem, "id" | "name" | "kind"> | undefined;
  agent?: string | undefined;
  existing: ReadonlySet<string>;
  onOpenChange: (open: boolean) => void;
  onDuplicated: (id: string) => void;
}) {
  return (
    <Dialog open={page !== undefined} onOpenChange={onOpenChange}>
      {page ? (
        <DuplicateForm
          key={page.id}
          page={page}
          agent={agent}
          existing={existing}
          onDone={(id) => {
            onOpenChange(false);
            if (id) onDuplicated(id);
          }}
        />
      ) : null}
    </Dialog>
  );
}

function DuplicateForm({
  page,
  agent,
  existing,
  onDone,
}: {
  page: Pick<WikiListItem, "id" | "name" | "kind">;
  agent: string | undefined;
  existing: ReadonlySet<string>;
  onDone: (id?: string) => void;
}) {
  const save = useSaveWikiPage();
  const refresh = useRefreshWiki();
  const [name, setName] = useState(`${page.name} (copy)`);
  const [typedId, setTypedId] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const named = name.trim();
  const auto = named
    ? pageId(named, existing, {
        separator: page.kind === "person" ? "-" : "_",
        fallback: "page",
      })
    : "";
  const id = typedId ?? auto;
  const problem = named || typedId ? idProblem(id, existing) : undefined;

  const submit = async () => {
    if (busy || !named || problem) return;
    setBusy(true);
    try {
      const source = await fetchWikiSource(page.id, agent);
      await save({
        id,
        kind: page.kind,
        base: null,
        text: duplicateSource(source.text, { name: named, id }),
        ...(agent ? { agent } : {}),
      });
      await refresh();
      toast.success(`Made ${named}`);
      onDone(id);
    } catch (failure) {
      toast.error("Couldn't duplicate it", {
        description: failureText(failure),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogPanel title={`Duplicate ${page.name}`}>
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <TextField
          label="Name"
          value={name}
          autoFocus
          autoComplete="off"
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => setName(event.target.value)}
        />
        <TextField
          label="Id"
          mono
          value={id}
          disabled={typedId === undefined}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          onChange={(event) => setTypedId(event.target.value.toLowerCase())}
          error={problem}
          description="Links use it. It can't change later."
          action={
            <Button
              type="button"
              tone="link"
              size="sm"
              className="text-xs"
              onClick={() =>
                setTypedId(typedId === undefined ? auto : undefined)
              }
            >
              {typedId === undefined ? "Customize" : "Use the name's"}
            </Button>
          }
        />
        <DialogFoot>
          <DialogClose render={<Button tone="ghost" disabled={busy} />}>
            Cancel
          </DialogClose>
          <Button
            type="submit"
            tone="primary"
            pending={busy}
            disabled={!named || Boolean(problem)}
          >
            Duplicate
          </Button>
        </DialogFoot>
      </form>
    </DialogPanel>
  );
}
