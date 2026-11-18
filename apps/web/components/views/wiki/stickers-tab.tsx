"use client";

import { useState } from "react";
import { toast } from "sonner";
import type { WikiCharacterResponse, WikiSticker } from "@kazusa/client";
import { Textarea } from "@/components/ui/textarea";
import {
  removePicture,
  saveStickers,
  uploadPicture,
} from "@/lib/source/wiki/editor";
import { AddPictureDialog, OutfitGroup, byOutfit } from "./gallery";
import { PictureTile, failureText } from "./parts";

/** What a sticker shows, in the words they choose it by; saved on leaving. */
function LookField({
  id,
  sticker,
  onSaved,
}: {
  id: string;
  sticker: WikiSticker;
  onSaved: () => Promise<unknown>;
}) {
  const saved = sticker.look ?? "";
  const [text, setText] = useState(saved);
  return (
    <Textarea
      value={text}
      rows={2}
      placeholder={`${sticker.mood}…`}
      aria-label={`What the ${sticker.name} sticker shows`}
      className="field-sizing-content min-h-0 resize-none px-2 py-1 text-xs leading-snug"
      onChange={(event) => setText(event.target.value)}
      onBlur={() => {
        const next = text.trim();
        if (next === saved) return;
        void saveStickers({ id, looks: { [sticker.name]: next || null } })
          .then(onSaved)
          .catch((failure: unknown) => {
            setText(saved);
            toast.error(failureText(failure));
          });
      }}
    />
  );
}

/**
 * Stickers they send by text, by outfit as their looks are. What each shows is
 * how they choose one, so it is worth a few words.
 */
export function StickersTab({
  character,
  onChanged,
}: {
  character: WikiCharacterResponse;
  onChanged: () => Promise<unknown>;
}) {
  const [adding, setAdding] = useState<{ outfit: string | undefined }>();
  const { id, name } = character;
  const taken = new Set(character.stickers.map((sticker) => sticker.name));

  return (
    <div className="flex flex-col gap-8">
      <p className="max-w-prose text-sm text-pretty text-muted-foreground">
        Pictures of themselves they send in a text. They choose one by what it
        shows, so say it mood first: &ldquo;smug, one eyebrow up&rdquo;. Outfits
        are the ones in Looks.
      </p>
      {byOutfit(character.stickers, character.outfits).map(
        ({ outfit, pictures }) => (
          <OutfitGroup
            key={outfit ?? ""}
            title={
              outfit ? (
                <span className="font-mono">{outfit}</span>
              ) : (
                "Usual clothes"
              )
            }
            addLabel="Add a sticker"
            addAspect="aspect-square"
            onAdd={() => setAdding({ outfit })}
          >
            {pictures.map((sticker) => (
              <PictureTile
                key={sticker.name}
                url={sticker.url}
                name={sticker.mood}
                aspect="aspect-square"
                what={`${name}'s ${sticker.name} sticker`}
                onReplace={async (file) => {
                  await uploadPicture(
                    { kind: "sticker", owner: id, name: sticker.name },
                    file,
                  );
                  await onChanged();
                }}
                onRemove={async () => {
                  await removePicture({
                    kind: "sticker",
                    owner: id,
                    name: sticker.name,
                  });
                  await onChanged();
                }}
              >
                <LookField
                  key={sticker.look ?? ""}
                  id={id}
                  sticker={sticker}
                  onSaved={onChanged}
                />
              </PictureTile>
            ))}
          </OutfitGroup>
        ),
      )}
      <AddPictureDialog
        open={adding !== undefined}
        onOpenChange={(open) => !open && setAdding(undefined)}
        title={`Add a sticker for ${name}`}
        outfit={adding?.outfit}
        taken={taken}
        onAdd={async (pictureName, file) => {
          await uploadPicture(
            { kind: "sticker", owner: id, name: pictureName },
            file,
          );
          await onChanged();
          toast.success(`Added ${pictureName}.`);
        }}
      />
    </div>
  );
}
