"use client";

import { useRef, useState, type ReactNode } from "react";
import { ImagePlusIcon, RefreshCwIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { WIKI_PICTURE_TYPES, type EditedText } from "@kazusa/client";
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
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { KazusaApiError } from "@/lib/source/http";
import { cn } from "@/lib/utils";

/** What went wrong, in the Gateway's words when it gave any. */
export function failureText(failure: unknown): string {
  if (failure instanceof KazusaApiError)
    return failure.message.replace(/^Request failed \(\d+\): /, "");
  return failure instanceof Error ? failure.message : String(failure);
}

/** A save made over a version someone else changed meanwhile. */
export const isConflict = (failure: unknown): boolean =>
  failure instanceof KazusaApiError && failure.status === 409;

/**
 * The strip under something edited: nothing while it is as saved, then what
 * Save and Revert would do. Stays in view at the bottom of a long page.
 */
export function SaveBar({
  dirty,
  saving,
  onSave,
  onRevert,
  conflict,
  onReload,
}: {
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
  onRevert: () => void;
  /** The file changed under the edit: saving would lose that. */
  conflict?: boolean;
  onReload?: () => void;
}) {
  if (!dirty && !conflict) return null;
  return (
    <div
      className={cn(
        "sticky bottom-3 z-10 flex items-center gap-2 rounded-lg border bg-popover/95 px-3 py-2 shadow-md backdrop-blur",
        conflict && "border-destructive/50",
      )}
      role="status"
    >
      <p className="flex-1 text-sm text-pretty">
        {conflict
          ? "This changed since you opened it. Copy your words, then load the new version."
          : "Unsaved changes"}
      </p>
      {conflict ? (
        <Button size="sm" variant="outline" onClick={onReload}>
          Load the new version
        </Button>
      ) : (
        <>
          <Button
            size="sm"
            variant="ghost"
            disabled={saving}
            onClick={onRevert}
          >
            Revert
          </Button>
          <Button size="sm" disabled={saving} onClick={onSave}>
            {saving ? <Spinner /> : null}
            Save
          </Button>
        </>
      )}
    </div>
  );
}

/**
 * A whole Markdown file edited as one page of text, saved only over the version
 * it was opened at.
 */
export function DocumentField({
  id,
  label,
  description,
  value,
  disabled,
  onSave,
  onReload,
  rows = 12,
}: {
  id: string;
  label: string;
  description: ReactNode;
  value: EditedText;
  disabled?: boolean;
  onSave: (text: string, base: string | null) => Promise<EditedText>;
  onReload: () => Promise<unknown>;
  rows?: number;
}) {
  const [draft, setDraft] = useState<{ base: string | null; text: string }>();
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  // A draft is over the version it was started on; none means as saved.
  const text = draft?.text ?? value.text;
  const dirty = draft !== undefined && draft.text !== value.text;

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      await onSave(draft.text, draft.base);
      setDraft(undefined);
      toast.success(`Saved ${label.toLowerCase()}.`);
    } catch (failure) {
      if (isConflict(failure)) setConflict(true);
      else toast.error(failureText(failure));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
      </label>
      <p className="max-w-prose text-sm text-pretty text-muted-foreground">
        {description}
      </p>
      <Textarea
        id={id}
        value={text}
        rows={rows}
        disabled={disabled}
        spellCheck
        onChange={(event) =>
          setDraft({
            base: draft?.base ?? value.hash,
            text: event.target.value,
          })
        }
        className="field-sizing-content min-h-48 max-w-3xl font-sans text-sm leading-relaxed"
      />
      <SaveBar
        dirty={dirty}
        saving={saving}
        conflict={conflict}
        onSave={() => void save()}
        onRevert={() => setDraft(undefined)}
        onReload={() => {
          setConflict(false);
          setDraft(undefined);
          void onReload();
        }}
      />
    </section>
  );
}

/** A hidden file picker for pictures, opened by whatever calls `pick`. */
export function usePicturePicker(
  onPicked: (files: File[]) => void,
  multiple = false,
): { readonly pick: () => void; readonly input: ReactNode } {
  const ref = useRef<HTMLInputElement>(null);
  return {
    pick: () => ref.current?.click(),
    input: (
      <input
        ref={ref}
        type="file"
        hidden
        multiple={multiple}
        accept={WIKI_PICTURE_TYPES.join(",")}
        onChange={(event) => {
          const files = [...(event.target.files ?? [])];
          event.target.value = "";
          if (files.length) onPicked(files);
        }}
      />
    ),
  };
}

/** Asks before something is deleted. */
export function RemoveButton({
  what,
  onRemove,
  disabled,
  label = "Remove",
  size = "icon-xs",
}: {
  /** "Yuuka's happy look", shown in the question. */
  what: string;
  onRemove: () => Promise<void>;
  disabled?: boolean;
  label?: string;
  size?: "icon-xs" | "sm";
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Button
        variant={size === "sm" ? "outline" : "secondary"}
        size={size}
        disabled={disabled}
        aria-label={`${label} ${what}`}
        onClick={() => setOpen(true)}
      >
        <Trash2Icon />
        {size === "sm" ? label : null}
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {what}?</AlertDialogTitle>
            <AlertDialogDescription>
              This can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void onRemove()
                  .then(() => setOpen(false))
                  .catch((failure: unknown) =>
                    toast.error(failureText(failure)),
                  )
                  .finally(() => setBusy(false));
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/**
 * One picture in a gallery, shown whole on a quiet checkerboard so a cut-out
 * figure reads as one. Replace and Remove sit on it; what it is goes under.
 */
export function PictureTile({
  url,
  name,
  what,
  aspect = "aspect-[3/4]",
  fit = "whole",
  disabled,
  onReplace,
  onRemove,
  children,
}: {
  url: string;
  /** Its name, as the file and the character's tools know it. */
  name: string;
  /** How the remove question names it. */
  what: string;
  aspect?: string;
  /** `face`: the top of a tall figure, where the mood shows. */
  fit?: "whole" | "face";
  disabled?: boolean;
  onReplace: (file: File) => Promise<void>;
  onRemove: () => Promise<void>;
  children?: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const { pick, input } = usePicturePicker(([file]) => {
    if (!file) return;
    setBusy(true);
    void onReplace(file)
      .catch((failure: unknown) => toast.error(failureText(failure)))
      .finally(() => setBusy(false));
  });
  return (
    <figure className="group/tile flex min-w-0 flex-col gap-1.5">
      <div
        className={cn(
          "relative overflow-hidden rounded-md border wiki-checker",
          aspect,
        )}
      >
        <img
          src={url}
          alt={what}
          loading="lazy"
          draggable={false}
          className={cn(
            "size-full",
            fit === "face" ? "object-cover object-top" : "object-contain",
          )}
        />
        {busy ? (
          <div className="absolute inset-0 grid place-items-center bg-background/60">
            <Spinner />
          </div>
        ) : null}
        <div className="absolute top-1.5 right-1.5 flex gap-1 opacity-0 transition-opacity group-focus-within/tile:opacity-100 group-hover/tile:opacity-100">
          <Button
            variant="secondary"
            size="icon-xs"
            disabled={disabled || busy}
            aria-label={`Replace ${what}`}
            onClick={pick}
          >
            <RefreshCwIcon />
          </Button>
          <RemoveButton
            what={what}
            disabled={disabled || busy}
            onRemove={onRemove}
          />
        </div>
        {input}
      </div>
      <figcaption className="truncate font-mono text-xs text-muted-foreground">
        {name}
      </figcaption>
      {children}
    </figure>
  );
}

/** The tile at the end of a gallery that adds to it. */
export function AddTile({
  label,
  aspect = "aspect-[3/4]",
  disabled,
  onClick,
}: {
  label: string;
  aspect?: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-md border border-dashed text-sm text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50",
        aspect,
      )}
    >
      <ImagePlusIcon className="size-5" />
      {label}
    </button>
  );
}

/** `Happy face` → `happy-face`: a name the files and tools take. */
export function toPictureName(words: string): string {
  return words
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}
