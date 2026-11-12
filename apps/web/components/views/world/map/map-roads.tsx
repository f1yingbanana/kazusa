"use client";

import { memo, useMemo } from "react";
import type { MapGeometry, MapNode } from "@/lib/location/map-layout";
import {
  curveBetween,
  curvePath,
  type Region,
  type ShownEdge,
} from "@/lib/location/map-view";
import { cn } from "@/lib/utils";

/*
 * Regions and roads, in one SVG group the camera transforms. Regions stack their
 * translucent fill, so going deeper reads like climbing contour lines. Strokes
 * don't scale: a road is the same width at every zoom.
 */

export const MapRegions = memo(function MapRegions({
  regions,
  nameOf,
  visible,
  selectedId,
  arranging,
  onSelect,
  onFocus,
  onDragStart,
}: {
  regions: readonly Region[];
  nameOf: (id: string) => string;
  visible: (id: string) => boolean;
  selectedId: string | null;
  arranging: boolean;
  onSelect: (id: string) => void;
  onFocus: (id: string) => void;
  onDragStart: (id: string, event: React.PointerEvent<Element>) => void;
}) {
  return (
    <>
      {regions.map((region) =>
        visible(region.id) ? (
          <g key={region.id} data-map-place="">
            <path
              d={region.contour}
              className="pointer-events-none fill-none stroke-foreground/[0.14] [vector-effect:non-scaling-stroke]"
              strokeWidth={1}
            />
            <path
              d={region.path}
              data-map-drag={arranging ? "" : undefined}
              onClick={() => !arranging && onSelect(region.id)}
              onDoubleClick={() => onFocus(region.id)}
              onPointerDown={(event) => {
                if (arranging) onDragStart(region.id, event);
              }}
              className={cn(
                "fill-foreground/5 stroke-foreground/25 transition-[fill] duration-150 [vector-effect:non-scaling-stroke] hover:fill-foreground/8",
                arranging
                  ? "cursor-grab active:cursor-grabbing"
                  : "cursor-pointer",
                selectedId === region.id && "stroke-primary",
              )}
              strokeWidth={selectedId === region.id ? 1.75 : 1}
            >
              <title>{nameOf(region.id)}</title>
            </path>
          </g>
        ) : null,
      )}
    </>
  );
});

function pathsOf(
  edges: readonly ShownEdge[],
  nodes: ReadonlyMap<string, MapNode>,
) {
  let walk = "";
  let ride = "";
  for (const edge of edges) {
    const from = nodes.get(edge.from);
    const to = nodes.get(edge.to);
    if (!from || !to) continue;
    const path = curvePath(curveBetween(from, to));
    if (edge.by === "walk") walk += path;
    else ride += path;
  }
  return { walk, ride };
}

/** Roads on foot are solid; anything ridden is dashed, however it's named. */
export const MapRoads = memo(function MapRoads({
  edges,
  geometry,
}: {
  edges: readonly ShownEdge[];
  geometry: MapGeometry;
}) {
  const { walk, ride } = useMemo(
    () => pathsOf(edges, geometry.nodes),
    [edges, geometry],
  );
  return (
    <g fill="none" className="pointer-events-none">
      <path
        d={walk + ride}
        className="stroke-background [vector-effect:non-scaling-stroke]"
        strokeWidth={4}
      />
      <path
        d={walk}
        className="stroke-foreground/40 [vector-effect:non-scaling-stroke]"
        strokeWidth={1.25}
      />
      <path
        d={ride}
        className="stroke-foreground/40 [vector-effect:non-scaling-stroke]"
        strokeWidth={1.25}
        strokeDasharray="5 4"
      />
    </g>
  );
});

/** Roads to call out: from a hovered or selected place, or a selected route. */
export function MapHighlight({ paths }: { paths: readonly string[] }) {
  if (paths.length === 0) return null;
  return (
    <g fill="none" className="pointer-events-none">
      <path
        d={paths.join("")}
        className="stroke-background [vector-effect:non-scaling-stroke]"
        strokeWidth={5.5}
      />
      <path
        d={paths.join("")}
        className="stroke-primary [vector-effect:non-scaling-stroke]"
        strokeWidth={2}
      />
    </g>
  );
}
