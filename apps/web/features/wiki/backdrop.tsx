"use client";

import { ImagePlusIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useAccess } from "@/hooks/use-access";
import { usePlaces } from "@/hooks/use-location";
import { useWikiBackdrops, useWikiForm } from "@/hooks/use-wiki-editor";
import {
  removePicture,
  saveWikiForm,
  uploadPicture,
} from "@/lib/source/wiki/editor";
import { toPictureName } from "@/lib/wiki/text";
import { Button } from "@/ui/button";
import { Dialog, DialogClose, DialogFoot, DialogPanel } from "@/ui/dialog";
import { TextField } from "@/ui/field";
import { Note } from "@/ui/note";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
} from "@/ui/select";
import { failureText } from "./failure";
import { WikiLink } from "./links";
import { DropTile, PictureTile } from "./pictures";

const AREA = "__area";

/**
 * The pictures of one backdrop set: one for each time of day, and for each
 * state the set declares (rain, a festival) the same again. Empty slots take a
 * picture dropped or chosen.
 */
function BackdropSet({
  name,
  at,
  editable,
}: {
  name: string;
  at: string;
  editable: boolean;
}) {
  const { data, error, isLoading, mutate } = useWikiBackdrops();
  if (isLoading) return <Note>Fetching the pictures…</Note>;
  if (error || !data)
    return (
      <Note>{error ? failureText(error) : "Couldn't read the backdrops."}</Note>
    );
  const set = data.sets.find((one) => one.name === name);
  const states = [undefined, ...Object.keys(set?.states ?? {})];
  const fileOf = (state: string | undefined, time: string) =>
    set?.files.find((file) => file.state === state && file.time === time);
  const others =
    set?.files.filter((file) => !data.times.includes(file.time)) ?? [];
  const put = async (picture: string, file: File) => {
    await uploadPicture({ kind: "backdrop", set: name, name: picture }, file);
    await mutate();
  };
  const remove = async (picture: string) => {
    await removePicture({ kind: "backdrop", set: name, name: picture });
    await mutate();
  };
  const elsewhere = set?.places.filter((place) => place.id !== at) ?? [];
  return (
    <div className="flex flex-col gap-8">
      {elsewhere.length ? (
        <p className="text-[0.8125rem] text-ui-soft">
          {"Also behind "}
          {elsewhere.map((place, index) => (
            <span key={place.id}>
              {index ? ", " : null}
              <WikiLink id={place.id} />
            </span>
          ))}
        </p>
      ) : null}
      {states.map((state) => (
        <section
          key={state ?? ""}
          aria-label={state ?? "Usual"}
          className="flex flex-col gap-3"
        >
          <div className="flex flex-col gap-0.5">
            <h3 className="text-[0.9375rem] font-extrabold capitalize">
              {state ?? "Usual"}
            </h3>
            {state ? (
              <p className="text-[0.8125rem] text-ui-soft">
                {set?.states[state]}
              </p>
            ) : null}
          </div>
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-3">
            {data.times.map((time) => {
              const picture = state ? `${state}-${time}` : time;
              const file = fileOf(state, time);
              return (
                <li key={time}>
                  {file ? (
                    <PictureTile
                      url={file.url}
                      name={time}
                      what={`the ${picture} backdrop`}
                      aspect="aspect-video"
                      fit="face"
                      editable={editable}
                      onReplace={(next) => put(picture, next)}
                      onRemove={() => remove(picture)}
                    />
                  ) : editable ? (
                    <DropTile
                      label={`Add ${time}`}
                      aspect="aspect-video"
                      onFile={(next) => put(picture, next)}
                    />
                  ) : (
                    <div className="flex aspect-video items-center justify-center rounded-[1rem] bg-ui-ground text-[0.8125rem] font-bold text-ui-soft capitalize">
                      {`No ${time}`}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {others.length ? (
        <section aria-label="Other pictures" className="flex flex-col gap-3">
          <div className="flex flex-col gap-0.5">
            <h3 className="text-[0.9375rem] font-extrabold">Other pictures</h3>
            <p className="text-[0.8125rem] text-ui-soft">
              Not a time of day in this world, so never shown.
            </p>
          </div>
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-3">
            {others.map((file) => (
              <li key={file.name}>
                <PictureTile
                  url={file.url}
                  name={file.name}
                  what={`the ${file.name} backdrop`}
                  aspect="aspect-video"
                  fit="face"
                  editable={editable}
                  onReplace={(next) => put(file.name, next)}
                  onRemove={() => remove(file.name)}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

/**
 * A place's backdrop: the set a scene there is drawn in front of, its own or
 * the area's, and that set's pictures. Places can share one set.
 */
export function BackdropPanel({ id }: { id: string }) {
  const { canManage } = useAccess();
  const places = usePlaces();
  const form = useWikiForm(canManage ? id : undefined);
  const { data: library, mutate } = useWikiBackdrops();
  const [making, setMaking] = useState(false);
  const [saving, setSaving] = useState(false);
  const place = places?.byId.get(id);
  const area = place?.parent ? places?.byId.get(place.parent) : undefined;
  const own = canManage ? form.data?.fields.backdrop : place?.backdrop;
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
      toast.error("Couldn't change the backdrop", {
        description: failureText(failure),
      });
    } finally {
      setSaving(false);
    }
  };
  const areaLabel = area ? `${area.name}'s, its area` : "None";

  return (
    <div className="flex flex-col gap-6">
      {canManage ? (
        <div className="flex flex-wrap items-center gap-2">
          <Select<string>
            items={[
              { value: AREA, label: areaLabel },
              ...sets.map((name) => ({ value: name, label: name })),
            ]}
            value={own ?? AREA}
            disabled={saving || !form.data}
            onValueChange={(next) =>
              next && void choose(next === AREA ? undefined : next)
            }
          >
            <SelectTrigger
              aria-label="Backdrop set"
              className="w-72 max-sm:w-full"
            />
            <SelectContent>
              <SelectItem value={AREA}>{areaLabel}</SelectItem>
              {sets.length ? <SelectSeparator /> : null}
              {sets.map((name) => (
                <SelectItem key={name} value={name}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            tone="soft"
            size="sm"
            icon={<ImagePlusIcon aria-hidden />}
            disabled={saving}
            onClick={() => setMaking(true)}
          >
            New set
          </Button>
        </div>
      ) : !own && area ? (
        <p className="text-[0.8125rem] text-ui-soft">
          {"Drawn in front of "}
          <WikiLink id={area.id} />
          {"'s backdrop."}
        </p>
      ) : null}
      {shown ? (
        <BackdropSet name={shown} at={id} editable={canManage} />
      ) : (
        <Note>No backdrop yet: a scene here is drawn on plain ground.</Note>
      )}
      <NewSetDialog
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

function NewSetDialog({
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
      <DialogPanel
        title="New backdrop set"
        description="Pictures of one kind of place, one for each time of day. Places can share a set."
      >
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!name || clash) return;
            onCreate(name);
            setWords("");
          }}
        >
          <TextField
            label="Name"
            value={words}
            autoFocus
            placeholder="Rooftop garden"
            error={clash ? `There is a set called ${name} already.` : undefined}
            description={
              name ? `Saved as ${name}` : "Lowercase words joined by dashes."
            }
            onChange={(event) => setWords(event.target.value)}
          />
          <DialogFoot>
            <DialogClose render={<Button tone="ghost" />}>Cancel</DialogClose>
            <Button type="submit" tone="primary" disabled={!name || clash}>
              Confirm
            </Button>
          </DialogFoot>
        </form>
      </DialogPanel>
    </Dialog>
  );
}
