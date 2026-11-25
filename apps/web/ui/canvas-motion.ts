import { solveSpring } from "@ui-sdk/core/gesture";

/**
 * Where a camera looks: the canvas point at the centre of the screen, and its
 * zoom.
 */
export interface Camera {
  readonly cx: number;
  readonly cy: number;
  readonly zoom: number;
}

export interface Motion {
  /** The camera `ms` after the motion started. */
  at(ms: number): Camera;
  readonly duration: number;
}

const RHO = Math.SQRT2;
const MIN_FLIGHT = 420;
const MAX_FLIGHT = 1250;

const easeInOut = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;

/**
 * A flight between two views (van Wijk and Nuij, "Smooth and efficient zooming
 * and panning"): far apart, the camera rises to see both, travels, and comes
 * down, so the eye never loses where it is. Its length follows the distance.
 */
export function flight(from: Camera, to: Camera, screenWidth: number): Motion {
  const w0 = screenWidth / from.zoom;
  const w1 = screenWidth / to.zoom;
  const dx = to.cx - from.cx;
  const dy = to.cy - from.cy;
  const d2 = dx * dx + dy * dy;
  let span: number;
  let path: (s: number) => Camera;
  if (d2 < 1e-9) {
    span = Math.log(w1 / w0) / RHO;
    path = (t) => ({
      cx: from.cx + t * dx,
      cy: from.cy + t * dy,
      zoom: screenWidth / (w0 * Math.exp(RHO * t * span)),
    });
  } else {
    const d1 = Math.sqrt(d2);
    const b0 = (w1 * w1 - w0 * w0 + RHO ** 4 * d2) / (2 * w0 * RHO ** 2 * d1);
    const b1 = (w1 * w1 - w0 * w0 - RHO ** 4 * d2) / (2 * w1 * RHO ** 2 * d1);
    // log(√(b²+1) − b), as −asinh(b): no cancellation when b is large.
    const r0 = -Math.asinh(b0);
    const r1 = -Math.asinh(b1);
    span = (r1 - r0) / RHO;
    path = (t) => {
      const s = t * span;
      const u =
        (w0 / (RHO ** 2 * d1)) *
        (Math.cosh(r0) * Math.tanh(RHO * s + r0) - Math.sinh(r0));
      return {
        cx: from.cx + u * dx,
        cy: from.cy + u * dy,
        zoom: screenWidth / ((w0 * Math.cosh(r0)) / Math.cosh(RHO * s + r0)),
      };
    };
  }
  const duration = Math.min(
    MAX_FLIGHT,
    Math.max(MIN_FLIGHT, Math.abs(span) * 1000),
  );
  return {
    duration,
    at: (ms) =>
      ms >= duration ? to : path(easeInOut(Math.max(0, ms) / duration)),
  };
}

/**
 * A short move that settles like something with weight: centre and zoom each
 * ride a critically damped spring, zoom in log space so in and out feel alike.
 * `velocity` carries on a motion it interrupts, in canvas units per ms.
 */
export function glide(
  from: Camera,
  to: Camera,
  velocity: { readonly cx: number; readonly cy: number } = { cx: 0, cy: 0 },
  response = 0.42,
): Motion {
  const x = solveSpring(response, 1, from.cx - to.cx, velocity.cx);
  const y = solveSpring(response, 1, from.cy - to.cy, velocity.cy);
  const z = solveSpring(response, 1, Math.log(from.zoom / to.zoom), 0);
  return {
    duration: response * 2600,
    at: (ms) => ({
      cx: to.cx + x.position(ms),
      cy: to.cy + y.position(ms),
      zoom: to.zoom * Math.exp(z.position(ms)),
    }),
  };
}
