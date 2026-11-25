"use client";

import type { CharacterSummary } from "@kazusa/client";
import { useQueryStates } from "nuqs";
import { useEffect, useMemo, useState } from "react";
import { useCast } from "@/hooks/use-characters";
import { useOffstage } from "@/hooks/use-stage";
import { usePageName } from "@/hooks/use-wiki";
import {
  groupByLetter,
  groupByNearest,
  matchesQuery,
  type Group,
} from "@/lib/state/grouping";
import { needsHan, type HanInitial } from "@/lib/state/name-index";
import { useWatchlist } from "@/lib/state/preferences-store";
import { charactersParsers } from "./search-params";

/**
 * Chinese characters' readings, for headings by name: the dictionary loads only
 * once a name needs it.
 */
function useHanInitial(
  cast: readonly CharacterSummary[],
  wanted: boolean,
): HanInitial | undefined {
  const needed = wanted && needsHan(cast.map(({ name }) => name));
  const [han, setHan] = useState<HanInitial>();
  useEffect(() => {
    if (!needed || han) return;
    let live = true;
    void import("pinyin-pro").then(({ pinyin }) => {
      if (live)
        setHan(
          () => (character: string) =>
            pinyin(character, { pattern: "first", toneType: "none" }),
        );
    });
    return () => {
      live = false;
    };
  }, [needed, han]);
  return han;
}

/**
 * The cast as the gallery shows it: found by name, alias or group, narrowed by
 * Show, grouped by their nearest group or by first letter. `order` is the same
 * people in reading order, which a profile turns through.
 */
export function useCastBook() {
  const cast = useCast();
  const offstage = useOffstage();
  const watchlist = useWatchlist();
  const pageName = usePageName();
  const [{ "chars.show": show, "chars.q": query, "chars.by": by }] =
    useQueryStates(charactersParsers);
  const han = useHanInitial(cast, by === "name");
  const q = query.trim().toLowerCase();

  return useMemo(() => {
    const found = cast.filter(
      (one) =>
        (show === "onstage"
          ? !offstage.has(one.id)
          : show === "offstage"
            ? offstage.has(one.id)
            : show === "favorites"
              ? watchlist.includes(one.id)
              : true) &&
        (matchesQuery(one, q) ||
          (one.groups ?? []).some((g) =>
            pageName(g).toLowerCase().includes(q),
          )),
    );
    const groups: Group[] =
      by === "name"
        ? groupByLetter(found, han)
        : groupByNearest(found, pageName);
    return {
      cast,
      groups,
      order: groups.flatMap((group) => group.members.map(({ id }) => id)),
      show,
      query,
      by,
    };
  }, [cast, offstage, watchlist, pageName, show, q, query, by, han]);
}

/** Which gallery tile should regain focus when returning from a profile. */
let galleryFocusId: string | null = null;

export function rememberGalleryFocus(id: string): void {
  galleryFocusId = id;
}

export function peekGalleryFocus(): string | null {
  return galleryFocusId;
}

export function clearGalleryFocus(): void {
  galleryFocusId = null;
}
