"use client";

import type { CharacterSummary, PlacesResponse } from "@kazusa/client";
import { useQueryState } from "nuqs";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useSWRConfig } from "swr";
import { useAccess } from "@/hooks/use-access";
import { useCharacters } from "@/hooks/use-characters";
import { useBackdrop } from "@/hooks/use-scene";
import { useSimNow } from "@/hooks/use-clock";
import {
  useLocationRecord,
  useOccupancy,
  usePlayer,
} from "@/hooks/use-location";
import { useSelection } from "@/hooks/use-selection";
import { useLiveStore } from "@/lib/live/state";
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
  edgeMiddle,
  edgesAt,
  isClosed,
  markerFor,
  opensAt,
  planLabels,
  revealAt,
  roadPath,
  routeStops,
  travelerPoint,
} from "@/lib/location/map-view";
import {
  ancestors,
  areaPath,
  placeName,
  connectionsOf,
  describeWay,
  placesOnPlane,
  planesOf,
  positionAt,
  type PlaceIndex,
} from "@/lib/location/places";
import { PLACES_KEY, savePlacePositions } from "@/lib/source/location/http";
import { serializeEntityRef } from "@/lib/state/entity-ref";
import { useWatchlist } from "@/lib/state/preferences-store";
import { markQuietSelection } from "@/lib/state/ui-store";
import { formatSimDuration } from "@/lib/time/sim";
import {
  Canvas,
  useCanvasCamera,
  type CanvasMoveReason,
  type CanvasViewport as Viewport,
} from "@/ui/canvas";
import { cx } from "@/ui/cx";
import { worldParsers } from "../../legacy";
import {
  ArrangeBar,
  ArrangeButton,
  LookingAt,
  MapControls,
  PlanePicker,
} from "./map-hud";
import {
  MapHighlight,
  MapRegions,
  MapRoads,
  type Highlight,
} from "./map-ground";
import {
  AreaLabel,
  CountBubble,
  PersonFace,
  PlaceMarker,
  PEEK_WIDTH,
  PersonPeek,
  PlacePeek,
  RoadTime,
  Traveler,
} from "./map-marker";
import { useNameWidth } from "./measure";
import { useLingering } from "./use-lingering";

const zoomMessage = (zoom: number) => `Map at ${Math.round(zoom * 100)}%`;

/** Faces drawn at a place before the rest become "+N". */
const SHOWN_PEOPLE = 4;
/** Beyond this many on the road at once, only those you'd look for are drawn. */
const MAX_TRAVELERS = 40;
/**
 * The camera reports zoom in steps: everything that depends on it changes only
 * then.
 */
const ZOOM_STEP = 1.25;
/** At most this often, in ms, does a moving camera re-plan the map. */
const PLAN_EVERY = 100;
/** Roads a peek lists, nearest first. */
const PEEK_ROADS = 3;
const MAX_ZOOM = 2.6;
/** Map units are large: a phone needs to stand far back to see a whole plane. */
const MIN_ZOOM = 0.002;

/**
 * What's drawn: the zoom step, and the canvas box (a screen past each edge)
 * worth rendering.
 */
interface View {
  readonly zoom: number;
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly cx: number;
  readonly cy: number;
}

const stepOf = (zoom: number) =>
  ZOOM_STEP ** Math.round(Math.log(zoom) / Math.log(ZOOM_STEP));

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
 * The world as a living atlas: areas as islands inside islands, roads between
 * places, and everyone where they are, moving as the clock runs. Positions on
 * it mean nothing to the simulation; they're only where things are drawn.
 */
export function WorldMap({
  places: world,
  members,
  focusPlaceId,
}: {
  places: PlaceIndex;
  /** Whose faces show. The player always does. */
  members: readonly CharacterSummary[];
  /** Fly here when it changes, and start here. */
  focusPlaceId: string | undefined;
}) {
  const camera = useCanvasCamera();

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
  const locations = useLiveStore((state) => state.locations);
  const now = useSimNow();

  const [view, setView] = useState<View | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [hoveredPerson, setHoveredPerson] = useState<string | null>(null);
  const hoverPerson = useCallback((id: string, on: boolean) => {
    setHoveredPerson((current) => (on ? id : current === id ? null : current));
  }, []);
  const [draft, setDraft] = useState<Record<string, Point> | null>(null);
  const before = useRef<Readonly<Record<string, Point>>>({});
  const [replacedAll, setReplacedAll] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const arranging = draft !== null;

  // Each plane is its own map; a place being looked at picks the plane.
  const planes = useMemo(() => planesOf(world), [world]);
  const planeList = useMemo(() => {
    const counts = new Map<string, number>();
    for (const plane of planes.values())
      counts.set(plane, (counts.get(plane) ?? 0) + 1);
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
  // Where each area would open with nothing competing: how far a flight zooms.
  const thresholds = useMemo(() => computeReveal(geometry), [geometry]);
  const zoom = view?.zoom ?? 0;

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

  // From the whole world: a road can lead to a place on another plane.
  const nameOf = useCallback((id: string) => placeName(world, id), [world]);
  const measure = useNameWidth();
  const nameWidth = useCallback(
    (id: string) => measure(nameOf(id), "place"),
    [measure, nameOf],
  );
  const areaNameWidth = useCallback(
    (id: string) =>
      measure(
        nameOf(id),
        geometry.nodes.get(id)?.depth === 0 ? "region" : "area",
      ),
    [measure, nameOf, geometry],
  );

  // Everyone inside each place, its inside included: busy places show first.
  const peopleWithin = useMemo(() => {
    const counts = new Map<string, number>();
    for (const [placeId, ids] of occupied.at) {
      for (
        let at: string | undefined = placeId;
        at;
        at = geometry.nodes.get(at)?.parent
      ) {
        counts.set(at, (counts.get(at) ?? 0) + ids.length);
      }
    }
    return counts;
  }, [occupied, geometry]);

  // Whoever is picked stands at their own place, whatever the room.
  const pickedRecord = useLocationRecord(selectedCharacter ?? undefined);
  const pickedPlace =
    pickedRecord && positionAt(pickedRecord, now).kind === "at"
      ? (positionAt(pickedRecord, now) as { placeId: string }).placeId
      : undefined;

  // What shows at this zoom, by room on screen.
  const reveal = useMemo(
    () =>
      revealAt(geometry, {
        zoom,
        weight: (id) => peopleWithin.get(id) ?? 0,
        nameWidth,
        pinned: [selectedPlace, pickedPlace].filter((id): id is string => !!id),
      }),
    [geometry, zoom, peopleWithin, nameWidth, selectedPlace, pickedPlace],
  );
  const edges = useMemo(
    () => edgesAt(geometry, reveal, zoom),
    [geometry, reveal, zoom],
  );
  const shown = useCallback((id: string) => reveal.get(id) === 0, [reveal]);

  const watched = useMemo(() => new Set(watchlist), [watchlist]);
  // A stack's order doesn't follow the selection, so picking a face never shuffles it.
  const rank = useCallback(
    (person: CharacterSummary) =>
      person.id === player.id ? 0 : watched.has(person.id) ? 1 : 2,
    [player.id, watched],
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
        nameWidth,
        areaNameWidth,
      }),
    [
      geometry,
      regions,
      reveal,
      edges,
      zoom,
      nameOf,
      clusters,
      nameWidth,
      areaNameWidth,
    ],
  );

  const inView = useCallback(
    ({ x, y }: Point) =>
      !view ||
      (x >= view.minX && x <= view.maxX && y >= view.minY && y <= view.maxY),
    [view],
  );

  /*
   * The camera moves every frame without React; React hears about it when the
   * zoom crosses a step or the view drifts a third of a screen from what was
   * rendered, at most every PLAN_EVERY ms while it keeps moving (and once more
   * when it stops), and then renders half a screen past every edge.
   */
  const lastView = useRef<View | null>(null);
  const planned = useRef(0);
  const trailing = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // While the whole plane is what's shown, a resize frames it again.
  const showingAll = useRef(false);
  const replan = useCallback(() => {
    {
      const api = camera.current;
      if (!api) return;
      const viewport = api.viewport.get();
      const seen = api.viewport.visible();
      const width = seen.right - seen.left;
      const height = seen.bottom - seen.top;
      const step = stepOf(viewport.zoom);
      const cx = (seen.left + seen.right) / 2;
      const cy = (seen.top + seen.bottom) / 2;
      const last = lastView.current;
      if (
        last &&
        last.zoom === step &&
        Math.abs(last.cx - cx) < width / 3 &&
        Math.abs(last.cy - cy) < height / 3
      ) {
        return;
      }
      // Half a screen past each edge: the plan is redone well before a pan
      // reaches what wasn't drawn, and fewer markers restyle every frame.
      const next = {
        zoom: step,
        minX: seen.left - width / 2,
        minY: seen.top - height / 2,
        maxX: seen.right + width / 2,
        maxY: seen.bottom + height / 2,
        cx,
        cy,
      };
      lastView.current = next;
      planned.current = performance.now();
      setView(next);
    }
  }, [camera]);
  const onViewportChange = useCallback(
    (_viewport: Viewport, reason: CanvasMoveReason) => {
      if (reason !== "imperative") showingAll.current = false;
      const wait = planned.current + PLAN_EVERY - performance.now();
      if (wait <= 0) {
        clearTimeout(trailing.current);
        trailing.current = undefined;
        replan();
      } else {
        trailing.current ??= setTimeout(() => {
          trailing.current = undefined;
          replan();
        }, wait);
      }
    },
    [replan],
  );
  useEffect(() => () => clearTimeout(trailing.current), []);

  const flyTo = useCallback(
    (id: string) => {
      const node = geometry.nodes.get(id);
      if (!node) return;
      showingAll.current = false;
      camera.current?.flyTo(
        {
          left: node.x - node.radius,
          top: node.y - node.radius,
          right: node.x + node.radius,
          bottom: node.y + node.radius,
        },
        // A step past where an area opens, so its inside shows on landing.
        {
          maxZoom: 1.6,
          minZoom: node.isArea ? opensAt(thresholds, id) * 1.2 : 0,
        },
      );
    },
    [camera, geometry, thresholds],
  );

  const wholeMap = useCallback(() => {
    const top = [...geometry.nodes.values()].filter((n) => n.depth === 0);
    if (top.length === 0) return undefined;
    const box = boundsOf(top);
    return { left: box.minX, top: box.minY, right: box.maxX, bottom: box.maxY };
  }, [geometry]);
  const fitAll = useCallback(
    (animate = true) => {
      const rect = wholeMap();
      if (!rect) return;
      showingAll.current = true;
      // Room past the islands for the names set on their edges.
      const options = { maxZoom: MAX_ZOOM, padding: 88 };
      if (animate) camera.current?.flyTo(rect, options);
      else camera.current?.jumpTo(rect, options);
    },
    [camera, wholeMap],
  );

  // First view: the whole plane, once the canvas is attached, has a size and
  // the map has places. One loop, so renders while loading can't restart it.
  const [ready, setReady] = useState(false);
  const startup = useRef({ fitAll, empty: geometry.order.length === 0 });
  startup.current = { fitAll, empty: geometry.order.length === 0 };
  useEffect(() => {
    if (ready) return;
    let id = 0;
    const attempt = () => {
      const seen = camera.current?.viewport.visible();
      if (!seen || seen.right - seen.left <= 0 || startup.current.empty) {
        id = requestAnimationFrame(attempt);
        return;
      }
      startup.current.fitAll(false);
      setReady(true);
    };
    id = requestAnimationFrame(attempt);
    return () => cancelAnimationFrame(id);
  }, [ready, camera]);

  // A pane switch, a turned phone or a drawer changes the canvas's size.
  useEffect(() => {
    const el = camera.current?.surface();
    if (!el) return;
    let width = el.clientWidth;
    let height = el.clientHeight;
    const observer = new ResizeObserver(() => {
      if (el.clientWidth === width && el.clientHeight === height) return;
      width = el.clientWidth;
      height = el.clientHeight;
      if (showingAll.current) fitAll(false);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [camera, fitAll]);

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
    fitAll(false);
  }, [plane, fitAll]);

  // Each place asked for gets one flight, once its plane is showing and it's
  // on the map; asking for none shows the whole plane.
  const handled = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!ready || handled.current === focusPlaceId) return;
    if (!focusPlaceId) {
      handled.current = undefined;
      fitAll();
      return;
    }
    const on = planes.get(focusPlaceId);
    if (on === undefined) return;
    if (on !== plane) {
      void setPlane(on, { history: "replace" });
      return;
    }
    if (!geometry.nodes.has(focusPlaceId)) return;
    handled.current = focusPlaceId;
    flyTo(focusPlaceId);
  }, [ready, focusPlaceId, planes, plane, geometry, flyTo, fitAll, setPlane]);

  /*
   * Picking someone, on the map or in the list beside it, shows where they are:
   * a glide when they're already on screen, a flight when they aren't, close
   * enough that their own place shows, onto their plane if it's another.
   */
  const shownPerson = useRef<string | null>(null);
  useEffect(() => {
    if (!ready || selectedCharacter === shownPerson.current) return;
    if (!selectedCharacter) {
      shownPerson.current = null;
      return;
    }
    const record = locations.get(selectedCharacter);
    const api = camera.current;
    if (!record || !api) return;
    const position = positionAt(record, now);
    const placeId = position.kind === "at" ? position.placeId : position.next;
    const on = planes.get(placeId);
    if (on === undefined) {
      shownPerson.current = selectedCharacter;
      return;
    }
    if (on !== plane) {
      void setPlane(on, { history: "replace" });
      return;
    }
    const point =
      position.kind === "at"
        ? geometry.nodes.get(placeId)
        : travelerPoint(record, now, geometry);
    if (!point) return;
    shownPerson.current = selectedCharacter;
    const current = api.viewport.get().zoom;
    // Past where their place appears, so its name and faces have room.
    const needed =
      position.kind === "at"
        ? Math.min((thresholds.get(placeId) ?? 0) * 1.8, 1.6)
        : 0;
    const spot = {
      left: point.x,
      top: point.y,
      right: point.x,
      bottom: point.y,
    };
    const seen = api.viewport.visible();
    const onScreen =
      point.x > seen.left &&
      point.x < seen.right &&
      point.y > seen.top &&
      point.y < seen.bottom;
    showingAll.current = false;
    if (onScreen && current >= needed) {
      api.reveal(spot, 96);
    } else {
      const zoom = Math.max(current, needed);
      api.flyTo(spot, { minZoom: zoom, maxZoom: zoom });
    }
  }, [
    ready,
    selectedCharacter,
    locations,
    now,
    planes,
    plane,
    setPlane,
    camera,
    geometry,
    thresholds,
  ]);

  // A closed area opens first, quietly; its details come with the click after.
  // One function for the life of the map, reading the newest state, so the
  // hundreds of memoized markers don't all re-render on every zoom step.
  const latestSelect = useRef<(id: string) => void>(() => {});
  latestSelect.current = (id: string) => {
    const ref = { kind: "place", id } as const;
    if (isClosed(reveal, id, zoom)) {
      markQuietSelection(serializeEntityRef(ref));
      flyTo(id);
    }
    void select(ref);
  };
  const onSelect = useCallback((id: string) => latestSelect.current(id), []);
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
      const k = (camera.current?.viewport.get().zoom ?? 1) * MAP_SCALE;
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
    [camera, settle],
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
    try {
      await savePlacePositions(positions);
      // Show it now; the wiki watcher's `places` event confirms it shortly.
      await mutate<PlacesResponse>(
        [PLACES_KEY],
        (current) =>
          current && { ...current, places: withPositions(world, positions) },
        { revalidate: false },
      );
      setDraft(null);
      toast.success("Layout saved");
    } catch (error) {
      toast.error("Couldn't save the layout", {
        description: error instanceof Error ? error.message : undefined,
      });
    }
  };

  // A press on an area's island, not a drag across it, picks the area.
  const press = useRef<{ x: number; y: number } | null>(null);
  const regionAt = (event: React.MouseEvent) => {
    if ((event.target as Element).closest("button")) return undefined;
    const down = press.current;
    if (down && Math.hypot(event.clientX - down.x, event.clientY - down.y) > 4)
      return undefined;
    for (const el of document.elementsFromPoint(event.clientX, event.clientY)) {
      const id = el.getAttribute("data-region");
      if (id) return id;
    }
    return undefined;
  };

  const roadsFrom = useCallback(
    (id: string | null): Highlight[] => {
      if (!id) return [];
      return edges.flatMap((edge) => {
        if (edge.from !== id && edge.to !== id) return [];
        const a = geometry.nodes.get(edge.from);
        const b = geometry.nodes.get(edge.to);
        if (!a || !b) return [];
        // Drawn outward from the place, whichever end it is.
        const [start, end] = edge.from === id ? [a, b] : [b, a];
        return [
          {
            key: `${id}:${edge.key}`,
            path: roadPath(start, end),
            ride: edge.by !== "walk",
          },
        ];
      });
    },
    [edges, geometry],
  );
  const picked = useMemo(() => {
    const roads = roadsFrom(selectedPlace);
    if (pickedRecord?.trip && now < pickedRecord.trip.arriveAt) {
      const stops = routeStops(pickedRecord);
      for (let i = 1; i < stops.length; i += 1) {
        const a = geometry.nodes.get(stops[i - 1]);
        const b = geometry.nodes.get(stops[i]);
        if (!a || !b) continue;
        roads.push({
          key: `route:${a.id}:${b.id}`,
          path: roadPath(a, b),
          ride: true,
        });
      }
    }
    return roads;
  }, [roadsFrom, selectedPlace, pickedRecord, now, geometry]);
  const hoverRoads = useMemo(
    () =>
      hovered && hovered !== selectedPlace && !arranging
        ? roadsFrom(hovered)
        : [],
    [hovered, selectedPlace, arranging, roadsFrom],
  );

  // Times on the roads of the picked place; the hovered one's are in its peek.
  const timeLabels = edges.flatMap((edge) => {
    if (!edge.exact) return [];
    const isCalled =
      selectedPlace !== null &&
      (edge.from === selectedPlace || edge.to === selectedPlace);
    if (!isCalled && !plan.times.has(edge.key)) return [];
    const point = edgeMiddle(edge, geometry);
    if (!point || !inView(point)) return [];
    return [
      {
        key: edge.key,
        point,
        called: isCalled,
        text: describeWay({ by: edge.by, minutes: edge.minutes }),
      },
    ];
  });

  const travelers = occupied.traveling
    .flatMap((id) => {
      const person = byId.get(id);
      const record = locations.get(id);
      if (!person || !record) return [];
      const point = travelerPoint(record, now, geometry);
      return point ? [{ person, point }] : [];
    })
    .sort(
      (a, b) =>
        Number(b.person.id === selectedCharacter) -
          Number(a.person.id === selectedCharacter) ||
        rank(a.person) - rank(b.person),
    )
    .slice(0, MAX_TRAVELERS);

  // The area the camera's centre is inside, deepest open one first.
  const trail = useMemo(() => {
    if (!view) return [];
    let best: string | undefined;
    let depth = -1;
    for (const node of geometry.nodes.values()) {
      if (
        !node.isArea ||
        isClosed(reveal, node.id, view.zoom) ||
        node.depth <= depth
      )
        continue;
      if (Math.hypot(node.x - view.cx, node.y - view.cy) > node.radius)
        continue;
      best = node.id;
      depth = node.depth;
    }
    return best ? [...ancestors(places, best).reverse(), best].map(nameOf) : [];
  }, [view, geometry, reveal, places, nameOf]);

  const peek =
    hovered && !arranging && !dragging
      ? geometry.nodes.get(hovered)
      : undefined;
  const peekPeople = peek ? (clusters.get(peek.id) ?? []) : [];
  const peekPicture = useBackdrop(peek?.id)?.url;
  const peekRoads = useMemo(() => {
    if (!peek) return [];
    return connectionsOf(world, peek.id)
      .flatMap(({ to, ways }) => {
        const way = ways[0];
        return way ? [{ to, way }] : [];
      })
      .sort((a, b) => a.way.minutes - b.way.minutes)
      .map(({ to, way }) => ({
        to,
        name: nameOf(to),
        text: describeWay(way),
      }));
  }, [peek, world, nameOf]);

  const positionOf = useCallback(
    (id: string) => {
      const node = geometry.nodes.get(id);
      return node ? { x: node.x, y: node.y } : undefined;
    },
    [geometry],
  );

  // Steady callbacks, so the controls don't re-render on every zoom step.
  const zoomIn = useCallback(() => camera.current?.zoomBy(1.5), [camera]);
  const zoomOut = useCallback(() => camera.current?.zoomBy(1 / 1.5), [camera]);
  const fitAllAnimated = useCallback(() => fitAll(), [fitAll]);
  const playerSpot =
    player.placeId && geometry.nodes.has(player.placeId)
      ? player.placeId
      : undefined;
  const findMe = useMemo(
    () => (playerSpot ? () => flyTo(playerSpot) : undefined),
    [playerSpot, flyTo],
  );

  // The surface's handlers read the newest state through one ref, so the
  // canvas's options never change and ui-sdk never re-syncs its parts.
  const surface = useRef({ arranging, selection, regionAt, flyTo, select });
  surface.current = { arranging, selection, regionAt, flyTo, select };
  const onSurfacePointerDown = useCallback((event: React.PointerEvent) => {
    press.current = { x: event.clientX, y: event.clientY };
  }, []);
  const onSurfaceClick = useCallback(
    (event: React.MouseEvent) => {
      if (surface.current.arranging) return;
      const id = surface.current.regionAt(event);
      if (id) onSelect(id);
    },
    [onSelect],
  );
  const onSurfaceDoubleClick = useCallback((event: React.MouseEvent) => {
    const id = surface.current.regionAt(event);
    if (id) surface.current.flyTo(id);
  }, []);
  const onSurfaceKeyDown = useCallback((event: React.KeyboardEvent) => {
    const { selection, arranging, select } = surface.current;
    if (event.key === "Escape" && selection && !arranging) {
      event.preventDefault();
      void select(null);
    }
  }, []);

  // What's drawn, plus what just left it, so leaving can animate.
  const regionsShown = useLingering(
    useMemo(
      () => regions.filter((region) => shown(region.id)),
      [regions, shown],
    ),
    (region) => region.id,
    350,
  );
  const markers = useLingering(
    useMemo(
      () =>
        geometry.order.filter(
          (id) => shown(id) && inView(geometry.nodes.get(id)!),
        ),
      [geometry, shown, inView],
    ),
    (id) => id,
    450,
  );
  const areaLabels = useLingering(
    regions.flatMap((region) => {
      const spot =
        plan.areaNames.get(region.id) ??
        (selectedPlace === region.id ? region.top : undefined);
      return spot && inView(spot) ? [{ region, spot }] : [];
    }),
    ({ region }) => region.id,
    300,
  );

  // Each seated person drawn on their own in the stack of the place they count
  // toward; the rest of a crowd is only its count.
  const [reaching, setReaching] = useState<string | null>(null);
  const reachTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const reach = useCallback((placeId: string, on: boolean) => {
    clearTimeout(reachTimer.current);
    if (on) setReaching(placeId);
    // A moment's grace, so moving from one face to the next doesn't fold the stack.
    else reachTimer.current = setTimeout(() => setReaching(null), 140);
  }, []);
  const stacks = useMemo(() => {
    const faces: {
      person: CharacterSummary;
      placeId: string;
      x: number;
      y: number;
      dx: number;
      dy: number;
      layer: number;
    }[] = [];
    const counts: {
      placeId: string;
      x: number;
      y: number;
      dx: number;
      dy: number;
      count: number;
      plus: boolean;
    }[] = [];
    for (const [placeId, people] of clusters) {
      const node = geometry.nodes.get(placeId);
      if (!node || !shown(placeId) || !inView(node)) continue;
      // Someone picked always has a face here, room or not.
      const picked = people.some((person) => person.id === selectedCharacter);
      const fits = Math.max(plan.avatars.get(placeId) ?? 0, picked ? 1 : 0);
      // A count of one ("1", "+1") says less than the face it hides.
      const room = people.length === fits + 1 ? fits + 1 : fits;
      const seated = facesShown(people, room, selectedCharacter);
      const extra = people.length - seated.length;
      const slots = seated.length + (extra > 0 ? 1 : 0);
      const step = reaching === placeId ? 31 : 15;
      const seat = (i: number) => (i - (slots - 1) / 2) * step;
      const dy = plan.names.has(placeId) ? 30 : 14;
      seated.forEach((person, i) =>
        faces.push({
          person,
          placeId,
          x: node.x,
          y: node.y,
          dx: seat(i),
          dy,
          layer: slots - i + 1,
        }),
      );
      if (extra > 0) {
        counts.push({
          placeId,
          x: node.x,
          y: node.y,
          dx: seat(slots - 1),
          dy,
          count: extra,
          plus: seated.length > 0,
        });
      }
    }
    return { faces, counts };
  }, [clusters, geometry, shown, inView, plan, selectedCharacter, reaching]);

  // Whoever's face is under the pointer, wherever it's drawn.
  const personPeek = (() => {
    if (!hoveredPerson || arranging || dragging) return undefined;
    const record = locations.get(hoveredPerson);
    const trip =
      record?.trip && now < record.trip.arriveAt ? record.trip : undefined;
    const where = trip
      ? `On the way to ${nameOf(trip.to)} · ${formatSimDuration(trip.arriveAt - now)}`
      : record
        ? `At ${nameOf(record.placeId)}`
        : "";
    const face = stacks.faces.find(({ person }) => person.id === hoveredPerson);
    if (face) {
      return {
        person: face.person,
        x: face.x,
        y: face.y,
        offset: { dx: face.dx, dy: face.dy + 14, gap: FACE_REACH },
        where: where || `At ${nameOf(face.placeId)}`,
      };
    }
    const traveler = travelers.find(
      ({ person }) => person.id === hoveredPerson,
    );
    if (!traveler) return undefined;
    return {
      person: traveler.person,
      x: traveler.point.x,
      y: traveler.point.y,
      offset: { gap: FACE_REACH },
      where,
    };
  })();

  return (
    <Canvas
      label="World map"
      zoomOnScroll
      aria-roledescription="map"
      camera={camera}
      maxZoom={MAX_ZOOM}
      minZoom={MIN_ZOOM}
      positionOf={positionOf}
      zoomMessage={zoomMessage}
      onViewportChange={onViewportChange}
      onHoveredChange={setHovered}
      onHome={fitAllAnimated}
      onPointerDown={onSurfacePointerDown}
      onClick={onSurfaceClick}
      onDoubleClick={onSurfaceDoubleClick}
      onKeyDown={onSurfaceKeyDown}
      className={cx(
        arranging ? "cursor-default" : "cursor-grab active:cursor-grabbing",
      )}
      ground={
        <>
          <MapRegions
            regions={regionsShown}
            selectedId={selectedPlace}
            hoveredId={hovered}
            arranging={arranging}
            onDragStart={onDragStart}
          />

          <MapRoads edges={edges} geometry={geometry} />

          <MapHighlight roads={hoverRoads} tone="hover" />
          <MapHighlight roads={picked} tone="pick" />
        </>
      }
      overlay={
        <>
          <div className="pointer-events-none absolute inset-x-3 top-3 z-20 flex items-start justify-between gap-2 *:pointer-events-auto">
            {arranging ? (
              <ArrangeBar
                replacedAll={replacedAll}
                onAutoArrange={autoArrange}
                onCancel={() => setDraft(null)}
                onSave={saveLayout}
              />
            ) : (
              <>
                <div className="flex min-w-0 flex-col items-start gap-2">
                  {planeList.length > 1 ? (
                    <PlanePicker
                      planes={planeList}
                      plane={plane}
                      people={peoplePerPlane}
                      onPlaneChange={(next) =>
                        void setPlane(next, { history: "replace" })
                      }
                    />
                  ) : null}

                  <LookingAt trail={trail} />
                </div>
                {canManage ? (
                  <ArrangeButton disabled={false} onClick={startArranging} />
                ) : null}
              </>
            )}
          </div>

          <MapControls
            onZoomIn={zoomIn}
            onZoomOut={zoomOut}
            onFit={fitAllAnimated}
            onFindMe={findMe}
          />
        </>
      }
    >
      {areaLabels.map(({ item: { region, spot }, leaving }) => (
        <AreaLabel
          key={`label:${region.id}`}
          id={region.id}
          name={nameOf(region.id)}
          x={spot.x}
          y={spot.y}
          depth={region.depth}
          leaving={leaving}
          selected={selectedPlace === region.id}
          onSelect={onSelect}
        />
      ))}

      {timeLabels.map(({ key, point, called: isCalled, text }) => (
        <RoadTime
          key={`time:${key}`}
          x={point.x}
          y={point.y}
          text={text}
          called={isCalled}
        />
      ))}

      {markers.map(({ item: id, leaving }) => {
        const node = geometry.nodes.get(id);
        if (!node) return null;
        const people = clusters.get(id) ?? [];
        // An area's name is on its island, unless there was no room for it.
        const labeled =
          !leaving &&
          (plan.names.has(id) ||
            ((id === hovered || id === selectedPlace) &&
              !plan.areaNames.has(id)));
        const playerHere = people.some((person) => person.id === player.id);
        const parent = node.parent
          ? geometry.nodes.get(node.parent)
          : undefined;
        // On the way out a place folds back into whatever now stands for it.
        const into = leaving
          ? geometry.nodes.get(markerFor(geometry, reveal, id, zoom))
          : undefined;
        return (
          <PlaceMarker
            key={id}
            id={id}
            name={nameOf(id)}
            x={(into ?? node).x}
            y={(into ?? node).y}
            fromX={parent && !arranging ? parent.x : undefined}
            fromY={parent && !arranging ? parent.y : undefined}
            leaving={leaving}
            isArea={node.isArea}
            labeled={labeled}
            count={people.length}
            occupied={people.length > 0}
            playerHere={playerHere}
            selected={selectedPlace === id}
            arranging={arranging}
            dragging={dragging === id}
            onSelect={onSelect}
            onOpen={flyTo}
            onDragStart={onDragStart}
            onNudge={onNudge}
          />
        );
      })}

      {!arranging
        ? stacks.faces.map(({ person, placeId, ...seat }) => (
            <PersonFace
              key={person.id}
              person={person}
              {...seat}
              isPlayer={person.id === player.id}
              selected={selectedCharacter === person.id}
              onSelect={onSelectCharacter}
              placeId={placeId}
              onReach={reach}
              onHover={hoverPerson}
            />
          ))
        : null}

      {!arranging
        ? stacks.counts.map(({ placeId, ...count }) => (
            <CountBubble
              key={`more:${placeId}`}
              {...count}
              placeId={placeId}
              onPress={onSelect}
              onReach={reach}
            />
          ))
        : null}

      {!arranging
        ? travelers.map(({ person, point }) => (
            <Traveler
              key={person.id}
              person={person}
              x={point.x}
              y={point.y}
              selected={selectedCharacter === person.id}
              onSelect={onSelectCharacter}
              onHover={hoverPerson}
            />
          ))
        : null}
      {peek && !personPeek ? (
        <PlacePeek
          key={`peek:${peek.id}`}
          x={peek.x}
          y={peek.y}
          anchor={peekAnchor(peek, view)}
          name={nameOf(peek.id)}
          path={areaPath(world, peek.id)}
          summary={places.byId.get(peek.id)?.summary ?? ""}
          picture={peekPicture}
          inside={peek.isArea ? (places.children.get(peek.id)?.length ?? 0) : 0}
          roads={peekRoads.slice(0, PEEK_ROADS)}
          moreRoads={Math.max(0, peekRoads.length - PEEK_ROADS)}
          people={peekPeople.slice(0, 5)}
          extra={Math.max(0, peekPeople.length - 5)}
          hint={
            peekPeople.some((person) => person.id === player.id)
              ? "You're here"
              : peek.isArea && isClosed(reveal, peek.id, zoom)
                ? "Click to look inside"
                : undefined
          }
        />
      ) : null}
      {personPeek ? (
        <PersonPeek
          key={`peek:${personPeek.person.id}`}
          x={personPeek.x}
          y={personPeek.y}
          anchor={peekAnchor(personPeek, view, personPeek.offset)}
          person={personPeek.person}
          where={personPeek.where}
          isPlayer={personPeek.person.id === player.id}
          now={now}
        />
      ) : null}
    </Canvas>
  );
}

/** How far a peek sits from what it's about, and from the screen's edges. */
const PEEK_GAP = 18;
const PEEK_MARGIN = 12;
/** Half a face, plus the gap a peek keeps from it. */
const FACE_REACH = 14 + 8;

/**
 * Where a peek sits against a point (shifted by `dx`, `dy` screen pixels, as a
 * face is from its place's dot): `gap` to the right, or to the left when that
 * would run off the screen; level with it, slid up or down to stay on screen.
 */
function peekAnchor(
  at: Point,
  view: View | null,
  { dx = 0, dy = 0, gap = PEEK_GAP } = {},
): string {
  if (!view) return `${dx + gap}px, calc(${dy}px - 50%)`;
  // The view runs half a screen past each edge.
  const width = ((view.maxX - view.minX) / 2) * view.zoom;
  const height = ((view.maxY - view.minY) / 2) * view.zoom;
  const left = (at.x - view.cx) * view.zoom + width / 2 + dx;
  const top = (at.y - view.cy) * view.zoom + height / 2;
  const x =
    left + gap + PEEK_WIDTH + PEEK_MARGIN > width
      ? `calc(${dx - gap}px - 100%)`
      : `${dx + gap}px`;
  const y = `clamp(${PEEK_MARGIN - top}px, calc(${dy}px - 50%), calc(${height - PEEK_MARGIN - top}px - 100%))`;
  return `${x}, ${y}`;
}

/**
 * The faces a stack has room for, in its usual order; someone picked but past
 * the room takes the last seat, so they're always on the map.
 */
function facesShown(
  people: readonly CharacterSummary[],
  room: number,
  picked: string | null,
): CharacterSummary[] {
  const shown = people.slice(0, room);
  const person = picked ? people.find((p) => p.id === picked) : undefined;
  if (room > 0 && person && !shown.includes(person)) shown[room - 1] = person;
  return shown;
}
