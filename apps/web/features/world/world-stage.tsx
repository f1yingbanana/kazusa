"use client";

import { MapIcon } from "lucide-react";
import { useQueryState } from "nuqs";
import {
  PLACE_PREFIX,
  usePlacesAvailable,
  useWorldNow,
  worldParsers,
} from "../legacy";
import { WorldMap } from "./map/world-map";

/**
 * The world now: everyone onstage on the map, with the list beside it saying
 * who is where.
 */
export function WorldStage() {
  const [focus] = useQueryState("world.in", worldParsers["world.in"]);
  const { onstage, places } = useWorldNow();
  const available = usePlacesAvailable();
  const focusPlaceId = focus?.startsWith(PLACE_PREFIX)
    ? focus.slice(PLACE_PREFIX.length)
    : undefined;

  if (!available || !places || places.places.length === 0) {
    return (
      <section
        aria-label="World"
        className="grid flex-1 place-content-center justify-items-center gap-3 p-8 text-center"
      >
        <span className="grid size-14 place-items-center rounded-[1.25rem] bg-ui-tint text-ui-primary [&_svg]:size-6">
          <MapIcon aria-hidden />
        </span>
        <h2 className="text-lg font-extrabold">No map yet</h2>
        <p className="max-w-xs text-sm text-ui-soft">
          Places added to this world appear here, with everyone onstage where
          they are.
        </p>
      </section>
    );
  }
  return (
    <section aria-label="World" className="flex min-h-0 flex-1 flex-col">
      <WorldMap places={places} members={onstage} focusPlaceId={focusPlaceId} />
    </section>
  );
}
