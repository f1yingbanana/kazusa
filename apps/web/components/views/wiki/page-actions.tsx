"use client";

import { useState } from "react";
import { PenLineIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { WikiRenamePayloadSchema, type WikiEditResult } from "@kazusa/client";
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
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useDeleteWikiPage, useRenameWikiPage } from "@/hooks/use-wiki";

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

/** Gives a World Wiki place a new id; everything naming it follows. */
export function RenamePlaceButton({
  id,
  name,
  onRenamed,
}: {
  id: string;
  name: string;
  onRenamed: (id: string) => void;
}) {
  const rename = useRenameWikiPage();
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState(id);
  const [busy, setBusy] = useState(false);
  const valid = WikiRenamePayloadSchema.shape.to.safeParse(to);
  const error =
    to === id || valid.success
      ? undefined
      : "Use lowercase letters, digits, _ or -, starting with a letter or digit.";

  const submit = async () => {
    if (busy || to === id || error) return;
    setBusy(true);
    try {
      const result = await rename({ id, to });
      toast.success(`Renamed to ${result.id}`, {
        description: describeResult(result),
      });
      setOpen(false);
      onRenamed(result.id);
    } catch (failure) {
      toast.error("Couldn't rename the place", {
        description:
          failure instanceof Error ? failure.message : String(failure),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        variant="ghost"
        size="xs"
        onClick={() => {
          setTo(id);
          setOpen(true);
        }}
        aria-label={`Rename ${name}`}
      >
        <PenLineIcon />
        Rename
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <DialogHeader>
              <DialogTitle>Rename {name}</DialogTitle>
              <DialogDescription>
                Its page, every page and character card that names it, and
                anyone there or on their way follow the new id. To change only
                what it&apos;s called, edit its name instead.
              </DialogDescription>
            </DialogHeader>
            <Field data-invalid={error ? true : undefined}>
              <FieldLabel htmlFor="rename-place-id">New id</FieldLabel>
              <Input
                id="rename-place-id"
                value={to}
                autoFocus
                className="font-mono"
                aria-invalid={error ? true : undefined}
                onChange={(event) => setTo(event.target.value)}
              />
              {error ? <FieldError>{error}</FieldError> : null}
            </Field>
            <DialogFooter>
              <DialogClose render={<Button variant="outline" />}>
                Cancel
              </DialogClose>
              <Button
                type="submit"
                disabled={busy || to === id || Boolean(error)}
              >
                {busy ? "Renaming…" : "Rename"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Removes a page, after asking; a place takes the map's links to it along. */
export function DeletePageButton({
  id,
  name,
  agent,
  place,
  onDeleted,
}: {
  id: string;
  name: string;
  /** Their wiki; absent: the World Wiki. */
  agent?: string;
  /** A World Wiki place, whose removal changes the map. */
  place: boolean;
  onDeleted: () => void;
}) {
  const remove = useDeleteWikiPage();
  const [open, setOpen] = useState(false);

  const confirm = async () => {
    try {
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
      <Button
        variant="ghost"
        size="xs"
        onClick={() => setOpen(true)}
        aria-label={`Delete ${name}`}
      >
        <Trash2Icon />
        Delete
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {name}?</AlertDialogTitle>
            <AlertDialogDescription>
              {place
                ? "It comes off the map. Places inside it move up to the area it was in, connections to it go, and anyone there, or whose home it was, ends up in that area. Characters' own pages about it stay: they remember it."
                : "The page is moved to the world's trash folder, where it can be put back by hand."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => void confirm()}
            >
              Delete page
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
