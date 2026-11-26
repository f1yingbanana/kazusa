"use client";

import { ImagePlusIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { usePlaces } from "@/hooks/use-location";
import { useWikiBackdrops, useWikiForm } from "@/hooks/use-wiki-editor";
import {
  removePicture,
  saveWikiForm,
  uploadPicture,
} from "@/lib/source/wiki/editor";
import { toPictureName } from "@/lib/wiki/text";
import { Button } from "@/ui/button";
import { cx } from "@/ui/cx";
import { Dialog, DialogClose, DialogFoot, DialogPanel } from "@/ui/dialog";
import { TextField } from "@/ui/field";
import { Note } from "@/ui/note";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/ui/select";
import { failureText } from "./failure";
import { useLeaveGuard } from "./leave-guard";
import { WikiLink } from "./links";
import { DropTile, PictureTile } from "./pictures";
import { useRefreshWiki } from "./refresh";

const AREA = "__area";

/** `ruined-school-corridor` → "Ruined school corridor". */
const setLabel = (name: string) =>
  name.charAt(0).toUpperCase() + name.slice(1).replace(/-/g, " ");

/**
 * Changes waiting for Save: another set (null for the area's), and pictures put
 * in or taken out of the set shown.
 */
interface Draft {
  readonly set?: string | null;
  readonly puts: Readonly<Record<string, File>>;
  readonly removes: readonly string[];
}

const NONE: Draft = { puts: {}, removes: [] };

/** A picture to show for each file waiting to go in. */
function usePreviews(puts: Draft["puts"]): Readonly<Record<string, string>> {
  const urls = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(puts).map(([name, file]) => [
          name,
          URL.createObjectURL(file),
        ]),
      ),
    [puts],
  );
  useEffect(
    () => () => Object.values(urls).forEach((url) => URL.revokeObjectURL(url)),
    [urls],
  );
  return urls;
}

/**
 * The pictures of one backdrop set: one for each time of day, and for each
 * state the set declares (rain, a festival) the same again. While editing, each
 * slot takes a picture dropped or chosen, kept back until Save.
 */
function BackdropSet({
  name,
  at,
  draft,
  onDraft,
}: {
  name: string;
  at: string;
  draft?: Draft | undefined;
  onDraft?: ((draft: Draft) => void) | undefined;
}) {
  const { data, error, isLoading } = useWikiBackdrops();
  const previews = usePreviews(draft?.puts ?? {});
  if (isLoading) return null;
  if (error || !data)
    return (
      <Note>{error ? failureText(error) : "Couldn't read the backdrops."}</Note>
    );
  const set = data.sets.find((one) => one.name === name);
  const states = [undefined, ...Object.keys(set?.states ?? {})];
  const editing = Boolean(draft && onDraft);
  const urlOf = (picture: string, saved?: string) =>
    previews[picture] ?? (draft?.removes.includes(picture) ? undefined : saved);
  const put = (picture: string, file: File) =>
    draft &&
    onDraft?.({
      ...draft,
      puts: { ...draft.puts, [picture]: file },
      removes: draft.removes.filter((one) => one !== picture),
    });
  const remove = (picture: string) => {
    if (!draft) return;
    const { [picture]: _, ...puts } = draft.puts;
    const saved = set?.files.some((file) => file.name === picture);
    onDraft?.({
      ...draft,
      puts,
      removes: saved ? [...draft.removes, picture] : draft.removes,
    });
  };
  const elsewhere = set?.places.filter((place) => place.id !== at) ?? [];
  const others =
    set?.files.filter((file) => !data.times.includes(file.time)) ?? [];

  const slot = (picture: string, label: string, saved?: string) => {
    const url = urlOf(picture, saved);
    if (url)
      return (
        <PictureTile
          url={url}
          name={label}
          what={`the ${picture} backdrop`}
          aspect="aspect-video"
          fit="face"
          editable={editing}
          confirmRemove={false}
          onReplace={async (file) => put(picture, file)}
          onRemove={async () => remove(picture)}
        />
      );
    return editing ? (
      <DropTile
        label={`Add ${label}`}
        aspect="aspect-video"
        onFile={async (file) => put(picture, file)}
      />
    ) : (
      <div className="flex aspect-video items-center justify-center rounded-[1rem] bg-ui-ground text-[0.8125rem] font-bold text-ui-soft capitalize">
        {`No ${label}`}
      </div>
    );
  };

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
          {state ? (
            <div className="flex flex-col gap-0.5">
              <h3 className="text-[0.9375rem] font-extrabold capitalize">
                {state}
              </h3>
              <p className="text-[0.8125rem] text-ui-soft">
                {set?.states[state]}
              </p>
            </div>
          ) : null}
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-3">
            {data.times.map((time) => {
              const picture = state ? `${state}-${time}` : time;
              const file = set?.files.find(
                (one) => one.state === state && one.time === time,
              );
              return <li key={time}>{slot(picture, time, file?.url)}</li>;
            })}
          </ul>
        </section>
      ))}
      {others.length ? (
        <section aria-label="Other pictures" className="flex flex-col gap-3">
          <h3 className="text-[0.9375rem] font-extrabold">Other pictures</h3>
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-3">
            {others.map((file) => (
              <li key={file.name}>{slot(file.name, file.name, file.url)}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

/**
 * A place's backdrop: the set a scene there is drawn in front of, its own or
 * its area's. Read, its pictures; opened to be edited, which set it is and what
 * is in it, all kept back until Save. Places can share one set.
 */
export function BackdropPanel({
  id,
  editing,
  onDone,
}: {
  id: string;
  editing: boolean;
  onDone: () => void;
}) {
  const places = usePlaces();
  const form = useWikiForm(editing ? id : undefined);
  const { data: library, mutate } = useWikiBackdrops();
  const refresh = useRefreshWiki();
  const [draft, setDraft] = useState<Draft>(NONE);
  const [making, setMaking] = useState(false);
  const [saving, setSaving] = useState(false);
  const place = places?.byId.get(id);
  const area = place?.parent ? places?.byId.get(place.parent) : undefined;
  const saved = editing ? form.data?.fields.backdrop : place?.backdrop;
  const own = draft.set === undefined ? saved : (draft.set ?? undefined);
  const shown = own ?? area?.backdrop;
  const sets = library?.sets.map((set) => set.name) ?? [];
  const dirty =
    draft.set !== undefined ||
    Object.keys(draft.puts).length > 0 ||
    draft.removes.length > 0;
  const guard = useLeaveGuard(editing && dirty);
  const areaLabel = area ? `Same as ${area.name}` : "None";

  const save = async () => {
    const opened = form.data;
    if (!opened || !shown) return;
    setSaving(true);
    try {
      if (draft.set !== undefined)
        await saveWikiForm({
          id,
          kind: opened.kind,
          base: opened.hash,
          fields: { ...opened.fields, backdrop: draft.set ?? undefined },
          lead: opened.lead,
          close: opened.close,
          only: opened.only,
        });
      for (const [name, file] of Object.entries(draft.puts))
        await uploadPicture({ kind: "backdrop", set: shown, name }, file);
      for (const name of draft.removes)
        await removePicture({ kind: "backdrop", set: shown, name });
      await Promise.all([form.mutate(), mutate(), refresh()]);
      setDraft(NONE);
      toast.success("Saved the backdrop");
      onDone();
    } catch (failure) {
      toast.error("Couldn't save the backdrop", {
        description: failureText(failure),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div ref={guard.scope} className="flex flex-col gap-6">
      {editing ? (
        <div className="flex flex-wrap items-center gap-2">
          <Select<string>
            items={[
              { value: AREA, label: areaLabel },
              ...sets.map((name) => ({ value: name, label: setLabel(name) })),
            ]}
            value={own ?? AREA}
            disabled={saving || !form.data}
            onValueChange={(next) =>
              next &&
              setDraft({
                set: next === AREA ? null : next,
                puts: {},
                removes: [],
              })
            }
          >
            <SelectTrigger
              aria-label="Backdrop set"
              className="w-72 max-sm:w-full"
            />
            <SelectContent>
              <SelectItem value={AREA}>{areaLabel}</SelectItem>
              {sets.map((name) => (
                <SelectItem key={name} value={name}>
                  {setLabel(name)}
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
      ) : shown ? (
        <p className="text-[0.8125rem] font-bold text-ui-soft">
          {setLabel(shown)}
          {!own && area ? (
            <>
              {" · from "}
              <WikiLink id={area.id} />
            </>
          ) : null}
        </p>
      ) : null}
      {shown ? (
        <BackdropSet
          name={shown}
          at={id}
          draft={editing ? draft : undefined}
          onDraft={editing ? setDraft : undefined}
        />
      ) : (
        <Note>No backdrop.</Note>
      )}
      {editing ? (
        <div
          role="region"
          aria-label="Saving"
          className="sticky bottom-3 z-20 mt-2 flex flex-wrap items-center gap-2 rounded-[1.25rem] ui-raised px-3 py-2 motion-safe:animate-ui-rise"
        >
          <p
            role="status"
            className={cx(
              "min-w-0 flex-1 truncate px-1 text-[0.8125rem] font-semibold text-ui-soft",
            )}
          >
            {dirty ? "Unsaved changes" : "No changes yet"}
          </p>
          <Button
            tone="ghost"
            size="sm"
            disabled={saving}
            onClick={() => {
              setDraft(NONE);
              onDone();
            }}
          >
            Cancel
          </Button>
          <Button
            tone="primary"
            size="sm"
            pending={saving}
            disabled={!dirty}
            onClick={() => void save()}
          >
            Save
          </Button>
        </div>
      ) : null}
      <NewSetDialog
        open={making}
        onOpenChange={setMaking}
        taken={new Set(sets)}
        onCreate={(name) => {
          setMaking(false);
          setDraft({ set: name, puts: {}, removes: [] });
        }}
      />
      {guard.dialog}
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
        description="One picture per time of day. Places can share a set."
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
            description={name ? `Saved as ${name}` : undefined}
            onChange={(event) => setWords(event.target.value)}
          />
          <DialogFoot>
            <DialogClose render={<Button tone="ghost" />}>Cancel</DialogClose>
            <Button type="submit" tone="primary" disabled={!name || clash}>
              Make set
            </Button>
          </DialogFoot>
        </form>
      </DialogPanel>
    </Dialog>
  );
}
