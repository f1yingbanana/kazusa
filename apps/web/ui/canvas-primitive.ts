import {
  announce,
  createRovingFocus,
  createViewport,
  css,
  definePrimitive,
  live,
  spatialMove,
  type CanvasRect,
  type PrimitiveContext,
  type Viewport,
  type ViewportReason,
} from "@ui-sdk/core";
import { createVelocityTracker, projectDistance } from "@ui-sdk/core/gesture";
import { flight, glide, type Camera, type Motion } from "./canvas-motion";

/*
 * A pannable, zoomable canvas of things at canvas coordinates: ui-sdk's
 * viewport for the gestures, roving focus that moves to the nearest item in
 * the arrow's direction, and a camera that flies, glides and coasts instead of
 * jumping. Someone who prefers reduced motion gets every move at once.
 */

export interface CanvasPoint {
  readonly x: number;
  readonly y: number;
}

export interface CanvasOptions {
  /** Where an item sits, in canvas units, for arrow-key moves between items. */
  positionOf?: (key: string) => CanvasPoint | undefined;
  minZoom?: number;
  maxZoom?: number;
  /** What screen readers hear after a zoom key, like "Map at 150%". */
  zoomMessage?: (zoom: number) => string;
  /**
   * Every frame the canvas moves, and why. Cheap work only: it runs during
   * gestures.
   */
  onViewportChange?: (viewport: Viewport, reason: ViewportReason) => void;
  onHoveredChange?: (key: string | null) => void;
  /**
   * Whether a scroll zooms at the pointer, like a map, so dragging is how to
   * move. Otherwise a scroll pans and only a pinch zooms.
   */
  zoomOnScroll?: boolean;
  /** `0` on the canvas: show everything. */
  onHome?: () => void;
  camera?: CanvasCamera;
}

/** Lets the page move the camera, like a button that shows a place. */
export interface CanvasCamera {
  /** The canvas on the page, or null while there isn't one. */
  current: CanvasApi | null;
}

export function createCanvasCamera(): CanvasCamera {
  let held: CanvasApi | null = null;
  return {
    get current() {
      return held?.surface()?.isConnected ? held : null;
    },
    set current(api) {
      held = api;
    },
  };
}

/** Pixels of open space kept around something the camera brings into view. */
const MARGIN = 56;
/** A release slower than this, in px/ms, doesn't coast. */
const FLING_SPEED = 0.25;
/** How fast a coast slows, per millisecond, as `projectDistance` expects. */
const FRICTION = 0.9945;

const reducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

type CanvasState = {
  viewport: Viewport;
  focused: string | null;
  hovered: string | null;
};

/** Screen pixels between the grid's main marks at the start of each level. */
const GRID = 100;
/** Each level of the grid splits its spacing into this many. */
const SPLIT = 5;

/**
 * The backdrop grid at a camera. Main marks are `size` pixels apart, `size`
 * growing from GRID to SPLIT times it across each level of zoom (each SPLIT-
 * fold); minor marks split that spacing into SPLIT and come in as it grows
 * (`minor`, 0 to 1: they fade and swell from nothing to whole). At the next
 * level the minor marks, now whole, are the main ones: the grid subdivides and
 * never jumps. Each kind is one repeating tile with its mark in the middle,
 * placed (`x`, `y`) within one tile of the screen's corner, so the numbers stay
 * small (a position in the hundreds of thousands of pixels loses precision).
 */
export function gridAt(x: number, y: number, zoom: number) {
  const level = Math.floor(Math.log(zoom) / Math.log(SPLIT) + 1e-9);
  const size = (GRID * zoom) / SPLIT ** level;
  const tile = (step: number) => {
    const wrap = (v: number) => ((v % step) + step) % step;
    return { x: wrap(x) - step / 2, y: wrap(y) - step / 2, size: step };
  };
  return {
    main: tile(size),
    fine: tile(size / SPLIT),
    minor: Math.min(1, Math.max(0, (size / GRID - 1) / (SPLIT - 1))),
  };
}

type CanvasSlot = "root" | "backdrop" | "fine" | "ground" | "world" | "item";

function buildApi(
  ctx: PrimitiveContext<CanvasOptions, CanvasState, CanvasSlot>,
) {
  const viewport = createViewport<CanvasState>(ctx, {
    key: "viewport",
    surface: () => ctx.element("root"),
    minZoom: () => ctx.options().minZoom ?? 0.02,
    maxZoom: () => ctx.options().maxZoom ?? 4,
    message: (zoom) =>
      ctx.options().zoomMessage?.(zoom) ?? `Zoom ${Math.round(zoom * 100)}%`,
    set: (value, details) => {
      ctx.store.set({ viewport: value });
      ctx.options().onViewportChange?.(value, details.reason);
      return true;
    },
  });

  const roving = createRovingFocus(ctx, {
    slot: "item",
    key: "focused",
    move: spatialMove({
      rect: (el, key) => {
        const point = ctx.options().positionOf?.(key);
        if (!point) {
          // In canvas units too, so every item compares in one space.
          const box = el.getBoundingClientRect();
          const from = viewport.toCanvas(box.left, box.top);
          const to = viewport.toCanvas(box.right, box.bottom);
          return { left: from.x, right: to.x, top: from.y, bottom: to.y };
        }
        return { left: point.x, right: point.x, top: point.y, bottom: point.y };
      },
    }),
  });

  const size = () => {
    const el = ctx.element("root");
    return { width: el?.clientWidth ?? 0, height: el?.clientHeight ?? 0 };
  };
  const cameraOf = (view: Viewport): Camera => {
    const { width, height } = size();
    return {
      cx: (width / 2 - view.x) / view.zoom,
      cy: (height / 2 - view.y) / view.zoom,
      zoom: view.zoom,
    };
  };
  const viewOf = (camera: Camera): Viewport => {
    const { width, height } = size();
    return {
      x: width / 2 - camera.cx * camera.zoom,
      y: height / 2 - camera.cy * camera.zoom,
      zoom: camera.zoom,
    };
  };
  const clampZoom = (zoom: number) =>
    Math.min(
      ctx.options().maxZoom ?? 4,
      Math.max(ctx.options().minZoom ?? 0.02, zoom),
    );

  let frame = 0;
  const stop = () => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
  };
  ctx.onDestroy(stop);

  /** Runs `step` each frame with the ms since it began, until it returns false. */
  const loop = (step: (elapsed: number, dt: number) => boolean) => {
    stop();
    const start = performance.now();
    let last = start;
    const tick = (now: number) => {
      const more = step(now - start, Math.min(now - last, 48));
      last = now;
      frame = more ? requestAnimationFrame(tick) : 0;
    };
    frame = requestAnimationFrame(tick);
  };

  const play = (motion: Motion, target: Camera) => {
    if (reducedMotion()) {
      stop();
      viewport.setViewport(viewOf(target), { reason: "imperative" });
      return;
    }
    loop((elapsed) => {
      const done = elapsed >= motion.duration;
      viewport.setViewport(viewOf(done ? target : motion.at(elapsed)), {
        reason: "imperative",
      });
      return !done;
    });
  };

  /** The camera that shows `rect` whole, with `padding` screen pixels around it. */
  const framing = (
    rect: CanvasRect,
    { padding = MARGIN, maxZoom = Infinity, minZoom = 0 } = {},
  ): Camera => {
    const { width, height } = size();
    const w = Math.max(rect.right - rect.left, 1e-6);
    const h = Math.max(rect.bottom - rect.top, 1e-6);
    const zoom = clampZoom(
      Math.max(
        minZoom,
        Math.min(
          maxZoom,
          (width - padding * 2) / w,
          (height - padding * 2) / h,
        ),
      ),
    );
    return {
      cx: (rect.left + rect.right) / 2,
      cy: (rect.top + rect.bottom) / 2,
      zoom,
    };
  };

  const api = {
    viewport,
    roving,
    stop,
    /** Flies to show `rect`: rises, travels and lands when it's far. */
    flyTo(
      rect: CanvasRect,
      options?: { padding?: number; maxZoom?: number; minZoom?: number },
    ) {
      const from = cameraOf(viewport.get());
      const to = framing(rect, options);
      play(flight(from, to, size().width), to);
    },
    /** Shows `rect` at once, for the first frame of a page. */
    jumpTo(
      rect: CanvasRect,
      options?: { padding?: number; maxZoom?: number; minZoom?: number },
    ) {
      stop();
      viewport.setViewport(viewOf(framing(rect, options)), {
        reason: "imperative",
      });
    },
    /** Glides the least distance that brings `rect` into view. */
    reveal(rect: CanvasRect, padding = MARGIN) {
      const view = viewport.get();
      const { width, height } = size();
      const left = rect.left * view.zoom + view.x;
      const right = rect.right * view.zoom + view.x;
      const top = rect.top * view.zoom + view.y;
      const bottom = rect.bottom * view.zoom + view.y;
      const dx =
        left < padding
          ? padding - left
          : right > width - padding
            ? width - padding - right
            : 0;
      const dy =
        top < padding
          ? padding - top
          : bottom > height - padding
            ? height - padding - bottom
            : 0;
      if (dx === 0 && dy === 0) return;
      api.glideBy(dx, dy);
    },
    /** Pans by screen pixels with a spring. */
    glideBy(dx: number, dy: number) {
      const from = cameraOf(viewport.get());
      const to = {
        ...from,
        cx: from.cx - dx / from.zoom,
        cy: from.cy - dy / from.zoom,
      };
      play(glide(from, to), to);
    },
    /** Zooms about the screen's centre with a spring. */
    zoomBy(factor: number) {
      const from = cameraOf(viewport.get());
      const to = { ...from, zoom: clampZoom(from.zoom * factor) };
      play(glide(from, to, undefined, 0.32), to);
      const message =
        ctx.options().zoomMessage?.(to.zoom) ??
        `Zoom ${Math.round(to.zoom * 100)}%`;
      announce(message);
    },
    /** A scroll or a trackpad pinch, which browsers send as a scroll with Ctrl. */
    wheel(event: WheelEvent) {
      stop();
      if (!ctx.options().zoomOnScroll) {
        viewport.wheel(event);
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      // Lines and pages scroll in bigger steps than pixels; a pinch in finer ones.
      const unit =
        event.deltaMode === 1 ? 0.05 : event.deltaMode === 2 ? 1 : 0.002;
      const factor = 2 ** (-event.deltaY * unit * (event.ctrlKey ? 10 : 1));
      viewport.zoomBy(
        factor,
        { x: event.clientX, y: event.clientY },
        { reason: "wheel", event },
      );
    },
    /** Starts a drag on empty canvas; a quick release coasts to a stop. */
    pointerdown(event: PointerEvent) {
      stop();
      viewport.pointerdown(event);
      if (event.pointerType === "mouse" && event.button !== 0) return;
      const id = event.pointerId;
      const tx = createVelocityTracker();
      const ty = createVelocityTracker();
      let others = 0;
      tx.add(event.timeStamp, event.clientX);
      ty.add(event.timeStamp, event.clientY);
      const down = (e: PointerEvent) => {
        if (e.pointerId !== id) others += 1;
      };
      const move = (e: PointerEvent) => {
        if (e.pointerId !== id) return;
        tx.add(e.timeStamp, e.clientX);
        ty.add(e.timeStamp, e.clientY);
      };
      const up = (e: PointerEvent) => {
        if (e.pointerId !== id) return;
        window.removeEventListener("pointerdown", down, true);
        window.removeEventListener("pointermove", move, true);
        window.removeEventListener("pointerup", up, true);
        window.removeEventListener("pointercancel", up, true);
        if (others > 0 || e.type === "pointercancel" || reducedMotion()) return;
        let vx = tx.velocity(e.timeStamp);
        let vy = ty.velocity(e.timeStamp);
        if (Math.hypot(vx, vy) < FLING_SPEED) return;
        // Coast the distance the release speed carries, slowing like a puck.
        const distance = Math.abs(
          projectDistance(Math.hypot(vx, vy), FRICTION),
        );
        let travelled = 0;
        loop((_elapsed, dt) => {
          viewport.panBy(vx * dt, vy * dt, { reason: "drag" });
          travelled += Math.hypot(vx, vy) * dt;
          const decay = FRICTION ** dt;
          vx *= decay;
          vy *= decay;
          return Math.hypot(vx, vy) > 0.01 && travelled < distance;
        });
      };
      window.addEventListener("pointerdown", down, true);
      window.addEventListener("pointermove", move, true);
      window.addEventListener("pointerup", up, true);
      window.addEventListener("pointercancel", up, true);
    },
    /** The element the canvas is drawn in, once it's on the page. */
    surface: () => ctx.element("root"),
    /**
     * Hands the page's camera to the instance whose root is on the page; one
     * React only rendered never binds. Released when the instance goes, not
     * when React's development double mount unbinds the root.
     */
    attach() {
      const camera = ctx.options().camera;
      if (camera) camera.current = api;
    },
    /** Shows everything, if the page said how. */
    home() {
      const onHome = ctx.options().onHome;
      onHome?.();
      return onHome !== undefined;
    },
    hover(key: string | null) {
      if (ctx.store.get().hovered === key) return;
      ctx.store.set({ hovered: key });
      ctx.options().onHoveredChange?.(key);
    },
  };
  ctx.onDestroy(() => {
    const camera = ctx.options().camera;
    if (camera?.current === api) camera.current = null;
  });
  return api;
}

export type CanvasApi = ReturnType<typeof buildApi>;

const PAN_KEYS: Record<string, readonly [number, number]> = {
  ArrowLeft: [140, 0],
  ArrowRight: [-140, 0],
  ArrowUp: [0, 140],
  ArrowDown: [0, -140],
};

export const canvas = definePrimitive({
  name: "canvas",
  options: {
    positionOf: "value",
    minZoom: "number",
    maxZoom: "number",
    zoomMessage: "value",
    onViewportChange: "callback",
    onHoveredChange: "callback",
    onHome: "callback",
    zoomOnScroll: "boolean",
    camera: "value",
  },
  live: ["viewport", "hovered"],
  state: (_options: CanvasOptions): CanvasState => ({
    viewport: { x: 0, y: 0, zoom: 1 },
    focused: null,
    hovered: null,
  }),
  api: buildApi,
  slots: (slot) => ({
    root: slot({
      // The instance on the page takes the camera; one React only rendered doesn't.
      bind: (el, part) => {
        part.api.attach();
        // Ahead of the viewport's own listener, which would pan, and never passive.
        const wheel = (event: WheelEvent) => part.api.wheel(event);
        el.addEventListener("wheel", wheel, { capture: true, passive: false });
        return () => el.removeEventListener("wheel", wheel, { capture: true });
      },
      attrs: () => ({
        tabindex: "0",
        style: css({
          position: "relative",
          overflow: "clip",
          "touch-action": "none",
        }),
      }),
      on: {
        wheel: (event, { api }) => {
          api.stop();
          api.viewport.wheel(event);
        },
        pointerdown: (event, { api }) => {
          const target = event.target as Element | null;
          if (target?.closest("button, a, input, [data-canvas-hold]")) return;
          api.pointerdown(event);
        },
        keydown: (event, { el, api }) => {
          const key = event;
          if (key.target !== el || key.altKey || key.ctrlKey || key.metaKey)
            return;
          const pan = PAN_KEYS[key.key];
          if (pan) {
            key.preventDefault();
            api.glideBy(pan[0], pan[1]);
          } else if (key.key === "+" || key.key === "=") {
            key.preventDefault();
            api.zoomBy(1.5);
          } else if (key.key === "-" || key.key === "_") {
            key.preventDefault();
            api.zoomBy(1 / 1.5);
          } else if (key.key === "0" && api.home()) {
            key.preventDefault();
          }
        },
      },
    }),
    backdrop: slot({
      live: live((state: CanvasState) => {
        const { x, y, zoom } = state.viewport;
        const { main } = gridAt(x, y, zoom);
        return {
          x: `${main.x}`,
          y: `${main.y}`,
          width: `${main.size}`,
          height: `${main.size}`,
          style: css({ "--ui-grid-c": `${main.size / 2}px` }),
        };
      }),
    }),
    fine: slot({
      live: live((state: CanvasState) => {
        const { x, y, zoom } = state.viewport;
        const { fine, minor } = gridAt(x, y, zoom);
        return {
          x: `${fine.x}`,
          y: `${fine.y}`,
          width: `${fine.size}`,
          height: `${fine.size}`,
          style: css({
            "--ui-grid-c": `${fine.size / 2}px`,
            "--ui-grid-minor": `${minor}`,
          }),
        };
      }),
    }),
    ground: slot({
      live: live((state: CanvasState) => {
        const { x, y, zoom } = state.viewport;
        return { transform: `translate(${x} ${y}) scale(${zoom})` };
      }),
    }),
    world: slot({
      live: live((state: CanvasState, { api }) => ({
        style: `${api.viewport.style(state)};--ui-canvas-inv:${1 / state.viewport.zoom}`,
      })),
    }),
    item: slot<{ value: string }>({
      props: { value: "string" },
      attrs: (state, part) => ({
        tabindex: part.api.roving.tabIndex(state, part),
      }),
      live: live((state: CanvasState, part) => ({
        "data-hovered": state.hovered === part.key ? "" : undefined,
      })),
      on: {
        keydown: (event, { el, api }) => {
          if (el) api.roving.keydown(event, el);
        },
        focus: (_event, { el, key, api }) => {
          api.hover(key);
          if (el) api.reveal(api.viewport.rectOf(el));
        },
        blur: (_event, { api }) => api.hover(null),
        pointerenter: (_event, { api, key }) => api.hover(key),
        pointerleave: (_event, { api }) => api.hover(null),
      },
      bind: (el, part) => part.api.roving.bind(el, part),
    }),
  }),
});
