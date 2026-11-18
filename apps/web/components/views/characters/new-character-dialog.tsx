"use client";

import { useState } from "react";
import { toast } from "sonner";
import { CharacterIdSchema } from "@kazusa/client";
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
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { IdLine, slug } from "@/components/views/wiki/new-page-dialog";
import { useCastChange } from "@/hooks/use-characters";
import { createCharacter } from "@/lib/source/characters/http";

/**
 * Names a new character and makes them: their World Wiki page, their workspace
 * and a place in the cast, offstage until someone brings them on.
 */
export function NewCharacterDialog({
  open,
  onOpenChange,
  existing,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Ids already taken: every page and every character. */
  existing: ReadonlySet<string>;
  onCreated: (id: string) => void;
}) {
  const change = useCastChange();
  const [name, setName] = useState("");
  const [typedId, setTypedId] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const id = typedId ?? slug(name, "-");
  const error = !id
    ? undefined
    : existing.has(id)
      ? "Another page or character has this id."
      : CharacterIdSchema.safeParse(id).success
        ? undefined
        : "Use lowercase letters, digits and -.";

  const reset = () => {
    setName("");
    setTypedId(undefined);
  };
  const submit = async () => {
    if (busy || !id || error || !name.trim()) return;
    setBusy(true);
    try {
      await change(() => createCharacter({ id, name: name.trim() }));
      toast.success(`${name.trim()} joined the cast, offstage`, {
        description: "Bring them onstage when they're ready to start thinking.",
      });
      onOpenChange(false);
      reset();
      onCreated(id);
    } catch (failure) {
      toast.error("Couldn't make the character", {
        description:
          failure instanceof Error ? failure.message : String(failure),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) reset();
      }}
    >
      <DialogContent>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>New character</DialogTitle>
            <DialogDescription>
              They join the cast offstage, so they cost nothing until you bring
              them on.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="new-character-name">Name</FieldLabel>
              <Input
                id="new-character-name"
                value={name}
                autoFocus
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
            <IdLine
              id={id}
              typed={typedId}
              onType={setTypedId}
              error={error}
              inputId="new-character-id"
            />
          </FieldGroup>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Cancel
            </DialogClose>
            <Button
              type="submit"
              disabled={busy || !id || !name.trim() || Boolean(error)}
            >
              {busy ? "Making…" : "Make character"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
