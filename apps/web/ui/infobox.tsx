"use client";

import { useState, type ReactNode } from "react";
import { cx } from "./cx";

/** The picture a page is of. */
export interface InfoboxPicture {
  readonly src: string;
  /** What it shows, for a screen reader; empty when the page title says it. */
  readonly alt?: string;
}

/**
 * The box beside a page's text, as a wiki has: the picture of what the page is
 * about, whole and never cropped, whatever its shape, with a caption, then a
 * few facts as term and value. It renders nothing when it has neither.
 */
export function Infobox({
  label,
  picture,
  caption,
  actions,
  className,
  children,
}: {
  label: string;
  picture?: InfoboxPicture | undefined;
  caption?: ReactNode;
  /** Buttons under the facts, like where else to see what the page is about. */
  actions?: ReactNode;
  className?: string;
  /** `InfoboxRow`s. */
  children?: ReactNode;
}) {
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const visiblePicture =
    picture && failedSrc !== picture.src ? picture : undefined;
  const rows = Array.isArray(children)
    ? children.some(Boolean)
    : Boolean(children);
  if (!visiblePicture && !rows && !actions) return null;
  return (
    <aside
      aria-label={label}
      className={cx(
        "flex flex-col gap-4 rounded-[1.25rem] bg-ui-ground p-3",
        className,
      )}
    >
      {visiblePicture ? (
        <figure className="flex flex-col gap-2">
          <div className="grid place-items-center overflow-hidden rounded-[0.875rem] bg-ui-tint">
            <img
              ref={(el) => {
                if (el?.complete && el.naturalWidth > 0) setLoadedOnce(true);
              }}
              src={visiblePicture.src}
              alt={visiblePicture.alt ?? ""}
              draggable={false}
              data-loaded={loadedOnce ? "" : undefined}
              onLoad={() => setLoadedOnce(true)}
              onError={() => setFailedSrc(visiblePicture.src)}
              className="max-h-[min(28rem,70vh)] w-full object-contain opacity-0 transition-opacity duration-300 select-none data-loaded:opacity-100 motion-reduce:transition-none"
            />
          </div>
          {caption ? (
            <figcaption className="px-1 text-center text-xs font-semibold text-ui-soft capitalize">
              {caption}
            </figcaption>
          ) : null}
        </figure>
      ) : null}
      {rows ? (
        <dl className="flex flex-col gap-3 px-1 pb-1">{children}</dl>
      ) : null}
      {actions ? <div className="flex flex-wrap gap-1.5">{actions}</div> : null}
    </aside>
  );
}

export function InfoboxRow({
  term,
  children,
}: {
  term: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs font-bold text-ui-soft">{term}</dt>
      <dd className="text-[0.875rem]">{children}</dd>
    </div>
  );
}
