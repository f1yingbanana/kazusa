"use client";

import { XIcon } from "lucide-react";
import type { ReactNode, Ref } from "react";
import { IconButton } from "./button";
import { ClampText } from "./clamp-text";
import { cx } from "./cx";
import { Picture } from "./picture";

/**
 * A panel about one thing, read top to bottom: who or what it is, what you can
 * do with it, then the rest. It scrolls on its own and is a size container, so
 * buttons with `collapse` drop their labels when it's narrow. Its parts never
 * shrink: a clamped one would otherwise be squeezed when the panel scrolls.
 */
export function Detail({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <article
      className={cx(
        "@container flex min-h-0 flex-col gap-4 overflow-y-auto p-4 *:shrink-0",
        className,
      )}
      aria-label={label}
    >
      {children}
    </article>
  );
}

/** A picture of the thing, above its header. */
export function DetailPicture({
  src,
  position,
}: {
  src: string;
  /** What to keep in view when it's cropped, as `object-position`. */
  position?: string;
}) {
  return (
    <Picture
      src={src}
      position={position}
      className="aspect-video shrink-0 rounded-[1rem]"
    />
  );
}

/**
 * A string `title` is the panel's heading; pass a node to put a control (a
 * rename field) there.
 */
export function DetailHeader({
  media,
  eyebrow,
  title,
  subtitle,
  onClose,
}: {
  media?: ReactNode;
  eyebrow?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  onClose?: () => void;
}) {
  const titleClass =
    "text-[1.0625rem] leading-tight font-extrabold text-balance";
  return (
    <header className="flex items-center gap-3">
      {media}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {eyebrow}
        {typeof title === "string" ? (
          <h2 className={titleClass}>{title}</h2>
        ) : (
          <div className={titleClass}>{title}</div>
        )}
        {subtitle ? (
          <div className="min-w-0 text-[0.8125rem] leading-[1.4] text-ui-soft">
            {subtitle}
          </div>
        ) : null}
      </div>
      {onClose ? (
        <IconButton label="Close" className="self-start" onClick={onClose}>
          <XIcon aria-hidden />
        </IconButton>
      ) : null}
    </header>
  );
}

/** An icon in a tile, standing in for a face on things that have none. */
export function DetailMark({ children }: { children: ReactNode }) {
  return (
    <span
      aria-hidden="true"
      className="grid size-11 shrink-0 place-items-center rounded-[0.875rem] bg-ui-tint text-ui-primary [&_svg]:size-5"
    >
      {children}
    </span>
  );
}

/** One primary action takes the row; the rest sit at its end. */
export function DetailActions({
  ref,
  label,
  children,
}: {
  ref?: Ref<HTMLDivElement>;
  label: string;
  children: ReactNode;
}) {
  return (
    <div
      ref={ref}
      className="flex min-w-0 gap-1.5 *:data-[tone=primary]:flex-[1_0_auto]"
      role="group"
      aria-label={label}
    >
      {children}
    </div>
  );
}

/**
 * With no primary action before it, the end group starts the row instead of
 * floating right.
 */
export function DetailActionsEnd({ children }: { children: ReactNode }) {
  return <span className="ms-auto flex gap-1.5 first:ms-0">{children}</span>;
}

/** A short description, clamped to three lines. */
export function DetailAbout({ children }: { children: ReactNode }) {
  return (
    <ClampText className="text-[0.8125rem] leading-[1.55] text-pretty text-ui-soft">
      {children}
    </ClampText>
  );
}

/**
 * One part of the panel, under a hairline and a bold title: the same band as a
 * fold's, so every section reads at one level. `meta` is a count or a fact
 * beside the title; `action` sits at the end.
 */
export function DetailSection({
  title,
  meta,
  action,
  children,
}: {
  title: string;
  meta?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className="flex flex-col border-t border-ui-line"
    >
      <div className="flex min-h-11 items-center gap-2">
        <h3 className="shrink-0 text-sm font-extrabold">{title}</h3>
        {meta !== undefined ? (
          <span className="min-w-0 truncate text-xs font-semibold text-ui-soft tabular-nums">
            {meta}
          </span>
        ) : null}
        {action ? (
          <span className="ms-auto flex shrink-0">{action}</span>
        ) : null}
      </div>
      <div className="flex flex-col gap-2 pb-1">{children}</div>
    </section>
  );
}
