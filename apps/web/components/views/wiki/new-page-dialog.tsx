"use client";

import { useState } from "react";
import { WikiSavePayloadSchema, type WikiKind } from "@kazusa/client";
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
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const KINDS: ReadonlyArray<{
  readonly value: WikiKind;
  readonly label: string;
}> = [
  { value: "person", label: "Person" },
  { value: "place", label: "Place" },
  { value: "concept", label: "Thing" },
  { value: "day", label: "Diary day" },
];

/** Same as the plugin's: a page's id is its file name. */
const slug = (name: string): string =>
  name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "");

/** Names a page, then opens it in the editor; nothing is written until saved. */
export function NewPageDialog({
  open,
  onOpenChange,
  whose,
  existing,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** "the World Wiki" or "Airi's wiki". */
  whose: string;
  existing: ReadonlySet<string>;
  onCreate: (page: { id: string; kind: WikiKind; name: string }) => void;
}) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<WikiKind>("concept");
  const [typedId, setTypedId] = useState<string | undefined>();
  const id = typedId ?? slug(name);
  const valid = WikiSavePayloadSchema.shape.id.safeParse(id);
  const error = !id
    ? undefined
    : existing.has(id)
      ? "A page with this file name already exists."
      : valid.success
        ? undefined
        : "Use letters, digits, _ or -, starting with a letter or digit.";

  const reset = () => {
    setName("");
    setKind("concept");
    setTypedId(undefined);
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
            if (!id || error) return;
            onCreate({ id, kind, name: name.trim() || id });
            onOpenChange(false);
            reset();
          }}
        >
          <DialogHeader>
            <DialogTitle>New page</DialogTitle>
            <DialogDescription>
              In {whose}. You write it next; nothing is saved until you do.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="new-page-name">Name</FieldLabel>
              <Input
                id="new-page-name"
                value={name}
                autoFocus
                placeholder={kind === "day" ? "2026-11-04" : undefined}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="new-page-kind">Kind</FieldLabel>
              <Select
                items={KINDS}
                value={kind}
                onValueChange={(value) => value && setKind(value)}
              >
                <SelectTrigger id="new-page-kind" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KINDS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldDescription>
                {kind === "person"
                  ? "A character's page uses their id as its file name."
                  : kind === "day"
                    ? "Name a diary day by its date."
                    : "Sets the folder it goes in."}
              </FieldDescription>
            </Field>
            <Field data-invalid={error ? true : undefined}>
              <FieldLabel htmlFor="new-page-id">File name</FieldLabel>
              <Input
                id="new-page-id"
                value={id}
                aria-invalid={error ? true : undefined}
                onChange={(event) => setTypedId(event.target.value)}
              />
              {error ? <FieldError>{error}</FieldError> : null}
            </Field>
          </FieldGroup>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Cancel
            </DialogClose>
            <Button type="submit" disabled={!id || Boolean(error)}>
              Write page
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
