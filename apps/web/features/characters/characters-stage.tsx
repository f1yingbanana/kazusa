"use client";

import type { CharacterSummary } from "@kazusa/client";
import { parseAsString, useQueryStates } from "nuqs";
import { useEffect, useState } from "react";
import { useCharacters } from "@/hooks/use-characters";
import { useMediaQuery } from "@/hooks/use-media-query";
import { Note } from "@/ui/note";
import { slide } from "../shell/slide";
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
  const docked = useMediaQuery("(min-width: 1024px)");
  const [pendingId, setPendingId] = useState<string | null | undefined>(
    undefined,
  );
  const [prevId, setPrevId] = useState(id);
  if (prevId !== id) {
    setPrevId(id);
    if (pendingId !== undefined) setPendingId(undefined);
  }
  const shownId = pendingId !== undefined ? pendingId : id;
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
  const character = shownId ? byId.get(shownId) : undefined;

  const openCharacter = (targetId: string, navigate: () => void) => {
    if (docked) {
      navigate();
      return;
    }
    slide("forward", () => {
      setPendingId(targetId);
      navigate();
    });
  };

  const leaveCharacter = (leave: () => void) => {
    if (docked) {
      leave();
      return;
    }
    slide("back", () => {
      setPendingId(null);
      leave();
    });
  };

  if (!shownId) return <Gallery onOpen={openCharacter} />;
  if (!character)
    return (
      <Note inset="panel">
        {isLoading ? "Finding them…" : `No one called “${shownId}” was found.`}
      </Note>
    );
  return <CharacterPage character={character} onBack={leaveCharacter} />;
}

function CharacterPage({
  character,
  onBack,
}: {
  character: CharacterSummary;
  onBack: (leave: () => void) => void;
}) {
  useEffect(() => {
    rememberGalleryFocus(character.id);
  }, [character.id]);

  return (
    <WorldPage
      key={character.id}
      id={character.id}
      castNav={<CastNav id={character.id} onBack={onBack} />}
    />
  );
}
