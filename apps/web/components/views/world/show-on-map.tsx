"use client";

import { MapIcon } from "lucide-react";
import { parseAsString, useQueryStates } from "nuqs";
import { Button } from "@/components/ui/button";
import { entityRefParser } from "@/lib/state/entity-ref";
import { worldParsers } from "./search-params";
import { PLACE_PREFIX } from "./world-state";

/** Opens a place on the World map, with the place picked. */
export function ShowOnMapButton({ id }: { id: string }) {
  const [, setParams] = useQueryStates({
    view: parseAsString,
    "world.in": worldParsers["world.in"],
    "world.plane": worldParsers["world.plane"],
    sel: entityRefParser,
  });
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() =>
        void setParams({
          view: "world",
          "world.in": `${PLACE_PREFIX}${id}`,
          // The place picks its map; a plane left from before would win.
          "world.plane": null,
          sel: { kind: "place", id },
        })
      }
    >
      <MapIcon />
      Show on map
    </Button>
  );
}
