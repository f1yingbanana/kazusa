"use client";

import { useAccess } from "@/hooks/use-access";
import { usePlace, usePlayer } from "@/hooks/use-location";
import { useSelection } from "@/hooks/use-selection";
import { useSources } from "@/lib/source/provider";
import { openPlayDialog } from "@/lib/state/ui-store";

const LINK = "hover:text-foreground disabled:hover:text-inherit";

/**
 * Who the person is, and where: who they play (or "an observer") opens Play as,
 * the place opens that place.
 */
export function PlayerPlaceItem() {
  const { player: who, watching } = useSources();
  const player = usePlayer();
  const place = usePlace(player.placeId);
  const [, select] = useSelection();
  const { canPlay } = useAccess();
  if (!watching && !who.id) return null;
  return (
    <span>
      {"You are "}
      <button
        type="button"
        className={LINK}
        disabled={!canPlay}
        onClick={() => openPlayDialog()}
      >
        {watching ? "an observer" : who.name}
      </button>
      {!watching && place ? (
        <>
          {" at "}
          <button
            type="button"
            className={LINK}
            onClick={() => void select({ kind: "place", id: place.id })}
          >
            {place.name}
          </button>
        </>
      ) : null}
    </span>
  );
}
