"use client";

import { useState } from "react";
import { ImagePlusIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ResponsiveDialogContent } from "@/components/ui/responsive-dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAccess } from "@/hooks/use-access";
import { usePlaces } from "@/hooks/use-location";
import { useWikiBackdrops, useWikiForm } from "@/hooks/use-wiki-editor";
import {
  removePicture,
  saveWikiForm,
  uploadPicture,
} from "@/lib/source/wiki/editor";
import { WikiLink } from "./page-link";
import {
  AddTile,
  PictureTile,
  failureText,
  toPictureName,
  usePicturePicker,
} from "./parts";

/** An empty slot: choosing a picture puts it in under the slot's name. */
function EmptySlot({
  label,
  onFile,
}: {
  label: string;
  onFile: (file: File) => Promise<void>;
}) {
  const { pick, input } = usePicturePicker(([file]) => {
    if (file)
      void onFile(file).catch((failure: unknown) =>
        toast.error(failureText(failure)),
      );
  });
  return (
    <div className="flex flex-col gap-1.5">
      <AddTile label={label} aspect="aspect-video" onClick={pick} />
      {input}
    </div>
  );
}

/**
 * One backdrop set: a picture for each time of day, and for each state the set
 * declares (rain, a festival), the places that stand in front of it.
 */
export function BackdropEditor({
  name,
  at,
}: {
  name: string;
  /** The place it is open from, left out of where else it shows. */
  at?: string;
}) {
  const { data, error, isLoading, mutate } = useWikiBackdrops();
  if (isLoading)
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (error || !data)
    return (
      <p className="text-sm text-destructive">
        {error ? failureText(error) : "Couldn't read the backdrops."}
      </p>
    );
  const set = data.sets.find((one) => one.name === name);
  const states = [undefined, ...Object.keys(set?.states ?? {})];
  const fileOf = (state: string | undefined, time: string) =>
    set?.files.find((file) => file.state === state && file.time === time);
  const others =
    set?.files.filter((file) => !data.times.includes(file.time)) ?? [];
  const put = async (pictureName: string, file: File) => {
    await uploadPicture(
      { kind: "backdrop", set: name, name: pictureName },
      file,
    );
    await mutate();
  };
  const remove = async (pictureName: string) => {
    await removePicture({ kind: "backdrop", set: name, name: pictureName });
    await mutate();
  };

  return (
    <div className="flex flex-col gap-8">
      {set && set.places.length > 1 ? (
        <p className="text-sm text-muted-foreground">
          Also shown at{" "}
          {set.places
            .filter((place) => place.id !== at)
            .map((place, index) => (
              <span key={place.id}>
                {index > 0 ? ", " : null}
                <WikiLink id={place.id} />
              </span>
            ))}
          .
        </p>
      ) : null}
      {states.map((state) => (
        <section key={state ?? ""} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="text-sm font-semibold">
              {state ? <span className="font-mono">{state}</span> : "Usual"}
            </h2>
            {state ? (
              <p className="text-sm text-muted-foreground">
                {set?.states[state]}
              </p>
            ) : null}
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-3">
            {data.times.map((time) => {
              const pictureName = state ? `${state}-${time}` : time;
              const file = fileOf(state, time);
              return file ? (
                <PictureTile
                  key={time}
                  url={file.url}
                  name={time}
                  aspect="aspect-video"
                  what={`the ${pictureName} backdrop`}
                  onReplace={(next) => put(pictureName, next)}
                  onRemove={() => remove(pictureName)}
                />
              ) : (
                <EmptySlot
                  key={time}
                  label={`Add ${time}`}
                  onFile={(next) => put(pictureName, next)}
                />
              );
            })}
          </div>
        </section>
      ))}
      {others.length ? (
        <section className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="text-sm font-semibold">Other pictures</h2>
            <p className="text-sm text-muted-foreground">
              Not a time of day in this world, so never shown.
            </p>
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-3">
            {others.map((file) => (
              <PictureTile
                key={file.name}
                url={file.url}
                name={file.name}
                aspect="aspect-video"
                what={`the ${file.name} backdrop`}
                onReplace={(next) => put(file.name, next)}
                onRemove={() => remove(file.name)}
              />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

/** A new backdrop set is a name; it exists once its first picture is in. */
export function NewBackdropDialog({
  open,
  onOpenChange,
  taken,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taken: ReadonlySet<string>;
  onCreate: (name: string) => void;
}) {
  const [words, setWords] = useState("");
  const name = toPictureName(words);
  const clash = taken.has(name);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent>
        <DialogHeader>
          <DialogTitle>New backdrop set</DialogTitle>
          <DialogDescription>
            Pictures of one kind of place, one for each time of day. Places can
            share a set.
          </DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor="wiki-new-backdrop">Name</FieldLabel>
          <Input
            id="wiki-new-backdrop"
            value={words}
            autoFocus
            placeholder="Rooftop garden"
            onChange={(event) => setWords(event.target.value)}
          />
          <FieldDescription>
            {clash
              ? `There is already a set called ${name}.`
              : name
                ? `Saved as ${name}.`
                : "Lowercase words joined by dashes."}
          </FieldDescription>
        </Field>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>
            Cancel
          </DialogClose>
          <Button
            disabled={!name || clash}
            onClick={() => {
              onCreate(name);
              setWords("");
            }}
          >
            Make set
          </Button>
        </DialogFooter>
      </ResponsiveDialogContent>
    </Dialog>
  );
}

const AREA = "__area";

/**
 * A place's backdrop: the set it is drawn in front of, its own or its area's,
 * which set that is, and its pictures. Places can share a set.
 */
export function PlaceBackdrop({ id }: { id: string }) {
  const { canManage } = useAccess();
  const places = usePlaces();
  const form = useWikiForm(id);
  const { data: library, mutate } = useWikiBackdrops();
  const [making, setMaking] = useState(false);
  const [saving, setSaving] = useState(false);
  const place = places?.byId.get(id);
  const area = place?.parent ? places?.byId.get(place.parent) : undefined;
  const own = form.data?.fields.backdrop;
  const shown = own ?? area?.backdrop;
  const sets = library?.sets.map((set) => set.name) ?? [];

  const choose = async (backdrop: string | undefined) => {
    const opened = form.data;
    if (!opened) return;
    setSaving(true);
    try {
      await saveWikiForm({
        id,
        kind: opened.kind,
        base: opened.hash,
        fields: { ...opened.fields, backdrop },
        lead: opened.lead,
        close: opened.close,
        only: opened.only,
      });
      await Promise.all([form.mutate(), mutate()]);
    } catch (failure) {
      toast.error(failureText(failure));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          items={[
            { value: AREA, label: area ? `${area.name}'s` : "None" },
            ...sets.map((name) => ({ value: name, label: name })),
            ...(own && !sets.includes(own) ? [{ value: own, label: own }] : []),
          ]}
          value={own ?? AREA}
          disabled={!canManage || saving || !form.data}
          onValueChange={(next) =>
            next && void choose(next === AREA ? undefined : next)
          }
        >
          <SelectTrigger aria-label="Backdrop set" className="w-64">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={AREA}>
              {area ? `${area.name}'s` : "None"}
            </SelectItem>
            {sets.map((name) => (
              <SelectItem key={name} value={name}>
                {name}
              </SelectItem>
            ))}
            {own && !sets.includes(own) ? (
              <SelectItem value={own}>{own}</SelectItem>
            ) : null}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="sm"
          disabled={!canManage || saving}
          onClick={() => setMaking(true)}
        >
          <ImagePlusIcon />
          New set
        </Button>
        {!own && area ? (
          <span className="text-sm text-muted-foreground">
            From <WikiLink id={area.id} />
          </span>
        ) : null}
      </div>
      {shown ? (
        <BackdropEditor name={shown} at={id} />
      ) : (
        <p className="text-sm text-muted-foreground">
          No backdrop yet: pick a set, or make one.
        </p>
      )}
      <NewBackdropDialog
        open={making}
        onOpenChange={setMaking}
        taken={new Set(sets)}
        onCreate={(name) => {
          setMaking(false);
          void choose(name);
        }}
      />
    </div>
  );
}
