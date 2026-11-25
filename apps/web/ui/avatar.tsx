"use client";

import type { ReactNode } from "react";
import { cx } from "./cx";
import { VisuallyHidden } from "./visually-hidden";

export type Presence =
  "idle" | "thinking" | "composing" | "offstage" | "unknown";

const SIZE = {
  sm: "size-7 [--size:1.75rem]",
  md: "size-10 [--size:2.5rem]",
  lg: "size-17 [--size:4.25rem]",
} as const;

const FACE =
  "[grid-area:1/1] size-full rounded-full bg-ui-tint object-cover shadow-[0_0_0_2px_var(--ui-surface)]";

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

/** Presence that draws a ring; the others need no element for it. */
const RINGED = new Set<Presence>(["thinking", "composing"]);

/**
 * A face with its presence ring: the picture over the initials, which show
 * while it loads and stay if it fails. `label` is what a screen reader hears,
 * the name by default; `decorative` says nothing, for a face inside a control
 * that already names the person. Plain elements rather than ui-sdk's Avatar: a
 * map draws a hundred faces and re-renders many of them as you zoom, and this
 * needs no state of its own.
 */
export function Avatar({
  name,
  src,
  presence = "unknown",
  size = "md",
  label,
  decorative = false,
}: {
  name: string;
  src?: string;
  presence?: Presence;
  size?: keyof typeof SIZE;
  label?: string;
  decorative?: boolean;
}) {
  return (
    <span
      className={cx(
        "group/avatar relative inline-grid shrink-0 place-items-center",
        SIZE[size],
      )}
      data-presence={presence}
    >
      {RINGED.has(presence) ? (
        <span
          aria-hidden="true"
          className={cx(
            "pointer-events-none absolute -inset-[3px] rounded-full border-2 border-transparent",
            "group-data-[presence=thinking]/avatar:border-ui-primary group-data-[presence=thinking]/avatar:motion-safe:animate-ui-pulse",
            "group-data-[presence=composing]/avatar:border-dashed group-data-[presence=composing]/avatar:border-ui-accent group-data-[presence=composing]/avatar:motion-safe:animate-ui-turn",
          )}
        />
      ) : null}
      <span
        aria-hidden="true"
        className={cx(
          FACE,
          "grid place-items-center text-[calc(var(--size)*0.36)] font-extrabold text-ui-primary",
        )}
      >
        {initialsOf(name)}
      </span>
      {src ? (
        <img
          // A new picture gets a new element: one that failed stays hidden.
          key={src}
          src={src}
          alt=""
          decoding="async"
          onError={(event) => {
            event.currentTarget.hidden = true;
          }}
          className={cx(
            FACE,
            "group-data-[presence=offstage]/avatar:opacity-60 group-data-[presence=offstage]/avatar:grayscale",
          )}
        />
      ) : null}
      {decorative ? null : <VisuallyHidden>{label ?? name}</VisuallyHidden>}
    </span>
  );
}

/** Faces overlapping, for a conversation with more than one person. */
export function AvatarStack({ children }: { children: ReactNode }) {
  return <span className="flex shrink-0 *:not-first:-ms-3.5">{children}</span>;
}
