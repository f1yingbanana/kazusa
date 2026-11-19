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
  { value: "concept", label: "Concept" },
  { value: "person", label: "Person" },
];

/**
 * An id from a name, as the plugin makes one: a page's id is its file name.
 * Characters' ids take hyphens (`airi-kurimura`), other pages underscores.
 */
export const slug = (name: string, separator: "_" | "-" = "_"): string =>
  name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, separator)
    .replace(/^[-_]+|[-_]+$/g, "");

/**
 * The id a name makes, shown under it, and changeable: an id is for good, so it
 * is said once here, and never clashes with a page already there.
 */
export function IdLine({
  id,
  typed,
  onType,
  error,
  inputId,
}: {
  id: string;
  /** What the user typed, once they chose to; else the id follows the name. */
  typed: string | undefined;
  onType: (id: string | undefined) => void;
  error: string | undefined;
  inputId: string;
}) {
  if (typed === undefined)
    return (
      <div className="flex min-h-5 items-center gap-1.5 text-xs text-muted-foreground">
        {id ? (
          <>
            <span>Id</span>
            <code className="rounded bg-muted px-1 font-mono">{id}</code>
            <Button
              type="button"
              variant="link"
              size="xs"
              className="h-auto px-0 text-xs"
              onClick={() => onType(id)}
            >
              Change
            </Button>
          </>
        ) : (
          <span>The id comes from the name.</span>
        )}
        {error ? <span className="text-destructive">{error}</span> : null}
      </div>
    );
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={inputId}>Id</FieldLabel>
      <Input
        id={inputId}
        value={typed}
        autoFocus
        className="font-mono"
        aria-invalid={error ? true : undefined}
        onChange={(event) => onType(event.target.value)}
      />
      {error ? (
        <FieldError>{error}</FieldError>
      ) : (
        <FieldDescription>
          Pages link to it, and it stays once the page is made.
        </FieldDescription>
      )}
    </Field>
  );
}

/** Names a page, then opens it in the editor; nothing is written until saved. */
export function NewPageDialog({
  open,
  onOpenChange,
  whose,
  personal = false,
  existing,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** "the World Wiki" or "Airi's wiki". */
  whose: string;
  /** A character's own wiki: pages on people and diary days too. */
  personal?: boolean;
  existing: ReadonlySet<string>;
  onCreate: (page: { id: string; kind: WikiKind; name: string }) => void;
}) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<WikiKind>("concept");
  const [typedId, setTypedId] = useState<string | undefined>();
  const id = typedId ?? slug(name, kind === "person" ? "-" : "_");
  const valid = WikiSavePayloadSchema.shape.id.safeParse(id);
  const error = !id
    ? undefined
    : existing.has(id)
      ? "Another page has this id."
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
            <DialogDescription>In {whose}.</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="new-page-name">Name</FieldLabel>
              <Input
                id="new-page-name"
                value={name}
                autoFocus
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
            {personal ? (
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
              </Field>
            ) : null}
            <IdLine
              id={id}
              typed={typedId}
              onType={setTypedId}
              error={error}
              inputId="new-page-id"
            />
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
