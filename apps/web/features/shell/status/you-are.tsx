"use client";

import { TextButton } from "@/ui/button";
import { useAccess } from "@/hooks/use-access";
import { usePlace, usePlayer } from "@/hooks/use-location";
import { useSelection } from "@/hooks/use-selection";
import { useSources } from "@/lib/source/provider";
import { openPlayDialog, openVisitorWelcome } from "@/lib/state/ui-store";
import { Tooltip } from "@/ui/tooltip";
import { STATUS_LINK } from "./look";

/**
 * Who the person is here and where they are, the same in the bar and on a
 * phone.
 */
export function useYouAre() {
  const { player: who, watching } = useSources();
  const player = usePlayer();
  const place = usePlace(player.placeId);
  const { canPlay, isReadOnly, isLoading } = useAccess();
  const visitor = isReadOnly && !isLoading;
  return {
    shown: watching || Boolean(who.id),
    watching,
    name: watching ? "an observer" : who.name,
    id: who.id,
    place: watching ? undefined : place,
    visitor,
    /** Opens Play as, or for a visitor what they were told on arriving. */
    switchWho: visitor
      ? openVisitorWelcome
      : canPlay
        ? () => openPlayDialog()
        : undefined,
    switchLabel: visitor
      ? "What you can do here"
      : watching
        ? "Play as someone"
        : "Play as someone else",
  };
}

/**
 * "You are Sensei at Schale": who they play (or an observer) opens Play as; the
 * place opens that place.
 */
export function YouAreItem() {
  const you = useYouAre();
  const [, select] = useSelection();
  if (!you.shown) return null;
  return (
    <span className="inline-flex min-w-0 items-center gap-1 whitespace-nowrap">
      You are
      {you.switchWho ? (
        <Tooltip label={you.switchLabel}>
          <TextButton className={STATUS_LINK} onClick={you.switchWho}>
            {you.name}
          </TextButton>
        </Tooltip>
      ) : (
        <span className="font-bold text-ui-ink">{you.name}</span>
      )}
      {you.place ? (
        <>
          at
          <TextButton
            className={`${STATUS_LINK} min-w-0`}
            onClick={() =>
              void select({ kind: "place", id: you.place?.id ?? "" })
            }
          >
            <span className="truncate">{you.place.name}</span>
          </TextButton>
        </>
      ) : null}
    </span>
  );
}
