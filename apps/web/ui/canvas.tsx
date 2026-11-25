"use client";

import { createParts } from "@ui-sdk/react/primitive";
import {
  useId,
  useState,
  type ComponentProps,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  canvas,
  createCanvasCamera,
  type CanvasOptions,
} from "./canvas-primitive";
import { cx } from "./cx";

export {
  type CanvasApi,
  type CanvasCamera,
  type CanvasPoint,
} from "./canvas-primitive";
export type {
  Viewport as CanvasViewport,
  ViewportReason as CanvasMoveReason,
} from "@ui-sdk/core";

const parts = createParts(canvas, {
  root: "div",
  backdrop: "pattern",
  fine: "pattern",
  ground: "g",
  world: "div",
  item: "button",
});

/** A plus, centred on its origin: the backdrop grid's mark. */
const PLUS = "M-3.5 0h7M0-3.5v7";
/** A camera to move the canvas from outside it, like a "show on map" button. */
export function useCanvasCamera() {
  const [camera] = useState(createCanvasCamera);
  return camera;
}

/**
 * A pannable, zoomable canvas. `ground` is SVG drawn in canvas units under
 * everything (strokes keep their width with `vector-effect:
 * non-scaling-stroke`); `children` are HTML placed with `CanvasItem` and
 * `CanvasSpot`, which keep their size on screen; `overlay` floats over it all,
 * unmoved.
 */
export function Canvas({
  label,
  ground,
  overlay,
  className,
  children,
  ...props
}: CanvasOptions &
  Omit<ComponentProps<typeof parts.Root>, keyof CanvasOptions | "children"> & {
    label: string;
    ground?: ReactNode;
    overlay?: ReactNode;
    className?: string;
    children?: ReactNode;
  }) {
  // A plain name: useId's characters don't all survive `url(#…)`.
  const grid = `ui-grid-${useId().replace(/[^\w-]/g, "")}`;
  return (
    <parts.Root
      {...props}
      aria-label={label}
      className={cx(
        "isolate min-h-0 flex-1 bg-ui-ground outline-none select-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ui-primary",
        className,
      )}
    >
      <svg
        aria-hidden="true"
        className="absolute inset-0 size-full overflow-visible"
      >
        <defs>
          <parts.Fine id={`${grid}-fine`} patternUnits="userSpaceOnUse">
            <path
              d={PLUS}
              strokeWidth={1.25}
              className="transform-[translate(var(--ui-grid-c),var(--ui-grid-c))_scale(var(--ui-grid-minor))] fill-none stroke-ui-line opacity-(--ui-grid-minor)"
            />
          </parts.Fine>
          <parts.Backdrop id={grid} patternUnits="userSpaceOnUse">
            <path
              d={PLUS}
              strokeWidth={1.25}
              className="transform-[translate(var(--ui-grid-c),var(--ui-grid-c))] fill-none stroke-ui-line"
            />
          </parts.Backdrop>
        </defs>
        <rect width="100%" height="100%" fill={`url(#${grid}-fine)`} />
        <rect width="100%" height="100%" fill={`url(#${grid})`} />
        <parts.Ground>{ground}</parts.Ground>
      </svg>
      <parts.World className="pointer-events-none absolute top-0 left-0 origin-top-left">
        {children}
      </parts.World>
      {overlay}
    </parts.Root>
  );
}

type Motion = {
  /**
   * How it moves when its point changes: `"settle"` eases in like something
   * landing, `"steady"` keeps pace, for things moved by a clock.
   */
  glide?: "settle" | "steady";
  /**
   * Fades it out where it stands, for something on its way out. Everything
   * fades in where it stands: a map's markers come and go in place, as on a
   * street map, and only things with somewhere to be (`glide`) travel.
   */
  leaving?: boolean;
  /** Stacking among its neighbours: higher draws on top. */
  layer?: number;
};

const GLIDE = {
  settle:
    "transition-[translate,opacity] duration-450 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
  steady:
    "transition-[translate,opacity] duration-1000 ease-linear motion-reduce:transition-none",
} as const;

/**
 * Two layers. The outer one sits at the canvas point, which can animate, and
 * undoes the canvas's zoom with `scale` (applied after `translate`, so the
 * point stays put): it's the only element per item restyled each frame of a
 * zoom. The inner one shifts by `anchor` and never changes while zooming.
 */
function Placed({
  x,
  y,
  glide,
  leaving,
  layer,
  children,
}: Motion & { x: number; y: number; children: ReactNode }) {
  return (
    <div
      className={cx(
        "pointer-events-none absolute top-0 left-0 origin-top-left transition-opacity duration-250 starting:opacity-0 [--ui-canvas-inv:inherit] [scale:var(--ui-canvas-inv)] [translate:var(--at-x)_var(--at-y)] motion-reduce:transition-none",
        glide && GLIDE[glide],
        leaving && "opacity-0",
      )}
      style={
        {
          "--at-x": `${x}px`,
          "--at-y": `${y}px`,
          zIndex: layer,
        } as CSSProperties
      }
    >
      {children}
    </div>
  );
}

/** Shifts a child from its point by `anchor`, in its own pixels. */
const anchored = (anchor: string): CSSProperties => ({
  transform: `translate(${anchor})`,
});

/**
 * Something on the canvas you can focus and press. Arrow keys move to the
 * nearest item that way, and focusing one brings it into view.
 */
export function CanvasItem({
  value,
  x,
  y,
  anchor = "-50%, -50%",
  glide,
  leaving,
  layer,
  className,
  style,
  ...props
}: Omit<ComponentProps<typeof parts.Item>, "value" | "className" | "style"> &
  Motion & {
    value: string;
    x: number;
    y: number;
    anchor?: string;
    className?: string;
    style?: CSSProperties;
  }) {
  return (
    <Placed x={x} y={y} glide={glide} leaving={leaving} layer={layer}>
      <parts.Item
        {...props}
        value={value}
        className={cx(
          "absolute top-0 left-0",
          leaving ? "pointer-events-none" : "pointer-events-auto",
          className,
        )}
        style={{ ...anchored(anchor), ...style }}
      />
    </Placed>
  );
}

/** Anything else at a canvas point: a label, a face, a note. */
export function CanvasSpot({
  x,
  y,
  anchor = "-50%, -50%",
  glide,
  leaving,
  layer,
  className,
  style,
  ...props
}: Omit<ComponentProps<"div">, "className" | "style"> &
  Motion & {
    x: number;
    y: number;
    anchor?: string;
    className?: string;
    style?: CSSProperties;
  }) {
  return (
    <Placed x={x} y={y} glide={glide} leaving={leaving} layer={layer}>
      <div
        {...props}
        className={cx(
          "absolute top-0 left-0",
          leaving && "pointer-events-none",
          className,
        )}
        style={{ ...anchored(anchor), ...style }}
      />
    </Placed>
  );
}
