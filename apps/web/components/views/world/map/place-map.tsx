"use client";

import { useQueryState } from "nuqs";
import { worldParsers } from "../search-params";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CharacterSummary } from "@kazusa/client";
import { LocateFixedIcon, MinusIcon, MoveIcon, PlusIcon } from "lucide-react";
import { toast } from "sonner";
import { useSWRConfig } from "swr";
import { Button } from "@/components/ui/button";
import { useAccess } from "@/hooks/use-access";
import { useCharacters } from "@/hooks/use-characters";
import {
  useLocationRecord,
  useOccupancy,
  usePlayer,
} from "@/hooks/use-location";
import { useSimNow } from "@/hooks/use-clock";
import { useSelection } from "@/hooks/use-selection";
import { locationStore } from "@/lib/live/state";
import {
  MAP_SCALE,
  boundsOf,
  computeMapGeometry,
  positionsToSave,
  shiftPlace,
  type Point,
} from "@/lib/location/map-layout";
import {
  computeRegions,
  computeReveal,
  curveBetween,
  curvePath,
  edgeMiddle,
  edgesAt,
  isClosed,
  markerFor,
  opensAt,
  planLabels,
  routeStops,
  travelerPoint,
} from "@/lib/location/map-view";
import {
  describeWay,
  placesOnPlane,
  planesOf,
  type PlaceIndex,
} from "@/lib/location/places";
import { PLACES_KEY, savePlacePositions } from "@/lib/source/location/http";
import { serializeEntityRef } from "@/lib/state/entity-ref";
import { markQuietSelection } from "@/lib/state/inspector-request";
import { useWatchlist } from "@/lib/state/watchlist";
import { MapHighlight, MapRegions, MapRoads } from "./map-roads";
import {
  HALO,
  MapAreaLabel,
  MapPlace,
  MapTraveler,
  SHOWN_PEOPLE,
  atPoint,
} from "./map-place";
import { useMapCamera } from "./use-map-camera";

/** Beyond this many on the road at once, only those you'd look for are drawn. */
const MAX_TRAVELERS = 40;

/** The world's places with these positions on their pages, keeping each plane. */
function withPositions(
  world: PlaceIndex,
  positions: Readonly<Record<string, Point>>,
) {
  return world.places.map((place) => {
    const at = positions[place.id];
    return at ? { ...place, map: { ...place.map, ...at } } : place;
  });
}

/**
 * The world as a map: regions inside regions, roads between places and people
 * where they are. Pure rendering of `places` and `location`; positions on it
 * mean nothing to the simulation.
 */
export function PlaceMap({
  places: world,
  members,
  focusPlaceId,
  overlay,
}: {
  places: PlaceIndex;
  /** Whose tokens show. The player always does. */
  members: readonly CharacterSummary[];
  /** Fly here when it changes, and start here. */
  focusPlaceId: string | undefined;
  overlay?: React.ReactNode;
}) {
  const { byId } = useCharacters();
  const { mutate } = useSWRConfig();
  const [planeParam, setPlane] = useQueryState(
    "world.plane",
    worldParsers["world.plane"],
  );
  const player = usePlayer();
  const { canManage } = useAccess();
  const [selection, select] = useSelection();
  const watchlist = useWatchlist();
  const now = useSimNow();

  const [draft, setDraft] = useState<Record<string, Point> | null>(null);
  // Where things were drawn when arranging began, to tell what moved.
  const before = useRef<Readonly<Record<string, Point>>>({});
  const [replacedAll, setReplacedAll] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const arranging = draft !== null;

  const container = useRef<HTMLDivElement>(null);
  const worldLayer = useRef<HTMLDivElement>(null);
  const roadLayer = useRef<SVGGElement>(null);
  const grid = useRef<SVGPatternElement>(null);
  const gridId = useId();
  const { viewport, ready, fit, zoomBy, panBy, scale } = useMapCamera({
    container,
    world: worldLayer,
    roads: roadLayer,
    grid,
  });

  // Each plane is its own map; a place being looked at picks the plane.
  const planes = useMemo(() => planesOf(world), [world]);
  const planeList = useMemo(() => {
    const counts = new Map<string, number>();
    for (const plane of planes.values()) {
      counts.set(plane, (counts.get(plane) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([plane]) => plane);
  }, [planes]);
  const focusPlane = focusPlaceId ? planes.get(focusPlaceId) : undefined;
  const playerPlane = player.placeId ? planes.get(player.placeId) : undefined;
  const plane =
    planeParam !== null && planeList.includes(planeParam)
      ? planeParam
      : (focusPlane ?? playerPlane ?? planeList[0] ?? "");
  const places = useMemo(
    () => placesOnPlane(world, planes, plane),
    [world, planes, plane],
  );

  const stored = useMemo(() => {
    const on: Record<string, Point> = {};
    for (const place of places.places) {
      if (place.map) on[place.id] = { x: place.map.x, y: place.map.y };
    }
    return on;
  }, [places]);
  const geometry = useMemo(
    () => computeMapGeometry(places, draft ?? stored, dragging ?? undefined),
    [places, draft, stored, dragging],
  );
  const regions = useMemo(() => computeRegions(geometry), [geometry]);
  const reveal = useMemo(() => computeReveal(geometry), [geometry]);
  const zoom = viewport?.zoom ?? 0;
  const edges = useMemo(
    () => edgesAt(geometry, reveal, zoom),
    [geometry, reveal, zoom],
  );

  const markerShown = useCallback(
    (id: string) => (reveal.get(id) ?? 0) <= zoom,
    [reveal, zoom],
  );

  const selectedPlace = selection?.kind === "place" ? selection.id : null;
  const selectedCharacter =
    selection?.kind === "character" ? selection.id : null;

  // Everyone drawn: the folder, plus the player wherever they are.
  const shownIds = useMemo(() => {
    const ids = new Set(members.map((member) => member.id));
    if (player.id) ids.add(player.id);
    return [...ids];
  }, [members, player.id]);
  const occupied = useOccupancy(shownIds);
  const peoplePerPlane = useMemo(() => {
    const counts = new Map<string, number>();
    for (const [placeId, ids] of occupied.at) {
      const on = planes.get(placeId);
      if (on !== undefined) counts.set(on, (counts.get(on) ?? 0) + ids.length);
    }
    return counts;
  }, [occupied, planes]);

  const watched = useMemo(() => new Set(watchlist), [watchlist]);
  const rank = useCallback(
    (person: CharacterSummary) =>
      person.id === player.id
        ? 0
        : person.id === selectedCharacter
          ? 1
          : watched.has(person.id)
            ? 2
            : 3,
    [player.id, selectedCharacter, watched],
  );

  // People count toward the nearest place still shown.
  const clusters = useMemo(() => {
    const here = new Map<string, CharacterSummary[]>();
    for (const [placeId, ids] of occupied.at) {
      if (!geometry.nodes.has(placeId)) continue;
      const shownAt = markerFor(geometry, reveal, placeId, zoom);
      for (const id of ids) {
        const person = byId.get(id);
        if (person) here.set(shownAt, [...(here.get(shownAt) ?? []), person]);
      }
    }
    for (const people of here.values()) {
      people.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
    }
    return here;
  }, [occupied, geometry, reveal, zoom, byId, rank]);

  const nameOf = useCallback(
    (id: string) => places.byId.get(id)?.name ?? id,
    [places],
  );
  const plan = useMemo(
    () =>
      planLabels({
        geometry,
        regions,
        reveal,
        edges,
        zoom,
        nameOf,
        peopleAt: (id) => clusters.get(id)?.length ?? 0,
        maxAvatars: SHOWN_PEOPLE,
      }),
    [geometry, regions, reveal, edges, zoom, nameOf, clusters],
  );

  const inView = useCallback(
    ({ x, y }: Point) =>
      !viewport ||
      (x >= viewport.minX &&
        x <= viewport.maxX &&
        y >= viewport.minY &&
        y <= viewport.maxY),
    [viewport],
  );

  const flyTo = useCallback(
    (id: string) => {
      const node = geometry.nodes.get(id);
      if (!node) return;
      fit(
        {
          minX: node.x - node.radius,
          minY: node.y - node.radius,
          maxX: node.x + node.radius,
          maxY: node.y + node.radius,
        },
        true,
        1.6,
        // A step past where it opens: the camera reports zoom in steps.
        node.isArea ? opensAt(reveal, id) * 1.2 : 0,
      );
    },
    [fit, geometry, reveal],
  );

  const fitAll = useCallback(
    (animate = true) => {
      if (geometry.order.length === 0) return;
      const top = [...geometry.nodes.values()].filter((n) => n.depth === 0);
      fit(boundsOf(top), animate);
    },
    [fit, geometry],
  );

  // First view: the place asked for, or the whole plane.
  const framed = useRef(false);
  useEffect(() => {
    if (framed.current || !ready) return;
    framed.current = true;
    if (focusPlaceId && geometry.nodes.has(focusPlaceId)) {
      fitAll(false);
      flyTo(focusPlaceId);
    } else {
      fitAll(false);
    }
  }, [ready, focusPlaceId, geometry, fitAll, flyTo]);

  // Auto-arrange moves everything: frame it once it's drawn.
  const refit = useRef(false);
  useEffect(() => {
    if (!refit.current) return;
    refit.current = false;
    fitAll();
  }, [geometry, fitAll]);

  // A different plane is a different map: look at all of it.
  const lastPlane = useRef(plane);
  useEffect(() => {
    if (lastPlane.current === plane) return;
    lastPlane.current = plane;
    if (focusPlaceId && planes.get(focusPlaceId) === plane) flyTo(focusPlaceId);
    else fitAll(false);
  }, [plane, planes, focusPlaceId, flyTo, fitAll]);

  const lastFocus = useRef(focusPlaceId);
  useEffect(() => {
    if (lastFocus.current === focusPlaceId || !framed.current) return;
    lastFocus.current = focusPlaceId;
    if (!focusPlaceId) {
      fitAll();
    } else if (planes.get(focusPlaceId) === plane) {
      flyTo(focusPlaceId);
    } else {
      // The plane effect flies there once this plane's map is drawn.
      void setPlane(planes.get(focusPlaceId) ?? null, { history: "replace" });
    }
  }, [focusPlaceId, flyTo, fitAll, planes, plane, setPlane]);

  // A closed area opens first; details come with the click after that, or
  // quietly here, without a sheet covering the map on narrow screens.
  const onSelect = useCallback(
    (id: string) => {
      const ref = { kind: "place", id } as const;
      if (isClosed(reveal, id, zoom)) {
        markQuietSelection(serializeEntityRef(ref));
        flyTo(id);
      }
      void select(ref);
    },
    [select, reveal, zoom, flyTo],
  );
  const onSelectCharacter = useCallback(
    (id: string) => void select({ kind: "character", id }),
    [select],
  );

  /*
   * Dragging holds one place under the pointer, everything inside it comes
   * along, and neighbours lean out of its way. Dropping keeps where they ended up.
   */
  const latest = useRef({ geometry, coordinates: draft ?? stored });
  latest.current = { geometry, coordinates: draft ?? stored };
  const settle = useCallback(
    (id: string, current: Record<string, Point>) =>
      computeMapGeometry(places, current, id).coordinates,
    [places],
  );
  const onDragStart = useCallback(
    (id: string, event: React.PointerEvent<Element>) => {
      if (event.button !== 0) return;
      event.stopPropagation();
      const target = event.currentTarget;
      const start = latest.current.geometry;
      const origin = start.coordinates;
      const pointer = { x: event.clientX, y: event.clientY };
      const k = scale() * MAP_SCALE;
      target.setPointerCapture(event.pointerId);
      setDragging(id);
      const move = (moved: PointerEvent) => {
        setDraft(
          shiftPlace(
            start,
            origin,
            id,
            (moved.clientX - pointer.x) / k,
            (moved.clientY - pointer.y) / k,
          ),
        );
      };
      const end = () => {
        target.removeEventListener("pointermove", move as EventListener);
        target.removeEventListener("pointerup", end);
        target.removeEventListener("pointercancel", end);
        setDragging(null);
        setDraft((current) => (current ? settle(id, current) : current));
      };
      target.addEventListener("pointermove", move as EventListener);
      target.addEventListener("pointerup", end);
      target.addEventListener("pointercancel", end);
    },
    [scale, settle],
  );

  const onNudge = useCallback(
    (id: string, dx: number, dy: number) => {
      setDraft((current) =>
        current
          ? settle(
              id,
              shiftPlace(
                latest.current.geometry,
                current,
                id,
                dx / MAP_SCALE,
                dy / MAP_SCALE,
              ),
            )
          : current,
      );
    },
    [settle],
  );

  const startArranging = () => {
    if (!canManage) return;
    before.current = geometry.coordinates;
    setReplacedAll(false);
    setDraft({ ...geometry.coordinates });
  };
  const autoArrange = () => {
    if (!canManage) return;
    // Solved as if no page had a position, then held as this draft until saved.
    setDraft({ ...computeMapGeometry(places, {}).coordinates });
    setReplacedAll(true);
    refit.current = true;
  };
  const saveLayout = async () => {
    if (!canManage || !draft) return;
    const positions = positionsToSave({
      geometry,
      before: before.current,
      stored,
    });
    if (Object.keys(positions).length === 0) {
      setDraft(null);
      return;
    }
    setSaving(true);
    try {
      await savePlacePositions(positions);
      // Show it now; the wiki watcher's `places` event confirms it shortly.
      await mutate(
        [PLACES_KEY],
        { places: withPositions(world, positions) },
        { revalidate: false },
      );
      setDraft(null);
      toast.success("Layout saved");
    } catch (error) {
      toast.error("Couldn't save the layout", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  };

  // Called from arrow keys on the map itself (not on a place being moved).
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.target !== event.currentTarget) return;
    const pans: Record<string, readonly [number, number]> = {
      ArrowLeft: [80, 0],
      ArrowRight: [-80, 0],
      ArrowUp: [0, 80],
      ArrowDown: [0, -80],
    };
    const pan = pans[event.key];
    if (pan) {
      event.preventDefault();
      panBy(pan[0], pan[1]);
    } else if (event.key === "+" || event.key === "=") zoomBy(1.4);
    else if (event.key === "-") zoomBy(1 / 1.4);
    else if (event.key === "0") fitAll();
  };

  const highlightPlace = hovered ?? selectedPlace;
  const selectedRecord = useLocationRecord(selectedCharacter ?? undefined);

  const highlightPaths = useMemo(() => {
    const paths: string[] = [];
    if (highlightPlace) {
      for (const edge of edges) {
        if (edge.from !== highlightPlace && edge.to !== highlightPlace)
          continue;
        const a = geometry.nodes.get(edge.from);
        const b = geometry.nodes.get(edge.to);
        if (a && b) paths.push(curvePath(curveBetween(a, b)));
      }
    }
    if (selectedRecord?.trip && now < selectedRecord.trip.arriveAt) {
      const stops = routeStops(selectedRecord);
      for (let i = 1; i < stops.length; i += 1) {
        const a = geometry.nodes.get(stops[i - 1]);
        const b = geometry.nodes.get(stops[i]);
        if (a && b) paths.push(curvePath(curveBetween(a, b)));
      }
    }
    return paths;
  }, [highlightPlace, edges, geometry, selectedRecord, now]);

  // Travel times where they fit, and always for what's highlighted.
  const timeLabels = edges.flatMap((edge) => {
    if (!edge.exact) return [];
    const called = edge.from === highlightPlace || edge.to === highlightPlace;
    if (!called && !plan.times.has(edge.key)) return [];
    const point = edgeMiddle(edge, geometry);
    if (!point || !inView(point)) return [];
    return [
      {
        key: edge.key,
        point,
        called,
        text: describeWay({ by: edge.by, minutes: edge.minutes }),
      },
    ];
  });

  const travelers = occupied.traveling
    .flatMap((id) => {
      const person = byId.get(id);
      const record = locationStore.get(id);
      if (!person || !record) return [];
      const point = travelerPoint(record, now, geometry);
      return point ? [{ person, point }] : [];
    })
    .sort((a, b) => rank(a.person) - rank(b.person))
    .slice(0, MAX_TRAVELERS);

  return (
    <div
      ref={container}
      tabIndex={0}
      role="application"
      aria-label="World map. Arrow keys pan, plus and minus zoom, zero fits the whole map."
      onKeyDown={onKeyDown}
      className="relative min-h-0 flex-1 cursor-move touch-none overflow-clip bg-background outline-none select-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
    >
      <svg aria-hidden className="absolute inset-0 size-full">
        <defs>
          <pattern
            ref={grid}
            id={gridId}
            width={72}
            height={72}
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M36 32v8M32 36h8"
              className="stroke-foreground/[0.11]"
              strokeWidth={1}
              fill="none"
            />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#${gridId})`} />
        <g ref={roadLayer}>
          <MapRegions
            regions={regions}
            nameOf={nameOf}
            visible={markerShown}
            selectedId={selectedPlace}
            arranging={arranging}
            onSelect={onSelect}
            onFocus={flyTo}
            onDragStart={onDragStart}
          />
          <MapRoads edges={edges} geometry={geometry} />
          <MapHighlight paths={highlightPaths} />
        </g>
      </svg>

      <div
        ref={worldLayer}
        className="pointer-events-none absolute top-0 left-0 origin-top-left *:pointer-events-auto"
      >
        {regions.map((region) => {
          const spot =
            plan.areaNames.get(region.id) ??
            (selectedPlace === region.id ? region.top : undefined);
          if (!spot || !inView(spot)) return null;
          return (
            <MapAreaLabel
              key={`label:${region.id}`}
              id={region.id}
              name={places.byId.get(region.id)?.name ?? region.id}
              x={spot.x}
              y={spot.y}
              depth={region.depth}
              selected={selectedPlace === region.id}
              onSelect={onSelect}
              onFocus={flyTo}
            />
          );
        })}
        {timeLabels.map(({ key, point, called, text }) => (
          <div
            key={`time:${key}`}
            className="pointer-events-none! absolute top-0 left-0 w-0"
            style={atPoint(point.x, point.y)}
          >
            <span
              className={`absolute top-0 left-0 -translate-x-1/2 -translate-y-1/2 font-mono text-[10px] whitespace-nowrap tabular-nums ${HALO} ${
                called ? "font-medium text-primary" : "text-muted-foreground"
              }`}
            >
              {text}
            </span>
          </div>
        ))}
        {geometry.order.map((id) => {
          const node = geometry.nodes.get(id)!;
          if (!markerShown(id) || !inView(node)) return null;
          const people = clusters.get(id) ?? [];
          // An area's name is on its region, unless there was no room for it.
          const labeled =
            plan.names.has(id) ||
            ((id === hovered || id === selectedPlace) &&
              !plan.areaNames.has(id));
          const faces = plan.avatars.get(id) ?? 0;
          return (
            <MapPlace
              key={id}
              id={id}
              name={places.byId.get(id)?.name ?? id}
              x={node.x}
              y={node.y}
              isArea={node.isArea}
              labeled={labeled}
              people={people.slice(0, faces)}
              extra={people.length - Math.min(faces, people.length)}
              playerHere={people.some((person) => person.id === player.id)}
              selected={selectedPlace === id}
              selectedCharacter={selectedCharacter}
              playerId={player.id}
              arranging={arranging}
              dragging={dragging === id}
              onSelect={onSelect}
              onSelectCharacter={onSelectCharacter}
              onHover={setHovered}
              onFocus={flyTo}
              onDragStart={onDragStart}
              onNudge={onNudge}
            />
          );
        })}
        {!arranging
          ? travelers.map(({ person, point }) => (
              <MapTraveler
                key={person.id}
                person={person}
                x={point.x}
                y={point.y}
                selected={selectedCharacter === person.id}
                onSelect={onSelectCharacter}
              />
            ))
          : null}
      </div>

      <div className="pointer-events-none absolute inset-x-3 top-3 flex items-start justify-between gap-2 *:pointer-events-auto">
        {arranging ? (
          <div className="flex w-full flex-wrap items-center gap-2 rounded-lg border bg-background/95 p-1.5 pl-3 shadow-sm">
            <p className="mr-auto min-w-48 text-xs text-muted-foreground">
              {replacedAll
                ? "Saving replaces where every place on this map is drawn."
                : "Drag places to rearrange the map. Travel times stay the same."}
            </p>
            <Button variant="ghost" size="sm" onClick={autoArrange}>
              Auto-arrange
            </Button>
            <Button variant="outline" size="sm" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={saving}
              onClick={() => void saveLayout()}
            >
              {saving ? "Saving…" : "Save layout"}
            </Button>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-1.5">
              {planeList.length > 1 ? (
                <div
                  role="group"
                  aria-label="Map plane"
                  className="flex overflow-hidden rounded-md border bg-background"
                >
                  {planeList.map((option) => (
                    <Button
                      key={option}
                      variant={option === plane ? "secondary" : "ghost"}
                      size="xs"
                      aria-pressed={option === plane}
                      className="rounded-none capitalize"
                      onClick={() =>
                        void setPlane(option, { history: "replace" })
                      }
                    >
                      {option || "Elsewhere"}
                      {peoplePerPlane.get(option) ? (
                        <span className="font-mono text-muted-foreground tabular-nums">
                          {peoplePerPlane.get(option)}
                        </span>
                      ) : null}
                    </Button>
                  ))}
                </div>
              ) : null}
              {overlay}
            </div>
            <Button
              variant="outline"
              size="sm"
              className="hidden bg-background md:inline-flex"
              disabled={!canManage}
              onClick={startArranging}
            >
              <MoveIcon data-icon="inline-start" />
              Arrange
            </Button>
          </>
        )}
      </div>

      <div className="absolute right-3 bottom-3 flex flex-col overflow-hidden rounded-lg border bg-background shadow-sm">
        <Button
          variant="ghost"
          size="icon-sm"
          className="rounded-none"
          onClick={() => zoomBy(1.5)}
        >
          <PlusIcon />
          <span className="sr-only">Zoom in</span>
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="rounded-none border-t"
          onClick={() => zoomBy(1 / 1.5)}
        >
          <MinusIcon />
          <span className="sr-only">Zoom out</span>
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="rounded-none border-t"
          onClick={() => fitAll()}
        >
          <LocateFixedIcon />
          <span className="sr-only">Show the whole map</span>
        </Button>
      </div>
    </div>
  );
}
