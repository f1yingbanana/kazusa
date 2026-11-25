"use client";

import { memo, useMemo } from "react";
import type { MapGeometry } from "@/lib/location/map-layout";
import {
  curveBetween,
  curvePath,
  type Region,
  type ShownEdge,
} from "@/lib/location/map-view";
import { cx } from "@/ui/cx";

/*
 * What lies under the places, in canvas units: areas as tinted islands whose
 * translucency stacks like contour lines as you go deeper, and the roads
 * between places. Strokes keep one width on screen at every zoom.
 */

const HAIRLINE = "[vector-effect:non-scaling-stroke]";

/**
 * Areas on the map; one that just closed fades out, one that just opened fades
 * in.
 */
export const MapRegions = memo(function MapRegions({
  regions,
  selectedId,
  hoveredId,
  arranging,
  onDragStart,
}: {
  regions: readonly { readonly item: Region; readonly leaving: boolean }[];
  selectedId: string | null;
  hoveredId: string | null;
  arranging: boolean;
  onDragStart: (id: string, event: React.PointerEvent<Element>) => void;
}) {
  return (
    <g>
      {regions.map(({ item: region, leaving }) => (
        <RegionShape
          key={region.id}
          region={region}
          leaving={leaving}
          selected={selectedId === region.id}
          hovered={hoveredId === region.id}
          arranging={arranging}
          onDragStart={onDragStart}
        />
      ))}
    </g>
  );
});

/** One island; only the one whose state changed draws again. */
const RegionShape = memo(function RegionShape({
  region,
  leaving,
  selected,
  hovered,
  arranging,
  onDragStart,
}: {
  region: Region;
  leaving: boolean;
  selected: boolean;
  hovered: boolean;
  arranging: boolean;
  onDragStart: (id: string, event: React.PointerEvent<Element>) => void;
}) {
  return (
    <g
      className={
        leaving
          ? "pointer-events-none opacity-0 transition-opacity duration-300"
          : "motion-safe:animate-ui-fade-in"
      }
    >
      <path
        d={region.contour}
        className={cx("pointer-events-none fill-none stroke-ui-line", HAIRLINE)}
        strokeWidth={1}
        strokeDasharray="2 5"
      />
      <path
        d={region.path}
        data-region={region.id}
        data-canvas-hold={arranging ? "" : undefined}
        onPointerDown={(event) => {
          if (arranging) onDragStart(region.id, event);
        }}
        className={cx(
          "fill-[color-mix(in_oklch,var(--ui-primary)_7%,transparent)] stroke-[color-mix(in_oklch,var(--ui-primary)_28%,var(--ui-line))] transition-[fill,stroke] duration-300",
          HAIRLINE,
          arranging ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
          hovered &&
            "fill-[color-mix(in_oklch,var(--ui-primary)_13%,transparent)]",
          selected &&
            "fill-[color-mix(in_oklch,var(--ui-accent)_14%,transparent)] stroke-ui-primary",
        )}
        strokeWidth={selected ? 2 : 1}
      />
    </g>
  );
});

function pathsOf(edges: readonly ShownEdge[], geometry: MapGeometry) {
  let walk = "";
  let ride = "";
  for (const edge of edges) {
    const from = geometry.nodes.get(edge.from);
    const to = geometry.nodes.get(edge.to);
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
    () => pathsOf(edges, geometry),
    [edges, geometry],
  );
  return (
    <g fill="none" className="pointer-events-none" strokeLinecap="round">
      <path
        d={walk + ride}
        className={cx("stroke-ui-ground", HAIRLINE)}
        strokeWidth={5}
      />
      <path
        d={walk}
        className={cx(
          "stroke-[color-mix(in_oklch,var(--ui-soft)_55%,transparent)]",
          HAIRLINE,
        )}
        strokeWidth={1.5}
      />
      <path
        d={ride}
        className={cx(
          "stroke-[color-mix(in_oklch,var(--ui-soft)_55%,transparent)]",
          HAIRLINE,
        )}
        strokeWidth={1.5}
        strokeDasharray="5 5"
      />
    </g>
  );
});

export interface Highlight {
  readonly key: string;
  readonly path: string;
  readonly ride: boolean;
}

/**
 * Roads called out from a hovered or picked place, or a picked traveller's
 * route: each draws itself in from where it starts, and ridden ones keep
 * moving, so a route reads as a way to go rather than a line.
 */
export function MapHighlight({
  roads,
  tone,
}: {
  roads: readonly Highlight[];
  tone: "hover" | "pick";
}) {
  if (roads.length === 0) return null;
  return (
    <g fill="none" className="pointer-events-none" strokeLinecap="round">
      {roads.map((road) => (
        <g key={road.key}>
          <path
            d={road.path}
            className={cx("stroke-ui-ground", HAIRLINE)}
            strokeWidth={6}
          />
          <path
            d={road.path}
            pathLength={1}
            strokeDasharray="1 1"
            className={cx(
              tone === "pick"
                ? "stroke-ui-primary"
                : "stroke-[color-mix(in_oklch,var(--ui-primary)_70%,transparent)]",
              "motion-safe:animate-ui-draw",
              HAIRLINE,
            )}
            strokeWidth={tone === "pick" ? 2.5 : 2}
          />
          {road.ride ? (
            <path
              d={road.path}
              strokeDasharray="0 9"
              className={cx(
                "stroke-ui-surface motion-safe:animate-ui-march",
                HAIRLINE,
              )}
              strokeWidth={2.5}
            />
          ) : null}
        </g>
      ))}
    </g>
  );
}
