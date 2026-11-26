"use client";

import type {
  WikiCharacterResponse,
  WikiPicture,
  WikiSticker,
} from "@kazusa/client";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
  removePicture,
  saveStickers,
  uploadPicture,
} from "@/lib/source/wiki/editor";
import { toPictureName } from "@/lib/wiki/text";
import { Button } from "@/ui/button";
import { AlertDialog, AlertPanel } from "@/ui/dialog";
import { TextInput } from "@/ui/input";
import { failureText } from "../wiki/failure";
import { AddPictureDialog, AddTile, PictureTile } from "../wiki/pictures";

/** Pictures grouped by what is worn: the usual clothes first, then each outfit. */
export function byOutfit<P extends WikiPicture>(
  pictures: readonly P[],
  outfits: Readonly<Record<string, string>>,
): { readonly outfit: string | undefined; readonly pictures: P[] }[] {
  return [undefined, ...Object.keys(outfits).sort()].map((outfit) => ({
    outfit,
    pictures: pictures.filter((picture) => picture.outfit === outfit),
  }));
}

/** A text saved when the field is left, put back if the save fails. */
function SavedOnLeave({
  value,
  label,
  placeholder,
  onSave,
  className,
}: {
  value: string;
  label: string;
  placeholder?: string;
  onSave: (text: string) => Promise<unknown>;
  className?: string;
}) {
  const [text, setText] = useState(value);
  return (
    <TextInput
      value={text}
      aria-label={label}
      placeholder={placeholder}
      className={className}
      onChange={(event) => setText(event.target.value)}
      onBlur={() => {
        const next = text.trim();
        if (next === value) return;
        void onSave(next).catch((failure: unknown) => {
          setText(value);
          toast.error(failureText(failure));
        });
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
    />
  );
}

function OutfitHead({
  id,
  outfit,
  worn,
  empty,
  onChanged,
}: {
  id: string;
  outfit: string | undefined;
  worn: string;
  empty: boolean;
  onChanged: () => Promise<unknown>;
}) {
  const [asking, setAsking] = useState(false);
  if (!outfit)
    return <h3 className="text-[0.9375rem] font-extrabold">Usual clothes</h3>;
  return (
    <div className="flex flex-col gap-1.5">
      <h3 className="text-[0.9375rem] font-extrabold capitalize">{outfit}</h3>
      <div className="flex items-center gap-2">
        <SavedOnLeave
          key={worn}
          value={worn}
          label={`What the ${outfit} outfit is`}
          placeholder="What is worn"
          className="h-9 max-w-xl flex-1"
          onSave={async (text) => {
            if (!text) throw new Error("Say what the outfit is, or remove it.");
            await saveStickers({ id, outfits: { [outfit]: text } });
            await onChanged();
          }}
        />
        {empty ? (
          <Button
            tone="danger"
            size="sm"
            icon={<Trash2Icon aria-hidden />}
            onClick={() => setAsking(true)}
          >
            Remove outfit
          </Button>
        ) : null}
      </div>
      <AlertDialog open={asking} onOpenChange={setAsking}>
        <AlertPanel
          danger
          title={`Remove the ${outfit} outfit?`}
          description="It has no pictures."
          onConfirm={() =>
            void saveStickers({ id, outfits: { [outfit]: null } })
              .then(onChanged)
              .catch((failure: unknown) => toast.error(failureText(failure)))
          }
        />
      </AlertDialog>
    </div>
  );
}

/**
 * Their looks, opened to be changed: each outfit's portraits and stickers,
 * pictures replaced by dropping one on them, new ones added by mood, what a
 * sticker shows and what an outfit is said in words, and outfits added and
 * taken away. Each change saves as it is made.
 */
export function LooksEditor({
  character,
  onChanged,
}: {
  character: WikiCharacterResponse;
  onChanged: () => Promise<unknown>;
}) {
  const [adding, setAdding] = useState<{
    kind: "portrait" | "sticker";
    outfit: string | undefined;
  }>();
  const [word, setWord] = useState("");
  const [worn, setWorn] = useState("");
  const { id, name } = character;
  const portraits = byOutfit(character.portraits, character.outfits);
  const stickers = byOutfit<WikiSticker>(character.stickers, character.outfits);
  const newWord = toPictureName(word);
  const canAdd =
    Boolean(newWord) && Boolean(worn.trim()) && !(newWord in character.outfits);
  const taken = new Set(
    adding?.kind === "sticker"
      ? character.stickers.map((s) => s.name)
      : character.portraits.map((p) => p.name),
  );

  const upload = async (
    kind: "portrait" | "sticker",
    picture: string,
    file: File,
  ) => {
    await uploadPicture({ kind, owner: id, name: picture }, file);
    await onChanged();
  };
  const remove = async (kind: "portrait" | "sticker", picture: string) => {
    await removePicture({ kind, owner: id, name: picture });
    await onChanged();
  };

  return (
    <div className="flex flex-col gap-9">
      {portraits.map(({ outfit, pictures }, index) => {
        const sent = stickers[index]?.pictures ?? [];
        return (
          <section
            key={outfit ?? ""}
            aria-label={outfit ?? "Usual clothes"}
            className="flex flex-col gap-4 motion-safe:animate-ui-rise"
          >
            <OutfitHead
              id={id}
              outfit={outfit}
              worn={outfit ? (character.outfits[outfit] ?? "") : ""}
              empty={pictures.length === 0 && sent.length === 0}
              onChanged={onChanged}
            />
            <div className="flex flex-col gap-2">
              <span className="text-xs font-bold text-ui-soft">Portraits</span>
              <ul className="grid grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] gap-3">
                {pictures.map((portrait) => (
                  <li key={portrait.name}>
                    <PictureTile
                      url={portrait.url}
                      name={portrait.mood}
                      what={`${name}'s ${portrait.name} look`}
                      aspect="aspect-[4/5]"
                      fit="face"
                      editable
                      onReplace={(file) =>
                        upload("portrait", portrait.name, file)
                      }
                      onRemove={() => remove("portrait", portrait.name)}
                    />
                  </li>
                ))}
                <li>
                  <AddTile
                    label="Add a look"
                    aspect="aspect-[4/5]"
                    onClick={() => setAdding({ kind: "portrait", outfit })}
                  />
                </li>
              </ul>
            </div>
            <div className="flex flex-col gap-2">
              <span className="text-xs font-bold text-ui-soft">Stickers</span>
              <ul className="grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-3">
                {sent.map((sticker) => (
                  <li key={sticker.name}>
                    <PictureTile
                      url={sticker.url}
                      name={sticker.mood}
                      what={`${name}'s ${sticker.name} sticker`}
                      editable
                      onReplace={(file) =>
                        upload("sticker", sticker.name, file)
                      }
                      onRemove={() => remove("sticker", sticker.name)}
                    >
                      <SavedOnLeave
                        key={sticker.look ?? ""}
                        value={sticker.look ?? ""}
                        label={`What the ${sticker.name} sticker shows`}
                        placeholder={`${sticker.mood}, and what shows`}
                        className="h-8 px-2.5 text-xs"
                        onSave={async (text) => {
                          await saveStickers({
                            id,
                            looks: { [sticker.name]: text || null },
                          });
                          await onChanged();
                        }}
                      />
                    </PictureTile>
                  </li>
                ))}
                <li>
                  <AddTile
                    label="Add a sticker"
                    onClick={() => setAdding({ kind: "sticker", outfit })}
                  />
                </li>
              </ul>
            </div>
          </section>
        );
      })}

      <form
        noValidate
        className="flex flex-wrap items-end gap-2 border-t border-ui-line pt-6"
        onSubmit={(event) => {
          event.preventDefault();
          if (!canAdd) return;
          void saveStickers({ id, outfits: { [newWord]: worn.trim() } })
            .then(onChanged)
            .then(() => {
              setWord("");
              setWorn("");
            })
            .catch((failure: unknown) => toast.error(failureText(failure)));
        }}
      >
        <label className="flex w-40 flex-col gap-1.5 text-sm font-bold">
          New outfit
          <TextInput
            value={word}
            placeholder="swimsuit"
            className="h-9"
            onChange={(event) => setWord(event.target.value)}
          />
        </label>
        <label className="flex min-w-60 flex-1 flex-col gap-1.5 text-sm font-bold">
          What is worn
          <TextInput
            value={worn}
            placeholder="A navy one-piece and a white sun hat"
            className="h-9"
            onChange={(event) => setWorn(event.target.value)}
          />
        </label>
        <Button
          type="submit"
          tone="soft"
          icon={<PlusIcon aria-hidden />}
          disabled={!canAdd}
        >
          Add outfit
        </Button>
      </form>

      <AddPictureDialog
        open={adding !== undefined}
        onOpenChange={(open) => !open && setAdding(undefined)}
        title={
          adding?.kind === "sticker"
            ? `A sticker for ${name}`
            : `A look for ${name}`
        }
        outfit={adding?.outfit}
        taken={taken}
        onAdd={async (picture, file) => {
          if (!adding) return;
          await upload(adding.kind, picture, file);
          toast.success(`Added ${picture}`);
        }}
      />
    </div>
  );
}
