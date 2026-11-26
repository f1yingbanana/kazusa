"use client";

import type { CharacterSummary } from "@kazusa/client";
import { useQueryStates } from "nuqs";
import { useEffect } from "react";
import { useCharacters } from "@/hooks/use-characters";
import { Note } from "@/ui/note";
import { WorldPage } from "../wiki/world-page";
import { clearGalleryFocus, rememberGalleryFocus } from "./cast";
import { Gallery } from "./gallery";
import { CastNav } from "./profile-header";
import { charactersParsers } from "./search-params";

/** The cast, or one of them: their card opens their page. */
export function CharactersStage() {
  const [{ character: id }] = useQueryStates(charactersParsers);
  const { byId, isLoading } = useCharacters();
  useEffect(() => () => clearGalleryFocus(), []);
  const character = id ? byId.get(id) : undefined;
  if (!id) return <Gallery />;
  if (!character)
    return (
      <Note inset="panel">
        {isLoading ? "Finding them…" : `No one called “${id}” was found.`}
      </Note>
    );
  return <CharacterPage character={character} />;
}

function CharacterPage({ character }: { character: CharacterSummary }) {
  useEffect(() => {
    rememberGalleryFocus(character.id);
  }, [character.id]);

  return (
    <WorldPage
      key={character.id}
      id={character.id}
      castNav={<CastNav id={character.id} />}
    />
  );
}
