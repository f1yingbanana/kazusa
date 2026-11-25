"use client";

import { createParts } from "@ui-sdk/react/primitive";
import {
  useState,
  type ComponentProps,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  canvas,
  createCanvasCamera,
  type CanvasOptions,
  type CanvasPoint,
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
  backdrop: "div",
  ground: "g",
  world: "div",
  item: "button",
});

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
  return (
    <parts.Root
      {...props}
      aria-label={label}
      className={cx(
        "isolate min-h-0 flex-1 bg-ui-ground outline-none select-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ui-primary",
        className,
      )}
    >
      <parts.Backdrop className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle,var(--ui-line)_1.1px,transparent_1.5px)] bg-size-[var(--canvas-cell)_var(--canvas-cell)] bg-position-[var(--canvas-x)_var(--canvas-y)]" />
      <svg
        aria-hidden="true"
        className="absolute inset-0 size-full overflow-visible"
      >
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
  /** Where it grows from when it appears, like the area it opens out of. */
  from?: CanvasPoint;
  /** Fades it out where it stands, for something on its way out. */
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
  from,
  leaving,
  layer,
  children,
}: Motion & { x: number; y: number; children: ReactNode }) {
  return (
    <div
      className={cx(
        // A class, not an inline style, sets the point: inline would outrank
        // the starting style that makes it grow out of `from`.
        "pointer-events-none absolute top-0 left-0 origin-top-left transition-opacity duration-300 [--ui-canvas-inv:inherit] [scale:var(--ui-canvas-inv)] [translate:var(--at-x)_var(--at-y)] motion-reduce:transition-none",
        glide && GLIDE[glide],
        from &&
          "transition-[translate,opacity] duration-450 ease-[cubic-bezier(0.22,1,0.36,1)] starting:[translate:var(--from-x)_var(--from-y)] starting:opacity-0 motion-reduce:transition-none",
        leaving && "opacity-0",
      )}
      style={
        {
          "--at-x": `${x}px`,
          "--at-y": `${y}px`,
          zIndex: layer,
          ...(from
            ? { "--from-x": `${from.x}px`, "--from-y": `${from.y}px` }
            : {}),
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
  from,
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
    <Placed
      x={x}
      y={y}
      glide={glide}
      from={from}
      leaving={leaving}
      layer={layer}
    >
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
  from,
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
    <Placed
      x={x}
      y={y}
      glide={glide}
      from={from}
      leaving={leaving}
      layer={layer}
    >
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
