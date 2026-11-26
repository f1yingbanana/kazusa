"use client";

import type { CharacterSummary, WikiLevel } from "@kazusa/client";
import {
  ArrowLeftIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  PanelRightOpenIcon,
} from "lucide-react";
import { parseAsString, useQueryStates } from "nuqs";
import { useEffect } from "react";
import { useCharacters } from "@/hooks/use-characters";
import { useMediaQuery } from "@/hooks/use-media-query";
import { usePortraits } from "@/hooks/use-scene";
import { useSelection } from "@/hooks/use-selection";
import { usePageName, useWikiPage } from "@/hooks/use-wiki";
import { placeInCast } from "@/lib/characters/cast-book";
import { entityRefParser } from "@/lib/state/entity-ref";
import { requestInspector } from "@/lib/state/ui-store";
import { Button, IconButton } from "@/ui/button";
import { Infobox, InfoboxRow, type InfoboxPicture } from "@/ui/infobox";
import { StatusLine } from "./character-actions";
import { useCastBook } from "./cast";
import { usePresence } from "./presence";
import { charactersParsers } from "./search-params";

const MEMBERSHIP: Record<WikiLevel, string> = {
  "heard of": "Associate",
  knows: "Member",
  close: "Close member",
};

/** Where the details panel docks; below it, a press opens it as a drawer. */
const PANEL_DOCKED = "(min-width: 1280px)";

/**
 * Back to the cast, the selection going with it, so the details panel doesn't
 * keep them beside a cast that is about everyone.
 */
function leaveProfile() {
  return {
    character: null,
    "chars.tab": null,
    "chars.look": null,
    sel: null,
  } as const;
}

/** Turning a page keeps the tab, to read the same part of the next person. */
function turnTo(id: string) {
  return { character: id, "chars.look": null } as const;
}

/**
 * Back to the cast, and the previous and next person in it. ← and → turn the
 * page too, unless a control that uses them has focus.
 */
export function CastNav({ id }: { id: string }) {
  const { order } = useCastBook();
  const [, setParams] = useQueryStates({
    ...charactersParsers,
    view: parseAsString,
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
        onClick={() => void setParams(leaveProfile())}
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

/**
 * Their name, and what they're doing now in a line. The rest of now is the
 * details panel's; where that panel isn't docked, the line opens it.
 */
export function ProfileTitle({ character }: { character: CharacterSummary }) {
  const { presence } = usePresence(character);
  const panelDocked = useMediaQuery(PANEL_DOCKED);
  const [, select] = useSelection();
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <h1 className="text-[1.75rem] leading-tight font-extrabold text-balance">
        {character.name}
      </h1>
      {panelDocked ? (
        <div className="text-[0.875rem] text-ui-soft">
          <StatusLine character={character} presence={presence} doing />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            void select({ kind: "character", id: character.id });
            requestInspector();
          }}
          className="-ms-2 flex max-w-full min-w-0 items-center gap-2 self-start rounded-full px-2 py-0.5 text-[0.875rem] text-ui-soft transition-colors hover:bg-ui-tint hover:text-ui-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ui-primary [&>svg]:size-4 [&>svg]:shrink-0"
        >
          <StatusLine character={character} presence={presence} doing />
          <PanelRightOpenIcon aria-label="Details" />
        </button>
      )}
    </div>
  );
}

/**
 * The picture of them: a look being tried on, else the portrait they rest in,
 * else their display picture.
 */
function useProfilePicture(character: CharacterSummary): {
  picture: InfoboxPicture | undefined;
  look: string | undefined;
} {
  const [{ "chars.look": look }] = useQueryStates(charactersParsers);
  const { data } = usePortraits(look ? character.id : undefined);
  const tried = look ? data?.portraits.find((p) => p.name === look) : undefined;
  if (tried)
    return {
      picture: { src: tried.url },
      look: tried.outfit ? `${tried.outfit} · ${tried.mood}` : tried.mood,
    };
  const src = character.portraitUrl ?? character.avatarUrl;
  return { picture: src ? { src } : undefined, look: undefined };
}

/**
 * The box beside their page, as a wiki has: their picture whole, the other
 * names they go by, and their groups, each opening the cast found by it.
 */
export function ProfileInfobox({
  character,
  hidden = false,
  className,
}: {
  character: CharacterSummary;
  /** Out of the way while the page beside it is written. */
  hidden?: boolean;
  className?: string;
}) {
  const { data: page } = useWikiPage(character.id);
  const pageName = usePageName();
  const { picture, look } = useProfilePicture(character);
  const [, setParams] = useQueryStates({
    ...charactersParsers,
    view: parseAsString,
    sel: entityRefParser,
  });
  if (hidden) return null;
  const groups =
    page?.world?.in ??
    (character.groups ?? []).map((ref) => ({ ref, level: undefined }));

  return (
    <Infobox
      label={`About ${character.name}`}
      picture={picture}
      caption={look}
      className={className}
    >
      {character.aliases.length ? (
        <InfoboxRow term="Also known as">
          {character.aliases.join(", ")}
        </InfoboxRow>
      ) : null}
      {groups.length ? (
        <InfoboxRow term="Groups">
          <ul className="flex flex-col gap-1.5">
            {groups.map(({ ref, level }) => (
              <li key={ref}>
                <button
                  type="button"
                  title={`See ${pageName(ref)} in the cast`}
                  onClick={() =>
                    void setParams({
                      ...leaveProfile(),
                      "chars.show": null,
                      "chars.by": null,
                      "chars.q": pageName(ref),
                    })
                  }
                  className="rounded-[0.375rem] text-start font-bold text-ui-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ui-primary"
                >
                  {pageName(ref)}
                </button>
                {level ? (
                  <span className="block text-xs text-ui-soft">
                    {MEMBERSHIP[level]}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </InfoboxRow>
      ) : null}
    </Infobox>
  );
}
