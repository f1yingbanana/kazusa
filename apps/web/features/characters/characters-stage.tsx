"use client";

import type { CharacterSummary } from "@kazusa/client";
import { parseAsString, useQueryStates } from "nuqs";
import { useEffect } from "react";
import { useCharacters } from "@/hooks/use-characters";
import { Note } from "@/ui/note";
import { wikiParsers, type PagePart } from "../wiki/search-params";
import { WorldPage } from "../wiki/world-page";
import { clearGalleryFocus, rememberGalleryFocus } from "./cast";
import { Gallery } from "./gallery";
import { CastNav } from "./profile-header";
import { charactersParsers } from "./search-params";

const LEGACY_TAB_PART: Readonly<Record<string, PagePart | null>> = {
  about: null,
  story: null,
  people: "people",
  looks: "looks",
  memory: "memory",
};

/** The cast, or one of them: their card opens their page. */
export function CharactersStage() {
  const [{ character: id, "chars.tab": legacyTab }, setParams] = useQueryStates(
    {
      ...charactersParsers,
      "chars.tab": parseAsString,
      "wiki.part": wikiParsers["wiki.part"],
    },
  );
  const { byId, isLoading } = useCharacters();
  useEffect(() => () => clearGalleryFocus(), []);
  useEffect(() => {
    if (!legacyTab) return;
    const mapped =
      legacyTab in LEGACY_TAB_PART ? LEGACY_TAB_PART[legacyTab] : undefined;
    void setParams(
      {
        "chars.tab": null,
        ...(mapped !== undefined ? { "wiki.part": mapped } : {}),
      },
      { history: "replace" },
    );
  }, [legacyTab, setParams]);
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
