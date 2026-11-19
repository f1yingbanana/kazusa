"use client";

import { useState } from "react";
import { PlusIcon } from "lucide-react";
import { toast } from "sonner";
import type { WikiCharacterResponse } from "@kazusa/client";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  removePicture,
  saveStickers,
  uploadPicture,
} from "@/lib/source/wiki/editor";
import { AddPictureDialog, OutfitGroup, byOutfit } from "./gallery";
import { PictureTile, RemoveButton, failureText, toPictureName } from "./parts";

/** What an outfit is, saved when the field is left. */
function OutfitWorn({
  id,
  word,
  worn,
  onSaved,
}: {
  id: string;
  word: string;
  worn: string;
  onSaved: () => Promise<unknown>;
}) {
  const [text, setText] = useState(worn);
  return (
    <Input
      value={text}
      aria-label={`What the ${word} outfit is`}
      className="max-w-xl"
      onChange={(event) => setText(event.target.value)}
      onBlur={() => {
        const next = text.trim();
        if (!next || next === worn) return setText(worn);
        void saveStickers({ id, outfits: { [word]: next } })
          .then(onSaved)
          .catch((failure: unknown) => toast.error(failureText(failure)));
      }}
    />
  );
}

/**
 * Their portraits: the whole figure a scene stands them in, one per mood, in
 * each outfit. A name is `<outfit>-<mood>`, as their stickers are.
 */
export function LooksTab({
  character,
  onChanged,
}: {
  character: WikiCharacterResponse;
  onChanged: () => Promise<unknown>;
}) {
  const [adding, setAdding] = useState<{ outfit: string | undefined }>();
  const [word, setWord] = useState("");
  const [worn, setWorn] = useState("");
  const { id, name } = character;
  const taken = new Set(character.portraits.map((portrait) => portrait.name));
  const groups = byOutfit(character.portraits, character.outfits);
  const newWord = toPictureName(word);

  return (
    <div className="flex flex-col gap-8">
      <p className="max-w-prose text-sm text-pretty text-muted-foreground">
        The figure a scene shows them as, one picture per mood. They pick the
        mood as they speak, among the ones in what they are wearing.
      </p>
      {groups.map(({ outfit, pictures }) => (
        <OutfitGroup
          key={outfit ?? ""}
          title={
            outfit ? (
              <span className="font-mono">{outfit}</span>
            ) : (
              "Usual clothes"
            )
          }
          description={
            outfit ? (
              <div className="flex items-center gap-2">
                <OutfitWorn
                  id={id}
                  word={outfit}
                  worn={character.outfits[outfit] ?? ""}
                  onSaved={onChanged}
                />
                {pictures.length === 0 &&
                !character.stickers.some((s) => s.outfit === outfit) ? (
                  <RemoveButton
                    what={`the ${outfit} outfit`}
                    size="sm"
                    label="Remove outfit"
                    onRemove={async () => {
                      await saveStickers({ id, outfits: { [outfit]: null } });
                      await onChanged();
                    }}
                  />
                ) : null}
              </div>
            ) : undefined
          }
          addLabel="Add a look"
          addAspect="aspect-square"
          onAdd={() => setAdding({ outfit })}
        >
          {pictures.map((portrait) => (
            <PictureTile
              key={portrait.name}
              url={portrait.url}
              name={portrait.mood}
              aspect="aspect-square"
              fit="face"
              what={`${name}'s ${portrait.name} look`}
              onReplace={async (file) => {
                await uploadPicture(
                  { kind: "portrait", owner: id, name: portrait.name },
                  file,
                );
                await onChanged();
              }}
              onRemove={async () => {
                await removePicture({
                  kind: "portrait",
                  owner: id,
                  name: portrait.name,
                });
                await onChanged();
              }}
            />
          ))}
        </OutfitGroup>
      ))}
      <form
        className="flex max-w-3xl flex-wrap items-end gap-2 border-t pt-6"
        onSubmit={(event) => {
          event.preventDefault();
          if (!newWord || !worn.trim() || newWord in character.outfits) return;
          void saveStickers({ id, outfits: { [newWord]: worn.trim() } })
            .then(onChanged)
            .then(() => {
              setWord("");
              setWorn("");
            })
            .catch((failure: unknown) => toast.error(failureText(failure)));
        }}
      >
        <Field className="w-40">
          <FieldLabel htmlFor="wiki-outfit-word">New outfit</FieldLabel>
          <Input
            id="wiki-outfit-word"
            value={word}
            placeholder="swimsuit"
            onChange={(event) => setWord(event.target.value)}
          />
        </Field>
        <Field className="min-w-60 flex-1">
          <FieldLabel htmlFor="wiki-outfit-worn">What is worn</FieldLabel>
          <Input
            id="wiki-outfit-worn"
            value={worn}
            placeholder="A navy one-piece and a white sun hat"
            onChange={(event) => setWorn(event.target.value)}
          />
        </Field>
        <Button
          type="submit"
          variant="outline"
          disabled={!newWord || !worn.trim() || newWord in character.outfits}
        >
          <PlusIcon />
          Add outfit
        </Button>
      </form>
      <AddPictureDialog
        open={adding !== undefined}
        onOpenChange={(open) => !open && setAdding(undefined)}
        title={`Add a look for ${name}`}
        outfit={adding?.outfit}
        taken={taken}
        onAdd={async (pictureName, file) => {
          await uploadPicture(
            { kind: "portrait", owner: id, name: pictureName },
            file,
          );
          await onChanged();
          toast.success(`Added ${pictureName}.`);
        }}
      />
    </div>
  );
}
