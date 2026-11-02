"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { select } from "d3-selection";
import "d3-transition";
import { zoom, zoomIdentity, type ZoomBehavior } from "d3-zoom";

export interface Viewport {
  /** Zoom in coarse steps: everything that depends on it changes only then. */
  readonly zoom: number;
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

interface Box {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

const ZOOM_STEP = 1.18;
const MAX_ZOOM = 2.6;
const FIT_MARGIN = 56;
const FLY_MS = 620;

const motionMs = (ms: number) =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ? 0
    : ms;

/**
 * Pan and zoom bypass React: each frame sets one transform on each layer and
 * `--inv` for what keeps its size on screen. React hears about it only when the
 * zoom crosses a step or the view has moved well away from what was rendered.
 */
export function useMapCamera({
  container,
  world,
  roads,
  grid,
}: {
  readonly container: RefObject<HTMLDivElement | null>;
  readonly world: RefObject<HTMLDivElement | null>;
  readonly roads: RefObject<SVGGElement | null>;
  readonly grid: RefObject<SVGPatternElement | null>;
}) {
  const behavior = useRef<ZoomBehavior<HTMLDivElement, unknown> | null>(null);
  const [viewport, setViewport] = useState<Viewport | null>(null);
  // Nothing can be framed until the zoom behaviour is attached.
  const [attached, setAttached] = useState(false);
  const [size, setSize] = useState<{ width: number; height: number } | null>(
    null,
  );
  const reported = useRef<{ x: number; y: number; k: number } | null>(null);

  useLayoutEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setSize({ width, height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [container]);

  const latestSize = useRef(size);
  latestSize.current = size;

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const report = (x: number, y: number, k: number, force = false) => {
      const box = latestSize.current;
      if (!box) return;
      const last = reported.current;
      const stepped =
        ZOOM_STEP ** Math.round(Math.log(k) / Math.log(ZOOM_STEP));
      const lastStepped = last
        ? ZOOM_STEP ** Math.round(Math.log(last.k) / Math.log(ZOOM_STEP))
        : 0;
      const far =
        !last ||
        Math.abs(last.x - x) > box.width / 3 ||
        Math.abs(last.y - y) > box.height / 3;
      if (!force && !far && stepped === lastStepped) return;
      reported.current = { x, y, k };
      // A screen's margin beyond each edge, so panning doesn't reveal holes.
      setViewport({
        zoom: stepped,
        minX: (-x - box.width) / k,
        minY: (-y - box.height) / k,
        maxX: (-x + box.width * 2) / k,
        maxY: (-y + box.height * 2) / k,
      });
    };
    const zoomer = zoom<HTMLDivElement, unknown>()
      .scaleExtent([0.02, MAX_ZOOM])
      .clickDistance(4)
      .filter((event: Event & { ctrlKey?: boolean; button?: number }) => {
        const target = event.target as Element | null;
        if (event.type !== "wheel" && target?.closest("[data-map-drag]")) {
          return false;
        }
        if (event.type === "dblclick" && target?.closest("[data-map-place]")) {
          return false;
        }
        return (!event.ctrlKey || event.type === "wheel") && !event.button;
      })
      .on(
        "zoom",
        (event: { transform: { x: number; y: number; k: number } }) => {
          const { x, y, k } = event.transform;
          const transform = `translate(${x}px, ${y}px) scale(${k})`;
          if (world.current) {
            world.current.style.transform = transform;
            world.current.style.setProperty("--inv", String(1 / k));
          }
          roads.current?.setAttribute(
            "transform",
            `translate(${x} ${y}) scale(${k})`,
          );
          // The survey grid keeps roughly one size, doubling as you zoom.
          const level = 2 ** Math.round(Math.log2(k));
          grid.current?.setAttribute(
            "patternTransform",
            `translate(${x} ${y}) scale(${k / level})`,
          );
          report(x, y, k);
        },
      )
      .on(
        "end",
        (event: { transform: { x: number; y: number; k: number } }) => {
          const { x, y, k } = event.transform;
          report(x, y, k, true);
        },
      );
    behavior.current = zoomer;
    select(element).call(zoomer);
    setAttached(true);
    return () => {
      select(element).on(".zoom", null);
      behavior.current = null;
      setAttached(false);
    };
  }, [container, world, roads, grid]);

  /**
   * Fits a box to the screen, zooming to at least `minZoom` even if it
   * overflows.
   */
  const fit = useCallback(
    (box: Box, animate = true, maxZoom = MAX_ZOOM, minZoom = 0) => {
      const element = container.current;
      const zoomer = behavior.current;
      const screen = latestSize.current;
      if (!element || !zoomer || !screen) return;
      const width = Math.max(box.maxX - box.minX, 1);
      const height = Math.max(box.maxY - box.minY, 1);
      const k = Math.max(
        minZoom,
        Math.min(
          maxZoom,
          (screen.width - FIT_MARGIN * 2) / width,
          (screen.height - FIT_MARGIN * 2) / height,
        ),
      );
      const target = zoomIdentity
        .translate(
          screen.width / 2 - (k * (box.minX + box.maxX)) / 2,
          screen.height / 2 - (k * (box.minY + box.maxY)) / 2,
        )
        .scale(k);
      const ms = animate ? motionMs(FLY_MS) : 0;
      if (ms === 0) {
        select(element).call((at) => zoomer.transform(at, target));
      } else {
        select(element)
          .transition()
          .duration(ms)
          .call((at) => zoomer.transform(at, target));
      }
    },
    [container],
  );

  const zoomBy = useCallback(
    (factor: number) => {
      const element = container.current;
      const zoomer = behavior.current;
      if (!element || !zoomer) return;
      const ms = motionMs(180);
      if (ms === 0) select(element).call((at) => zoomer.scaleBy(at, factor));
      else
        select(element)
          .transition()
          .duration(ms)
          .call((at) => zoomer.scaleBy(at, factor));
    },
    [container],
  );

  const panBy = useCallback(
    (x: number, y: number) => {
      const element = container.current;
      const zoomer = behavior.current;
      if (!element || !zoomer) return;
      const k = reported.current?.k ?? 1;
      select(element).call((at) => zoomer.translateBy(at, x / k, y / k));
    },
    [container],
  );

  /** The current zoom exactly, for turning screen drags into map distances. */
  const scale = useCallback(() => {
    const inv = world.current?.style.getPropertyValue("--inv");
    return inv ? 1 / Number(inv) : 1;
  }, [world]);

  return {
    viewport,
    ready: attached && size !== null,
    fit,
    zoomBy,
    panBy,
    scale,
  };
}
