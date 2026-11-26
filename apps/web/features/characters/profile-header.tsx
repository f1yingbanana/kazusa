"use client";

import type { CharacterSummary } from "@kazusa/client";
import { ArrowLeftIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useQueryStates } from "nuqs";
import { useEffect } from "react";
import { useCharacters } from "@/hooks/use-characters";
import { usePortraits } from "@/hooks/use-scene";
import { entityRefParser } from "@/lib/state/entity-ref";
import { Button, IconButton } from "@/ui/button";
import type { InfoboxPicture } from "@/ui/infobox";
import { placeInCast } from "@/lib/characters/cast-book";
import { wikiParsers } from "../wiki/search-params";
import { charactersParsers } from "./search-params";

/**
 * Back to the cast, the selection going with it, so the details panel doesn't
 * keep them beside a cast that is about everyone.
 */
function leaveProfile() {
  return {
    character: null,
    "wiki.part": null,
    "wiki.edit": null,
    "wiki.raw": null,
    "chars.look": null,
    sel: null,
  } as const;
}

/** Turning a page keeps the tab, to read the same part of the next person. */
function turnTo(id: string) {
  return {
    character: id,
    "wiki.edit": null,
    "wiki.raw": null,
    "chars.look": null,
  } as const;
}

/**
 * Back to the cast, and the previous and next person in it. ← and → turn the
 * page too, unless a control that uses them has focus.
 */
export function CastNav({
  id,
  onBack,
}: {
  id: string;
  onBack?: (leave: () => void) => void;
}) {
  const { order } = useCastBook();
  const [, setParams] = useQueryStates({
    ...charactersParsers,
    "wiki.part": wikiParsers["wiki.part"],
    "wiki.edit": wikiParsers["wiki.edit"],
    "wiki.raw": wikiParsers["wiki.raw"],
    sel: entityRefParser,
  });
  const place = placeInCast(order, id);
  const { byId } = useCharacters();
  const prev = place?.prev ? byId.get(place.prev) : undefined;
  const next = place?.next ? byId.get(place.next) : undefined;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.shiftKey
      )
        return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const target = event.target as HTMLElement | null;
      if (
        target?.closest(
          "input, textarea, select, [contenteditable], [role=tablist], [role=radiogroup], [role=slider], [role=menu], [role=dialog], [role=listbox]",
        )
      )
        return;
      const to = event.key === "ArrowLeft" ? prev : next;
      if (!to) return;
      event.preventDefault();
      void setParams(turnTo(to.id));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prev, next, setParams]);

  return (
    <nav aria-label="Cast" className="flex items-center gap-1">
      <Button
        tone="ghost"
        size="sm"
        icon={<ArrowLeftIcon aria-hidden className="rtl:-scale-x-100" />}
        className="-ms-3"
        title="Back to everyone"
        onClick={() => {
          const leave = () => void setParams(leaveProfile());
          if (onBack) onBack(leave);
          else leave();
        }}
      >
        Back
      </Button>
      {place && place.total > 1 ? (
        <>
          <span className="ms-auto text-xs font-bold text-ui-soft tabular-nums">
            {`${place.index + 1} of ${place.total}`}
          </span>
          <IconButton
            label={prev ? `Previous: ${prev.name} (←)` : "Previous"}
            tone="ghost"
            size="sm"
            disabled={!prev}
            onClick={() => prev && void setParams(turnTo(prev.id))}
          >
            <ChevronLeftIcon aria-hidden className="rtl:-scale-x-100" />
          </IconButton>
          <IconButton
            label={next ? `Next: ${next.name} (→)` : "Next"}
            tone="ghost"
            size="sm"
            disabled={!next}
            onClick={() => next && void setParams(turnTo(next.id))}
          >
            <ChevronRightIcon aria-hidden className="rtl:-scale-x-100" />
          </IconButton>
        </>
      ) : null}
    </nav>
  );
}

import { useCastBook } from "./cast";

/**
 * The picture of them: a look being tried on, else the portrait they rest in,
 * else their display picture.
 */
export function useProfilePicture(character: CharacterSummary | undefined): {
  picture: InfoboxPicture | undefined;
  look: string | undefined;
} {
  const [{ "chars.look": look }] = useQueryStates(charactersParsers);
  const { data } = usePortraits(character && look ? character.id : undefined);
  if (!character) return { picture: undefined, look: undefined };
  const tried = look ? data?.portraits.find((p) => p.name === look) : undefined;
  if (tried)
    return {
      picture: { src: tried.url },
      look: tried.outfit ? `${tried.outfit} · ${tried.mood}` : tried.mood,
    };
  const src = character.portraitUrl ?? character.avatarUrl;
  return { picture: src ? { src } : undefined, look: undefined };
}
