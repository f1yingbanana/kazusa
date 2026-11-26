"use client";

import {
  DrawerBackdrop,
  DrawerClose,
  DrawerContent,
  DrawerHandle,
  DrawerTitle,
} from "@ui-sdk/react/drawer";
import { XIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cx } from "./cx";
import { BACKDROP } from "./overlay";

export { Drawer } from "@ui-sdk/react/drawer";

const WIDTH = {
  md: "data-[side=right]:w-[min(24rem,calc(100vw-1.5rem))]",
  lg: "data-[side=right]:w-[min(32rem,calc(100vw-1.5rem))]",
} as const;

/**
 * The drawer's sheet with its backdrop. `handle` names a drag grip, for a
 * drawer from the bottom. `heading` shows the title with a close button.
 */
export function DrawerPanel({
  title,
  handle,
  heading = false,
  size = "md",
  fit = false,
  children,
}: {
  title: string;
  handle?: string;
  heading?: boolean;
  size?: keyof typeof WIDTH;
  /** As tall as what is in it, like a sheet of actions, not the screen. */
  fit?: boolean;
  children: ReactNode;
}) {
  return (
    <>
      <DrawerBackdrop className={BACKDROP} />
      <DrawerContent
        className={cx(
          "relative z-55 flex flex-col bg-ui-surface text-ui-ink shadow-ui outline-none data-[side=bottom]:mx-auto data-[side=bottom]:h-[calc(100dvh-3rem)] data-[side=bottom]:w-full data-[side=bottom]:max-w-lg data-[side=bottom]:rounded-t-[1.5rem] data-[side=bottom]:pb-[env(safe-area-inset-bottom)] data-[side=bottom]:ui-sheet-tail data-[side=right]:my-3 data-[side=right]:me-3 data-[side=right]:h-[calc(100dvh-1.5rem)] data-[side=right]:rounded-[1.5rem]",
          WIDTH[size],
          fit &&
            "data-[side=bottom]:h-auto data-[side=bottom]:max-h-[calc(100dvh-3rem)] data-[side=bottom]:pb-[max(0.75rem,env(safe-area-inset-bottom))]",
        )}
      >
        {handle ? (
          <DrawerHandle
            className="mt-2.5 h-1.5 w-12 shrink-0 self-center rounded-full bg-ui-line"
            aria-label={handle}
          />
        ) : null}
        {heading ? (
          <header className="flex h-14 shrink-0 items-center gap-2 border-b border-ui-line ps-5 pe-2.5">
            <DrawerTitle className="flex-1 text-[0.9375rem] font-extrabold">
              {title}
            </DrawerTitle>
            <DrawerClose
              aria-label={`Close ${title.toLowerCase()}`}
              className="grid size-9 place-items-center rounded-full text-ui-soft hover:bg-ui-tint hover:text-ui-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ui-primary [&_svg]:size-4"
            >
              <XIcon aria-hidden />
            </DrawerClose>
          </header>
        ) : (
          <DrawerTitle className="sr-only">{title}</DrawerTitle>
        )}
        <div className="flex min-h-0 flex-1 flex-col *:min-h-0 *:flex-1">
          {children}
        </div>
      </DrawerContent>
    </>
  );
}
