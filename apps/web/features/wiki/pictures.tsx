"use client";

import { WIKI_MAX_PICTURE_BYTES, WIKI_PICTURE_TYPES } from "@kazusa/client";
import {
  ImagePlusIcon,
  LoaderCircleIcon,
  RefreshCwIcon,
  Trash2Icon,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { toPictureName } from "@/lib/wiki/text";
import { Button, buttonClass } from "@/ui/button";
import { cx } from "@/ui/cx";
import {
  AlertDialog,
  AlertPanel,
  Dialog,
  DialogClose,
  DialogFoot,
  DialogPanel,
} from "@/ui/dialog";
import { TextField } from "@/ui/field";
import { FileDrop, FileDropTrigger as FileInputTrigger } from "@/ui/file-drop";
import { failureText } from "./failure";

const ACCEPT = [...WIKI_PICTURE_TYPES];

/** A quiet checkerboard, so a cut-out figure reads as one whole. */
const CHECKER =
  "bg-ui-ground bg-[conic-gradient(var(--ui-tint)_25%,transparent_0_50%,var(--ui-tint)_0_75%,transparent_0)] bg-[length:16px_16px]";

/**
 * Takes one picture and hands it on; a file too big or of another kind is
 * turned away with why.
 */
function PictureDrop({
  onFile,
  disabled,
  children,
}: {
  onFile: (file: File) => void;
  disabled?: boolean;
  children: (state: { dragging: boolean }) => ReactNode;
}) {
  return (
    <FileDrop
      accept={ACCEPT}
      maxSize={WIKI_MAX_PICTURE_BYTES}
      disabled={disabled}
      onFile={onFile}
      onReject={() =>
        toast.error("That picture can't go in", {
          description: "Use a WebP, PNG, JPEG, GIF or AVIF of at most 20 MB.",
        })
      }
    >
      {children}
    </FileDrop>
  );
}

/** Runs an upload, with the tile busy meanwhile and a failure said aloud. */
function useBusy() {
  const [busy, setBusy] = useState(false);
  const run = (work: () => Promise<void>) => {
    setBusy(true);
    void work()
      .catch((failure: unknown) => toast.error(failureText(failure)))
      .finally(() => setBusy(false));
  };
  return [busy, run] as const;
}

/**
 * One picture in a gallery, whole on a checkerboard. For whoever runs the
 * world, Replace and Remove sit on it and a picture dropped on it replaces it.
 */
export function PictureTile({
  url,
  name,
  what,
  aspect = "aspect-square",
  fit = "whole",
  editable,
  onReplace,
  onRemove,
  children,
}: {
  url: string;
  /** Its name, as the files and the character's tools know it. */
  name: string;
  /** How a question names it: "Hina's happy look". */
  what: string;
  aspect?: string;
  /** `face`: the top of a tall figure, where the mood shows. */
  fit?: "whole" | "face";
  editable: boolean;
  onReplace: (file: File) => Promise<void>;
  onRemove: () => Promise<void>;
  children?: ReactNode;
}) {
  const [busy, run] = useBusy();
  const [asking, setAsking] = useState(false);
  const picture = (dragging: boolean) => (
    <div
      className={cx(
        "group/tile relative overflow-hidden rounded-[1rem] inset-ring inset-ring-ui-line transition-[box-shadow,scale] duration-200",
        CHECKER,
        aspect,
        dragging && "scale-[1.02] inset-ring-2 inset-ring-ui-primary",
      )}
    >
      <img
        src={url}
        alt={what}
        loading="lazy"
        draggable={false}
        className={cx(
          "size-full",
          fit === "face" ? "object-cover object-top" : "object-contain",
        )}
      />
      {busy || dragging ? (
        <div className="absolute inset-0 grid place-items-center bg-[color-mix(in_oklch,var(--ui-surface)_70%,transparent)] text-sm font-bold motion-safe:animate-ui-fade-in">
          {busy ? (
            <LoaderCircleIcon
              aria-hidden
              className="size-5 motion-safe:animate-ui-spin"
            />
          ) : (
            "Drop to replace"
          )}
        </div>
      ) : null}
      {editable ? (
        <div className="absolute inset-e-1.5 top-1.5 flex gap-1 opacity-0 transition-opacity duration-150 group-focus-within/tile:opacity-100 group-hover/tile:opacity-100 max-md:opacity-100">
          <FileInputTrigger
            aria-label={`Replace ${what}`}
            className={buttonClass({
              tone: "soft",
              size: "sm",
              className: "w-7.5 bg-ui-surface px-0 shadow-ui",
            })}
          >
            <RefreshCwIcon aria-hidden />
          </FileInputTrigger>
          <button
            type="button"
            aria-label={`Remove ${what}`}
            onClick={() => setAsking(true)}
            className={buttonClass({
              tone: "soft",
              size: "sm",
              className: "w-7.5 bg-ui-surface px-0 text-ui-danger shadow-ui",
            })}
          >
            <Trash2Icon aria-hidden />
          </button>
        </div>
      ) : null}
    </div>
  );
  return (
    <figure className="flex min-w-0 flex-col gap-1.5">
      {editable ? (
        <PictureDrop
          disabled={busy}
          onFile={(file) => run(() => onReplace(file))}
        >
          {({ dragging }) => picture(dragging)}
        </PictureDrop>
      ) : (
        picture(false)
      )}
      <figcaption className="truncate text-[0.8125rem] font-bold capitalize">
        {name}
      </figcaption>
      {children}
      <AlertDialog open={asking} onOpenChange={setAsking}>
        <AlertPanel
          danger
          title={`Remove ${what}?`}
          description="The picture is deleted. This can't be undone."
          onConfirm={() => run(onRemove)}
        />
      </AlertDialog>
    </figure>
  );
}

/** An empty slot that takes a picture under a name it already has. */
export function DropTile({
  label,
  aspect = "aspect-square",
  onFile,
}: {
  label: string;
  aspect?: string;
  onFile: (file: File) => Promise<void>;
}) {
  const [busy, run] = useBusy();
  return (
    <PictureDrop disabled={busy} onFile={(file) => run(() => onFile(file))}>
      {({ dragging }) => (
        <div className="flex flex-col gap-1.5">
          <FileInputTrigger
            className={cx(
              "flex flex-col items-center justify-center gap-1.5 rounded-[1rem] border-2 border-dashed border-ui-line text-[0.8125rem] font-bold text-ui-soft transition-[border-color,color,background-color,scale] duration-200 hover:border-ui-primary hover:text-ui-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ui-primary",
              aspect,
              dragging &&
                "scale-[1.02] border-ui-primary bg-ui-tint text-ui-primary",
            )}
          >
            {busy ? (
              <LoaderCircleIcon
                aria-hidden
                className="size-5 motion-safe:animate-ui-spin"
              />
            ) : (
              <ImagePlusIcon aria-hidden className="size-5" />
            )}
            {dragging ? "Drop it here" : label}
          </FileInputTrigger>
          <span
            aria-hidden
            className="text-[0.8125rem] font-bold text-transparent"
          >
            .
          </span>
        </div>
      )}
    </PictureDrop>
  );
}

/** The tile at a gallery's end that adds one more, after asking its name. */
export function AddTile({
  label,
  aspect = "aspect-square",
  onClick,
}: {
  label: string;
  aspect?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "flex flex-col items-center justify-center gap-1.5 rounded-[1rem] border-2 border-dashed border-ui-line text-[0.8125rem] font-bold text-ui-soft transition-[border-color,color] duration-200 hover:border-ui-primary hover:text-ui-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ui-primary",
        aspect,
      )}
    >
      <ImagePlusIcon aria-hidden className="size-5" />
      {label}
    </button>
  );
}

/**
 * Adds a picture under a mood's name, in one outfit: the file is named
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
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? (
        <AddPictureForm
          title={title}
          outfit={outfit}
          taken={taken}
          onAdd={onAdd}
          onDone={() => onOpenChange(false)}
        />
      ) : null}
    </Dialog>
  );
}

function AddPictureForm({
  title,
  outfit,
  taken,
  onAdd,
  onDone,
}: {
  title: string;
  outfit: string | undefined;
  taken: ReadonlySet<string>;
  onAdd: (name: string, file: File) => Promise<void>;
  onDone: () => void;
}) {
  const [mood, setMood] = useState("");
  const [file, setFile] = useState<File>();
  const [busy, setBusy] = useState(false);
  const word = toPictureName(mood);
  const name = word ? (outfit ? `${outfit}-${word}` : word) : "";
  const clash = taken.has(name);
  const preview = useMemo(
    () => (file ? URL.createObjectURL(file) : undefined),
    [file],
  );
  useEffect(
    () => () => (preview ? URL.revokeObjectURL(preview) : undefined),
    [preview],
  );
  return (
    <DialogPanel
      title={title}
      description={
        outfit ? `In the ${outfit} outfit.` : "In their usual clothes."
      }
    >
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!file || !name || clash) return;
          setBusy(true);
          void onAdd(name, file)
            .then(onDone)
            .catch((failure: unknown) => toast.error(failureText(failure)))
            .finally(() => setBusy(false));
        }}
      >
        <TextField
          label="Mood"
          value={mood}
          autoFocus
          autoComplete="off"
          placeholder="happy"
          error={
            clash
              ? `${name} is there already: replace it from its own tile.`
              : undefined
          }
          description={name ? `Saved as ${name}` : undefined}
          onChange={(event) => setMood(event.target.value)}
        />
        <PictureDrop onFile={setFile}>
          {({ dragging }) => (
            <FileInputTrigger
              className={cx(
                "grid aspect-[4/3] place-items-center overflow-hidden rounded-[1rem] border-2 border-dashed border-ui-line text-sm font-bold text-ui-soft transition-colors hover:border-ui-primary hover:text-ui-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ui-primary",
                CHECKER,
                dragging && "border-ui-primary text-ui-primary",
              )}
            >
              {preview ? (
                <img
                  src={preview}
                  alt=""
                  className="size-full object-contain"
                />
              ) : (
                <span className="flex flex-col items-center gap-1.5">
                  <ImagePlusIcon aria-hidden className="size-6" />
                  Choose or drop a picture
                </span>
              )}
            </FileInputTrigger>
          )}
        </PictureDrop>
        <DialogFoot>
          <DialogClose render={<Button tone="ghost" disabled={busy} />}>
            Cancel
          </DialogClose>
          <Button
            type="submit"
            tone="primary"
            pending={busy}
            disabled={!file || !name || clash}
          >
            Confirm
          </Button>
        </DialogFoot>
      </form>
    </DialogPanel>
  );
}
