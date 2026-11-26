"use client";

import {
  ScrollArea,
  ScrollAreaContent,
  ScrollAreaScrollbar,
  ScrollAreaScrollToEnd,
  ScrollAreaThumb,
  ScrollAreaViewport,
  type ScrollAreaController,
} from "@ui-sdk/react/scroll-area";
import { ArrowDownIcon } from "lucide-react";
import type { ComponentProps, ReactNode, Ref } from "react";
import { cx } from "./cx";

export { createScrollAreaController } from "@ui-sdk/react/scroll-area";

/* Fade scrolled content with a mask so the card's outline and corners stay untouched. */
const TOP_MASK =
  "[--scroll-area-overflow-y-start:inherit] [mask-image:linear-gradient(to_bottom,transparent,black_min(1.5rem,var(--scroll-area-overflow-y-start)),black)]";
const BOTH_MASK =
  "[--scroll-area-overflow-y-start:inherit] [--scroll-area-overflow-y-end:inherit] [mask-image:linear-gradient(to_bottom,transparent,black_min(1.5rem,var(--scroll-area-overflow-y-start)),black_calc(100%-min(1.5rem,var(--scroll-area-overflow-y-end))),transparent)]";

/**
 * A conversation's scroller: it opens at the newest line and keeps it in view
 * as lines arrive, lets go when you scroll up, and offers a way back down. The
 * top edge fades while there's more above.
 */
export function ScrollLog({
  label,
  jumpLabel = "Jump to latest",
  className,
  contentClassName,
  overlay,
  children,
}: {
  label: string;
  jumpLabel?: string;
  className?: string;
  contentClassName?: string;
  /** Laid over the log and fixed while it scrolls, in place of Jump to latest. */
  overlay?: ReactNode;
  children: ReactNode;
}) {
  return (
    <ScrollArea
      stickToEnd
      type="hover"
      className={cx("relative flex min-h-0 flex-1 flex-col", className)}
    >
      <ScrollAreaViewport
        role="log"
        aria-label={label}
        className={cx(
          "size-full min-h-0 flex-1 overscroll-contain outline-none focus-visible:inset-ring-2 focus-visible:inset-ring-ui-primary",
          TOP_MASK,
        )}
      >
        <ScrollAreaContent
          className={cx("flex min-h-full flex-col", contentClassName)}
        >
          {children}
        </ScrollAreaContent>
      </ScrollAreaViewport>
      <ScrollAreaScrollbar className="absolute inset-y-1 inset-e-0.5 z-20 flex w-2 touch-none opacity-0 transition-opacity duration-200 data-visible:opacity-100">
        <ScrollAreaThumb className="w-full rounded-full bg-[color-mix(in_oklch,var(--ui-soft),transparent_55%)]" />
      </ScrollAreaScrollbar>
      {overlay ?? (
        <ScrollAreaScrollToEnd
          aria-label={jumpLabel}
          className="absolute inset-s-1/2 bottom-3 z-20 inline-flex h-8 -translate-x-1/2 translate-y-3 scale-90 items-center gap-1.5 rounded-full ui-raised ps-2.5 pe-3.5 text-[0.8125rem] font-bold text-ui-ink opacity-0 transition-[opacity,translate,scale] duration-250 ease-[cubic-bezier(0.3,1.3,0.5,1)] hover:bg-ui-tint focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ui-primary data-visible:translate-y-0 data-visible:scale-100 data-visible:opacity-100 motion-reduce:transition-none rtl:translate-x-1/2 [&:not([data-visible])]:pointer-events-none"
        >
          <ArrowDownIcon
            aria-hidden
            className="size-4 motion-safe:animate-ui-bob"
          />
          {jumpLabel}
        </ScrollAreaScrollToEnd>
      )}
    </ScrollArea>
  );
}

/**
 * A newest-first scroller that opens at the top, lets the caller jump back
 * with a controller, and exposes `onScroll` for hold-back / infinite paging.
 */
export function ScrollFeed({
  label,
  controller,
  viewportRef,
  onScroll,
  className,
  contentClassName,
  overlay,
  children,
}: {
  label: string;
  controller?: ScrollAreaController;
  viewportRef?: Ref<HTMLDivElement>;
  onScroll?: ComponentProps<typeof ScrollAreaViewport>["onScroll"];
  className?: string;
  contentClassName?: string;
  overlay?: ReactNode;
  children: ReactNode;
}) {
  return (
    <ScrollArea
      controller={controller}
      type="hover"
      className={cx("relative flex min-h-0 flex-1 flex-col", className)}
    >
      <ScrollAreaViewport
        ref={viewportRef}
        role="region"
        aria-label={label}
        onScroll={onScroll}
        className={cx(
          "size-full min-h-0 flex-1 overscroll-contain outline-none focus-visible:inset-ring-2 focus-visible:inset-ring-ui-primary",
          BOTH_MASK,
        )}
      >
        <ScrollAreaContent
          className={cx("flex min-h-full flex-col", contentClassName)}
        >
          {children}
        </ScrollAreaContent>
      </ScrollAreaViewport>
      <ScrollAreaScrollbar className="absolute inset-y-1 inset-e-0.5 z-20 flex w-2 touch-none opacity-0 transition-opacity duration-200 data-visible:opacity-100">
        <ScrollAreaThumb className="w-full rounded-full bg-[color-mix(in_oklch,var(--ui-soft),transparent_55%)]" />
      </ScrollAreaScrollbar>
      {overlay}
    </ScrollArea>
  );
}
