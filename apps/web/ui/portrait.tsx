"use client";

import { useState, type CSSProperties, type ReactNode, type Ref } from "react";
import { initialsOf, type Presence } from "./avatar";
import { cx } from "./cx";

/** How a standing picture is placed: what its set's manifest says. */
export interface PortraitFrame {
  /** The figure's middle across the picture, 0–1. Absent: 0.5. */
  readonly centre?: number | undefined;
  /** Its eyes down the picture, 0–1. Absent: 0.2. */
  readonly eyes?: number | undefined;
  /** The picture's height in pixels. */
  readonly height?: number | undefined;
}

/** A picture this tall is a figure drawn at the usual resolution. */
const REFERENCE_PX = 1536;

/*
  Everyone's eyes on one line at one size, the figure's middle on the frame's,
  so a row reads like a class photo whoever drew them. It leaves out the
  placement's `scale`, which is the character's height: a tall person's face is
  no bigger. `centre` is the body's middle, not the head's, so the crop is loose
  enough to keep a leaning head.
*/
const FACE_ZOOM = 2.5;
const FACE_EYES_AT = 0.36;

function placed(frame: PortraitFrame): CSSProperties {
  const centre = frame.centre ?? 0.5;
  const size = (frame.height ?? REFERENCE_PX) / REFERENCE_PX;
  return {
    height: `${FACE_ZOOM * size * 100}%`,
    left: "50%",
    top: `${FACE_EYES_AT * 100}%`,
    translate: `${-centre * 100}% ${-(frame.eyes ?? 0.2) * 100}%`,
  };
}

/**
 * Someone's face: cut from their standing picture by its placement, or their
 * display picture filling the frame, or their initials. Thinking rings it in
 * the primary colour, typing in the accent; offstage it fades to grey.
 * Decorative: whatever holds it names them.
 */
export function Portrait({
  ref,
  name,
  src,
  frame = {},
  face,
  presence = "unknown",
  className,
  children,
}: {
  ref?: Ref<HTMLDivElement>;
  name: string;
  /** The standing picture. */
  src?: string | undefined;
  frame?: PortraitFrame | undefined;
  /** A display picture, already a face: it fills the frame instead. */
  face?: string | undefined;
  presence?: Presence;
  className?: string;
  /** Drawn over the picture, like a badge in a corner. */
  children?: ReactNode;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const activeUrl = src || face;
  const showImage = Boolean(activeUrl && failedUrl !== activeUrl);

  return (
    <div
      ref={ref}
      data-presence={presence}
      className={cx(
        "group/portrait relative isolate overflow-hidden bg-ui-tint",
        className,
      )}
    >
      {showImage && src ? (
        <img
          key={src}
          ref={(el) => {
            if (el?.complete && el.naturalWidth > 0) el.dataset.loaded = "";
          }}
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onLoad={(event) => {
            event.currentTarget.dataset.loaded = "";
          }}
          onError={() => setFailedUrl(src)}
          style={placed(frame)}
          className="absolute w-auto max-w-none opacity-0 transition-[opacity,filter] duration-300 select-none group-data-[presence=offstage]/portrait:grayscale data-loaded:opacity-100 data-loaded:group-data-[presence=offstage]/portrait:opacity-55 motion-reduce:transition-none"
        />
      ) : showImage && face ? (
        <img
          key={face}
          ref={(el) => {
            if (el?.complete && el.naturalWidth > 0) el.dataset.loaded = "";
          }}
          src={face}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onLoad={(event) => {
            event.currentTarget.dataset.loaded = "";
          }}
          onError={() => setFailedUrl(face)}
          className="size-full object-cover opacity-0 transition-opacity duration-200 select-none group-data-[presence=offstage]/portrait:grayscale data-loaded:opacity-100 data-loaded:group-data-[presence=offstage]/portrait:opacity-55 motion-reduce:transition-none"
        />
      ) : (
        <span
          aria-hidden="true"
          className="grid size-full place-items-center text-[2rem] font-extrabold text-ui-primary"
        >
          {initialsOf(name)}
        </span>
      )}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-[inherit] inset-ring inset-ring-[color-mix(in_oklch,var(--ui-ink),transparent_92%)] group-data-[presence=composing]/portrait:inset-ring-2 group-data-[presence=composing]/portrait:inset-ring-ui-accent group-data-[presence=thinking]/portrait:inset-ring-2 group-data-[presence=thinking]/portrait:inset-ring-ui-primary group-data-[presence=thinking]/portrait:motion-safe:animate-ui-pulse"
      />
      {children}
    </div>
  );
}
