"use client";

import { MapIcon, UsersIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { requestSidebar } from "@/lib/state/ui-store";
import { useQueryState } from "nuqs";
import { worldParsers } from "./search-params";
import { PLACE_PREFIX, usePlacesAvailable, useWorldNow } from "./world-state";
import { PlaceMap } from "./map/place-map";

/**
 * The world now: everyone onstage on the map, with the sidebar saying who is
 * where.
 */
export function WorldView() {
  const [focus] = useQueryState("world.in", worldParsers["world.in"]);
  const { onstage, places } = useWorldNow();
  const placesAvailable = usePlacesAvailable();
  const focusPlaceId = focus?.startsWith(PLACE_PREFIX)
    ? focus.slice(PLACE_PREFIX.length)
    : undefined;
  // Narrow screens hide the sidebar; this brings it up.
  const people = (
    <Button
      variant="outline"
      size="sm"
      className="bg-background lg:hidden"
      onClick={requestSidebar}
    >
      <UsersIcon data-icon="inline-start" />
      Who's where
    </Button>
  );
  return (
    <section aria-label="World" className="flex min-h-0 flex-1 flex-col">
      {placesAvailable && places && places.places.length > 0 ? (
        <PlaceMap
          places={places}
          members={onstage}
          focusPlaceId={focusPlaceId}
          overlay={people}
        />
      ) : (
        <NoMap action={people} />
      )}
    </section>
  );
}

/** A world with no places yet: the sidebar lists who's onstage. */
function NoMap({ action }: { action: React.ReactNode }) {
  return (
    <Empty className="border-none">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <MapIcon />
        </EmptyMedia>
        <EmptyTitle>No map yet</EmptyTitle>
        <EmptyDescription>
          Places added to this world appear here, with everyone onstage where
          they are.
        </EmptyDescription>
      </EmptyHeader>
      {action}
    </Empty>
  );
}
