"use client";

import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import type { WikiPicture } from "@kazusa/client";
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
import { AddTile, failureText, toPictureName } from "./parts";

/** Pictures grouped by what is worn: the usual clothes first, then each outfit. */
export function byOutfit<P extends WikiPicture>(
  pictures: readonly P[],
  outfits: Readonly<Record<string, string>>,
): { readonly outfit: string | undefined; readonly pictures: P[] }[] {
  const words = Object.keys(outfits).sort();
  return [undefined, ...words].map((outfit) => ({
    outfit,
    pictures: pictures.filter((picture) => picture.outfit === outfit),
  }));
}

/**
 * Adds a picture under a mood name, in one outfit: the file is named
 * `<outfit>-<mood>`, as the character's tools know it.
 */
export function AddPictureDialog({
  open,
  onOpenChange,
  title,
  outfit,
  taken,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  outfit: string | undefined;
  taken: ReadonlySet<string>;
  onAdd: (name: string, file: File) => Promise<void>;
}) {
  const [mood, setMood] = useState("");
  const [file, setFile] = useState<File>();
  const [busy, setBusy] = useState(false);
  const word = toPictureName(mood);
  const name = word ? (outfit ? `${outfit}-${word}` : word) : "";
  const clash = taken.has(name);
  /** Closing for any reason starts the next opening afresh. */
  const close = () => {
    setMood("");
    setFile(undefined);
    onOpenChange(false);
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {outfit ? `In the ${outfit} outfit.` : "In their usual clothes."}
          </DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor="wiki-add-mood">Mood</FieldLabel>
          <Input
            id="wiki-add-mood"
            value={mood}
            autoFocus
            placeholder="happy"
            onChange={(event) => setMood(event.target.value)}
          />
          {clash ? (
            <FieldDescription>
              {name} is already there: replace it from its own tile.
            </FieldDescription>
          ) : null}
        </Field>
        <Field>
          <FieldLabel htmlFor="wiki-add-file">Picture</FieldLabel>
          <Input
            id="wiki-add-file"
            type="file"
            accept="image/webp,image/png,image/jpeg,image/gif,image/avif"
            onChange={(event) => setFile(event.target.files?.[0])}
          />
        </Field>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>
            Cancel
          </DialogClose>
          <Button
            disabled={!name || clash || !file || busy}
            onClick={() => {
              if (!file) return;
              setBusy(true);
              void onAdd(name, file)
                .then(close)
                .catch((failure: unknown) => toast.error(failureText(failure)))
                .finally(() => setBusy(false));
            }}
          >
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** One outfit's row of pictures, with the tile that adds one. */
export function OutfitGroup({
  title,
  description,
  addLabel,
  addAspect,
  onAdd,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  addLabel: string;
  /** The add tile's shape, the same as the pictures beside it. */
  addAspect?: string;
  onAdd: () => void;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold">{title}</h3>
        {description}
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-3">
        {children}
        <AddTile
          label={addLabel}
          onClick={onAdd}
          {...(addAspect ? { aspect: addAspect } : {})}
        />
      </div>
    </section>
  );
}
