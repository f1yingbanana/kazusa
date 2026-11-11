"use client";

import { useState } from "react";
import { useBackdrop } from "@/hooks/use-scene";
import { BACKDROP_POSITION } from "@/lib/scene/layout";
import { cn } from "@/lib/utils";

/**
 * Without a picture: the app's background, darkened a little (the foreground
 * colour at low alpha, flat) so the scene reads as a surface and the dialogue
 * box stands off it, light or dark. Also under a picture still on its way.
 */
const SURFACE = "bg-foreground/[0.06]";

/**
 * The place behind the people: its set's picture for the sim time of day,
 * covering the scene (cropped about `BACKDROP_POSITION`), the new one fading in
 * over the old when the hour turns. A place without a set has no picture, only
 * the surface; the header names it.
 */
export function Backdrop({ placeId }: { placeId: string | undefined }) {
  const url = useBackdrop(placeId)?.url;
  // The picture being replaced stays under the new one until the new one has
  // arrived and faded in: a fade over a picture still loading would end on the
  // bare surface.
  const [shown, setShown] = useState(url);
  const [under, setUnder] = useState<string | undefined>(undefined);
  const [loaded, setLoaded] = useState<string | undefined>(undefined);
  if (url !== shown) {
    // Replaced again before it arrived: what was under it stays.
    if (loaded === shown || under === undefined) setUnder(shown);
    setShown(url);
  }

  if (!url) {
    return (
      <div data-backdrop="none" className={cn("absolute inset-0", SURFACE)} />
    );
  }
  const arrived = () => setLoaded(url);
  return (
    <div data-backdrop={url} className={cn("absolute inset-0", SURFACE)}>
      {under ? (
        <img
          key={under}
          src={under}
          alt=""
          draggable={false}
          className="absolute inset-0 size-full object-cover select-none"
          style={{ objectPosition: BACKDROP_POSITION }}
        />
      ) : null}
      <img
        key={url}
        src={url}
        alt=""
        draggable={false}
        onLoad={arrived}
        onError={arrived}
        onAnimationEnd={() => setUnder(undefined)}
        style={{ objectPosition: BACKDROP_POSITION }}
        className={cn(
          "absolute inset-0 size-full object-cover select-none",
          under &&
            (loaded === url ? "animate-in fade-in duration-700" : "opacity-0"),
        )}
      />
    </div>
  );
}
